'use strict';
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const compression = require('compression');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const SEED = require('./seed');
const video = require('./video');
const store = require('./storage');

const PORT = process.env.PORT || 3000;
const { DATA_DIR, UPLOADS } = store; // with STORAGE=cloudinary UPLOADS is only a scratch folder
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 1024);
const SESSION_DAYS = 90;

// ---------- secrets / helpers ----------
const SECRET = (() => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, 'secret.txt');
  if (!fs.existsSync(f)) { fs.writeFileSync(f, crypto.randomBytes(32).toString('hex')); store.pushMeta('secret.txt'); }
  return fs.readFileSync(f, 'utf8').trim();
})();
const rid = (n = 6) => crypto.randomBytes(n).toString('hex');
const hashPw = (pw, salt = rid(16)) => ({ salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') });
const checkPw = (u, pw) => {
  const h = crypto.scryptSync(String(pw), u.salt, 64);
  const e = Buffer.from(u.hash, 'hex');
  return h.length === e.length && crypto.timingSafeEqual(h, e);
};

// ---------- database (single JSON file) ----------
let db;
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
  store.pushMeta('db.json');
}
const seedUploads = []; // seed photos that still have to reach Cloudinary
function seedDb() {
  db = { models: [], profiles: [], users: [], settings: { logo: null } };
  SEED.forEach(([name, description], i) => {
    const m = { id: rid(4), number: i + 1, name, description, files: {} };
    const src = path.join(__dirname, 'seed-images', `m${String(i + 1).padStart(2, '0')}.jpg`);
    if (fs.existsSync(src)) {
      const file = 'lm_' + rid(8) + '.jpg';
      fs.copyFileSync(src, path.join(UPLOADS, file));
      seedUploads.push(store.put(file, 'image/jpeg', { photo: true }));
      m.files.image = { file, size: fs.statSync(src).size, type: 'image/jpeg' };
    }
    db.models.push(m);
  });
  db.profiles.push({ id: rid(4), code: rid(5), label: 'All models', mode: 'all', allowed: [] });
  const adminUser = process.env.ADMIN_USER || 'admin';
  if (store.remote && !process.env.ADMIN_PASSWORD) throw new Error('Set ADMIN_PASSWORD before the first start with STORAGE=' + store.kind + ' (refusing to create admin/admin123 on a public server).');
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  db.users.push({ id: rid(4), username: adminUser, role: 'admin', profileId: null, ...hashPw(adminPass) });
  save();
  console.log(`[seed] admin account created: ${adminUser} / ${process.env.ADMIN_PASSWORD ? '(from ADMIN_PASSWORD)' : adminPass}`);
  if (!process.env.ADMIN_PASSWORD) console.log('[seed] CHANGE THIS PASSWORD after first login (Admin > Settings).');
}
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
else seedDb();

// ---------- sessions (signed cookie) ----------
function sign(o) {
  const b = Buffer.from(JSON.stringify(o)).toString('base64url');
  return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
}
function verify(t) {
  if (!t) return null;
  const [b, s] = t.split('.');
  if (!b || !s) return null;
  const e = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
  try {
    const o = JSON.parse(Buffer.from(b, 'base64url').toString());
    return o.exp > Date.now() ? o : null;
  } catch { return null; }
}
function setSession(req, res, o) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `__session=${sign({ ...o, exp })}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', '__session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
function cookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? m.slice(name.length + 1) : null;
}
const profileOf = (id) => db.profiles.find((p) => p.id === id) || null;

// resolves the session: checks cookie, header, query, and defaults to guest viewer (no login needed)
function resolve(req) {
  const o = verify(cookie(req, '__session'));
  if (o) {
    if (o.r === 'qr') {
      const profile = profileOf(o.p);
      if (profile) return { role: profile.editor ? 'editor' : 'viewer', via: 'qr', profile };
    }
    const user = db.users.find((u) => u.id === o.u);
    if (user) {
      const profile = profileOf(user.profileId) || db.profiles.find((p) => p.mode === 'all') || null;
      return { role: user.role, via: 'login', user, profile };
    }
  }

  // Fallback: QR code passed in header or query parameter
  const qrCode = req.headers['x-qr-code'] || req.query.qr;
  if (qrCode) {
    const p = db.profiles.find((x) => x.code === qrCode);
    if (p) return { role: p.editor ? 'editor' : 'viewer', via: 'qr', profile: p };
  }

  // Default viewer access: open to everyone without password or credentials
  const defaultProfile = db.profiles.find((p) => p.mode === 'all') || db.profiles[0] || null;
  return { role: 'viewer', via: 'guest', profile: defaultProfile };
}
function allowedIds(s) {
  if (s.role === 'admin' || s.role === 'editor' || (s.profile && s.profile.mode === 'all')) return null; // null = everything
  return new Set(s.profile ? s.profile.allowed : []);
}
const isLocked = (s, m) => { const a = allowedIds(s); return a !== null && !a.has(m.id); };

const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const a = attempts.get(ip) || { n: 0, t: now };
  if (now - a.t > 10 * 60e3) { a.n = 0; a.t = now; }
  attempts.set(ip, a);
  return a.n >= 10;
}

function getLocalIp() {
  try {
    const os = require('os');
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal && net.address !== '127.0.0.1') {
          return net.address;
        }
      }
    }
  } catch {}
  return null;
}

// ---------- app ----------
const app = express();
app.set('trust proxy', Number(process.env.TRUST_PROXY || 1)); // proxies in front of the app (Firebase Hosting + Cloud Run: 2)
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { req.sess = resolve(req); next(); });
const needAuth = (req, res, next) => (req.sess ? next() : res.status(401).json({ error: 'Not signed in' }));
const needStaff = (req, res, next) => (req.sess && (req.sess.role === 'admin' || req.sess.role === 'editor') ? next() : res.status(403).json({ error: 'Not allowed' }));
const needAdmin = (req, res, next) => (req.sess && req.sess.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' }));
const origin = (req) => {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const host = req.get('host') || `localhost:${PORT}`;
  const port = /:(\d+)$/.test(host) ? host.split(':').pop() : PORT;
  if (/^localhost|^127\.0\.0\.1/i.test(host)) {
    const lan = getLocalIp();
    if (lan) return `${req.protocol}://${lan}:${port}`;
  }
  return `${req.protocol}://${host}`;
};

const imageInfo = (f) => (f ? { url: '/media/' + f.file, size: f.size } : null);
const selectedPoster = (v) => (v && v.posters && v.posters.length ? v.posters[Math.min(v.poster == null ? v.posters.length - 1 : v.poster, v.posters.length - 1)] : null);
// what a viewer needs to play a video: only finished renditions, never the original upload
function videoInfo(v, locked) {
  if (!v || locked || !v.renditions || !v.renditions.length) return null;
  const p = selectedPoster(v);
  return {
    duration: v.duration, poster: p ? '/media/' + p : null,
    renditions: v.renditions.map((r) => ({ q: r.q, h: r.h, size: r.size, url: '/media/' + r.file })),
  };
}

app.get('/api/me', (req, res) => {
  const s = req.sess;
  res.set('Cache-Control', 'no-store');
  if (!s) return res.json({ role: 'viewer', via: 'guest', profile: null });
  res.json({
    role: s.role,
    via: s.via,
    name: s.user ? s.user.username : (s.role === 'admin' ? 'Admin' : s.role === 'editor' ? 'Editor' : null),
    profile: s.profile ? { label: s.profile.label, mode: s.profile.mode, code: s.profile.code } : null,
  });
});

app.get('/api/qr/:code', (req, res) => {
  const p = db.profiles.find((x) => x.code === req.params.code);
  if (!p) return res.status(404).json({ error: 'This QR link is not valid any more.' });
  if (!(req.sess && req.sess.via === 'login' && req.sess.role === 'admin')) setSession(req, res, { r: 'qr', p: p.id });
  res.json({ ok: true, label: p.label, code: p.code });
});

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (throttled(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const { username, password, role } = req.body || {};
  const u = db.users.find((x) => x.username.toLowerCase() === String(username || '').trim().toLowerCase());
  if (!u || !checkPw(u, password || '')) {
    attempts.get(ip).n++;
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  if (role === 'admin' && u.role !== 'admin') return res.status(403).json({ error: 'This account is not an admin account.' });
  attempts.delete(ip);
  setSession(req, res, { r: u.role, u: u.id });
  res.json({ ok: true, role: u.role });
});

app.post('/api/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

app.get('/api/catalog', needAuth, (req, res) => {
  const s = req.sess;
  res.set('Cache-Control', 'no-store');
  const models = [...db.models].sort((a, b) => a.number - b.number).map((m) => {
    const locked = isLocked(s, m);
    return {
      id: m.id, number: m.number, name: m.name, description: m.description, locked,
      image: imageInfo(m.files.image),
      working: videoInfo(m.files.working, locked),
      assembly: videoInfo(m.files.assembly, locked),
      busy: !locked && ['working', 'assembly'].some((s) => !m.files[s] && m.pending && m.pending[s] && m.pending[s].status === 'processing'),
    };
  });
  res.json({ models, logo: db.settings.logo ? '/brand/logo' : null, logoV: db.settings.logo ? db.settings.logo.file : null });
});

// media: images are public to any signed-in visitor (teaser); videos need the model to be unlocked
// maps a stored file name to its model and role: 'image' | 'poster' | 'rendition'
function findMedia(name) {
  for (const m of db.models) {
    if (m.files.image && m.files.image.file === name) return { m, kind: 'image', type: m.files.image.type };
    for (const s of ['working', 'assembly']) {
      const v = m.files[s];
      if (!v) continue;
      if ((v.posters || []).includes(name)) return { m, kind: 'poster', type: 'image/jpeg' };
      if ((v.renditions || []).some((r) => r.file === name)) return { m, kind: 'rendition', type: 'video/mp4' };
    }
  }
  return null;
}
app.get('/media/:file', needAuth, (req, res) => {
  const name = path.basename(req.params.file);
  const hit = findMedia(name);
  if (!hit) return res.status(404).end();
  if (hit.kind === 'rendition' && isLocked(req.sess, hit.m)) return res.status(403).end();
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  store.send(req, res, name, hit.type || 'application/octet-stream');
});

app.get('/brand/logo', (req, res) => {
  const l = db.settings.logo;
  if (!l) return res.status(404).end();
  res.set('Cache-Control', 'no-cache');
  store.send(req, res, l.file, l.type);
});

// ---------- admin ----------
const A = express.Router();
// "editor" = opened through an editor QR link: may manage models and upload media, nothing else
A.use(needStaff);
A.use(['/profiles', '/users', '/password', '/logo'], needAdmin);

const adminVideo = (m, s) => {
  const v = m.files[s];
  const p = m.pending && m.pending[s];
  if (!v && !p) return null;
  return {
    ready: !!(v && v.renditions && v.renditions.length),
    duration: v ? v.duration : 0,
    renditions: v ? v.renditions.map((r) => ({ q: r.q, h: r.h, size: r.size, url: '/media/' + r.file })) : [],
    posters: v ? v.posters.map((f) => '/media/' + f) : [],
    poster: v ? Math.min(v.poster == null ? v.posters.length - 1 : v.poster, v.posters.length - 1) : 0,
    pending: p ? { status: p.status, progress: p.progress || 0, error: p.error || null, name: p.name } : null,
  };
};
const adminModel = (m) => ({
  id: m.id, number: m.number, name: m.name, description: m.description,
  files: {
    image: m.files.image ? { url: '/media/' + m.files.image.file, size: m.files.image.size } : undefined,
    working: adminVideo(m, 'working') || undefined,
    assembly: adminVideo(m, 'assembly') || undefined,
  },
});
const adminProfile = (p, req) => ({ ...p, link: `${origin(req)}/q/${p.code}` });
const adminUserOut = (u) => ({ id: u.id, username: u.username, role: u.role, profileId: u.profileId });

A.get('/state', (req, res) => {
  res.json({
    models: [...db.models].sort((a, b) => a.number - b.number).map(adminModel),
    role: req.sess.role,
    profiles: req.sess.role === 'admin' ? db.profiles.map((p) => adminProfile(p, req)) : [],
    users: req.sess.role === 'admin' ? db.users.map(adminUserOut) : [],
    logo: !!db.settings.logo,
    me: req.sess.user ? req.sess.user.username : 'Editor link',
    storage: { kind: store.kind, cloudName: store.cloudName, bucket: store.bucketName },
    defaultPassword: !!req.sess.user && checkPw(req.sess.user, 'admin123'),
  });
});

const clean = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
const findModel = (id) => db.models.find((m) => m.id === id);
const rmName = (n) => store.remove(n);
const rmFile = (f) => f && rmName(f.file);
const rmVideo = (v) => { if (v) { (v.renditions || []).forEach((r) => rmName(r.file)); (v.posters || []).forEach(rmName); } };

// ---- video pipeline: every uploaded video is compressed to 2-3 qualities + thumbnail candidates ----
const jobs = new Map(); // `${modelId}:${slot}` -> running/queued job
const queue = [];
let working = false;
function cancelJob(m, slot) {
  const j = jobs.get(m.id + ':' + slot);
  if (j) { j.cancelled = true; if (j.child) j.child.kill('SIGKILL'); jobs.delete(m.id + ':' + slot); }
  const p = m.pending && m.pending[slot];
  if (p) { rmName(p.src); delete m.pending[slot]; }
}
function startJob(m, slot, srcName, origName, remote = false) {
  cancelJob(m, slot);
  m.pending = m.pending || {};
  m.pending[slot] = { id: rid(4), src: srcName, remote, status: 'processing', progress: 0, error: null, name: origName };
  const job = { modelId: m.id, slot, pid: m.pending[slot].id, cancelled: false, child: null };
  jobs.set(m.id + ':' + slot, job);
  queue.push(job);
  save();
  pump();
}
async function pump() {
  if (working) return;
  working = true;
  while (queue.length) await runJob(queue.shift());
  working = false;
}
// Cloudinary does the compression: we ask for the versions, wait until they exist, then record them
async function runCloudJob(job, pend) {
  const pid = pend.src;
  const info = await store.videoInfo(pid);
  if (!info.width || !info.height) throw new Error('This file does not look like a playable video.');
  const pl = store.plan(pid, info);
  await store.generate(pid, pl);
  const names = [...new Set([...pl.renditions, ...pl.posters].map((x) => x.file))];
  const t0 = Date.now();
  const done = new Set();
  while (done.size < names.length) {
    if (job.cancelled) throw new Error('cancelled');
    if (Date.now() - t0 > 45 * 60e3) throw new Error('Compression is taking too long - please upload again.');
    for (const n of names) {
      if (done.has(n)) continue;
      const st = await store.ready(n);
      if (st.state === 'ready') done.add(n);
      else if (st.state === 'error') throw new Error('Compression failed: ' + st.error);
    }
    pend.progress = 0.03 + 0.97 * (done.size / names.length);
    if (done.size < names.length) await new Promise((r) => setTimeout(r, 3000));
  }
  const sz = await store.sizes(pid, names);
  const landscape = info.width >= info.height;
  return {
    renditions: pl.renditions.map((r) => ({ q: r.q, file: r.file, size: sz[r.file] || 0, w: landscape ? Math.round((info.width / info.height) * r.h / 2) * 2 : r.h, h: r.h })),
    posters: [...new Set(pl.posters.map((p) => p.file))],
    duration: info.duration, width: info.width, height: info.height,
  };
}
async function runJob(job) {
  const m = findModel(job.modelId);
  const pend = m && m.pending && m.pending[job.slot];
  if (job.cancelled || !pend || pend.id !== job.pid) return;
  const src = path.join(UPLOADS, pend.src);
  const cloud = store.cloud && pend.remote;
  let ok = false;
  try {
    let made;
    if (cloud) made = await runCloudJob(job, pend);
    else {
      if (pend.remote) await store.fetchLocal(pend.src); // direct-to-bucket upload: pull it down for ffmpeg
      made = await video.processVideo({ src, outDir: UPLOADS, job, onProgress: (p) => { pend.progress = p; } });
    }
    if (job.cancelled || !m.pending || m.pending[job.slot] !== pend) { rmVideo(made); return; }
    if (!cloud) {
      // local: no-op. bucket: move the finished files into it
      try {
        await Promise.all([...made.renditions.map((r) => store.put(r.file, 'video/mp4')), ...made.posters.map((f) => store.put(f, 'image/jpeg'))]);
      } catch (e) { rmVideo(made); throw new Error('Could not save to storage: ' + e.message); }
      if (job.cancelled || !m.pending || m.pending[job.slot] !== pend) { rmVideo(made); return; }
    }
    rmVideo(m.files[job.slot]);
    m.files[job.slot] = { ...made, poster: made.posters.length - 1 };
    delete m.pending[job.slot];
    ok = true;
    if (!m.files.image && made.posters.length) await setImageFromPoster(m, made.posters[made.posters.length - 1]);
    console.log(`[video] ${m.name} / ${job.slot}: ${made.renditions.map((r) => `${r.q} ${(r.size / 1e6).toFixed(1)}MB`).join(', ')}`);
  } catch (e) {
    if (!job.cancelled && m.pending && m.pending[job.slot] === pend) { pend.status = 'error'; pend.error = e.message; }
  } finally {
    jobs.delete(job.modelId + ':' + job.slot);
    // local: the raw upload is always deleted. Cloudinary: it is the source of the compressed versions, so keep it unless the job failed
    if (!job.cancelled) { if (!(cloud && ok)) rmName(pend.src); pend.src = null; }
    save();
  }
}
async function setImageFromPoster(m, posterFile) {
  const f = 'lm_' + rid(8) + '.jpg';
  const size = await store.copy(posterFile, f);
  rmFile(m.files.image);
  m.files.image = { file: f, size, type: 'image/jpeg' };
}
// resume after a restart
for (const m of db.models) {
  for (const [slot, p] of Object.entries(m.pending || {})) {
    if (p.status === 'processing' && p.src && (p.remote || fs.existsSync(path.join(UPLOADS, p.src)))) {
      const job = { modelId: m.id, slot, pid: p.id, cancelled: false, child: null };
      jobs.set(m.id + ':' + slot, job); queue.push(job);
    } else if (p.status === 'processing') { p.status = 'error'; p.error = 'Interrupted - please upload again.'; }
  }
}
setImmediate(pump);

A.post('/models', (req, res) => {
  const name = clean(req.body.name, 120);
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const m = { id: rid(4), number: db.models.reduce((a, x) => Math.max(a, x.number), 0) + 1, name, description: clean(req.body.description, 1000), files: {} };
  db.models.push(m);
  save();
  res.json(adminModel(m));
});
A.patch('/models/:id', (req, res) => {
  const m = findModel(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (req.body.name !== undefined) { const n = clean(req.body.name, 120); if (!n) return res.status(400).json({ error: 'Name is required.' }); m.name = n; }
  if (req.body.description !== undefined) m.description = clean(req.body.description, 1000);
  if (req.body.number !== undefined && Number.isFinite(+req.body.number)) m.number = Math.round(+req.body.number);
  save();
  res.json(adminModel(m));
});
A.delete('/models/:id', (req, res) => {
  const m = findModel(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  ['working', 'assembly'].forEach((s) => cancelJob(m, s));
  rmFile(m.files.image); rmVideo(m.files.working); rmVideo(m.files.assembly);
  db.models = db.models.filter((x) => x !== m);
  db.profiles.forEach((p) => { p.allowed = p.allowed.filter((id) => id !== m.id); });
  save();
  res.json({ ok: true });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => cb(null, 'lm_' + rid(8) + (path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '')),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});
const SLOT_TYPE = { image: 'image/', working: 'video/', assembly: 'video/' };

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|3gp|mpg|mpeg|wmv|ts|mts|m2ts)$/i;
A.get('/models/:id', (req, res) => {
  const m = findModel(req.params.id);
  return m ? res.json(adminModel(m)) : res.status(404).json({ error: 'Not found' });
});
A.post('/models/:id/file/:slot', upload.single('file'), async (req, res, next) => {
  try {
    const f = req.file;
    const bin = () => f && fs.rm(f.path, { force: true }, () => {});
    const m = findModel(req.params.id);
    const t = SLOT_TYPE[req.params.slot];
    if (!m || !t) { bin(); return res.status(404).json({ error: 'Not found' }); }
    if (!f) return res.status(400).json({ error: 'No file received.' });
    const isImage = t === 'image/';
    if (!(isImage ? f.mimetype.startsWith('image/') : f.mimetype.startsWith('video/') || VIDEO_EXT.test(f.originalname))) {
      bin();
      return res.status(400).json({ error: `Please choose a${isImage ? 'n image' : ' video'} file.` });
    }
    if (isImage) {
      let rec;
      if (store.cloud) {
        // Cloudinary shrinks it to a light JPEG on upload
        const r = await store.put(path.basename(f.path), f.mimetype, { photo: true });
        rec = { file: r.name, size: r.size, type: 'image/jpeg' };
      } else {
        // shrink to a light JPEG up front
        const out = 'lm_' + rid(8) + '.jpg';
        const ok = await video.optimizeImage(f.path, path.join(UPLOADS, out));
        if (ok) { bin(); rec = { file: out, size: fs.statSync(path.join(UPLOADS, out)).size, type: 'image/jpeg' }; }
        else rec = { file: path.basename(f.path), size: f.size, type: f.mimetype };
        await store.put(rec.file, rec.type); // no-op for local disk, uploads to the bucket otherwise
      }
      rmFile(m.files.image);
      m.files.image = rec;
      save();
    } else {
      startJob(m, req.params.slot, path.basename(f.path), f.originalname);
    }
    res.json(adminModel(m));
  } catch (e) { next(e); }
});
// Direct video upload (STORAGE=cloudinary or gcs): the browser sends the file straight to Cloudinary / the bucket,
// so it never passes through Cloud Run (which caps request bodies at 32 MB). Then it is compressed (by Cloudinary, or by ffmpeg here).
const issued = new Map(); // video id -> { modelId, slot, filename, exp }
A.post('/models/:id/upload-url/:slot', async (req, res, next) => {
  try {
    const m = findModel(req.params.id);
    const slot = req.params.slot;
    if (!m || !SLOT_TYPE[slot] || slot === 'image') return res.status(404).json({ error: 'Not found' });
    if (!store.remote) return res.json({ direct: false });
    const filename = clean(req.body.filename, 200);
    if (!VIDEO_EXT.test(filename) && !String(req.body.type || '').startsWith('video/')) return res.status(400).json({ error: 'Please choose a video file.' });
    if (Number(req.body.size) > MAX_UPLOAD_MB * 1024 * 1024) return res.status(400).json({ error: `File is larger than ${MAX_UPLOAD_MB} MB.` });
    for (const [k, v] of issued) if (v.exp < Date.now()) issued.delete(k);
    const pid = 'lm_' + rid(8);
    issued.set(pid, { modelId: m.id, slot, filename, exp: Date.now() + 6 * 3600e3 });
    if (store.cloud) return res.json({ direct: true, cloud: store.uploadParams(pid), key: pid });
    // bucket: a resumable-upload session; the browser PUTs the raw file to it
    const name = pid + (path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.mp4');
    issued.delete(pid);
    issued.set(name, { modelId: m.id, slot, filename, exp: Date.now() + 6 * 3600e3 });
    const url = await store.directUploadUrl(name, String(req.body.type || 'video/mp4'), req.get('origin') || origin(req));
    res.json({ direct: true, url, key: name });
  } catch (e) { next(e); }
});
A.post('/models/:id/file/:slot/complete', async (req, res, next) => {
  try {
    const m = findModel(req.params.id);
    const slot = req.params.slot;
    const key = String(req.body.key || '');
    const grant = issued.get(key);
    if (!m || !grant || grant.modelId !== m.id || grant.slot !== slot) return res.status(404).json({ error: 'Upload not found - please try again.' });
    issued.delete(key);
    const st = await store.stat(key);
    if (!st || !st.size) return res.status(400).json({ error: 'The upload did not finish - please try again.' });
    if (st.size > MAX_UPLOAD_MB * 1024 * 1024) { store.remove(key); return res.status(400).json({ error: `File is larger than ${MAX_UPLOAD_MB} MB.` }); }
    startJob(m, slot, key, grant.filename, true);
    res.json(adminModel(m));
  } catch (e) { next(e); }
});
A.delete('/models/:id/file/:slot', (req, res) => {
  const m = findModel(req.params.id);
  const slot = req.params.slot;
  if (!m || !SLOT_TYPE[slot]) return res.status(404).json({ error: 'Not found' });
  if (slot === 'image') { rmFile(m.files.image); delete m.files.image; }
  else { cancelJob(m, slot); rmVideo(m.files[slot]); delete m.files[slot]; }
  save();
  res.json(adminModel(m));
});
A.post('/models/:id/poster/:slot', async (req, res, next) => {
  try {
    const m = findModel(req.params.id);
    const v = m && m.files[req.params.slot];
    if (!v || !v.posters) return res.status(404).json({ error: 'Not found' });
    const i = Math.round(+req.body.index);
    if (!(i >= 0 && i < v.posters.length)) return res.status(400).json({ error: 'Bad thumbnail' });
    v.poster = i;
    if (req.body.useAsFolderImage) await setImageFromPoster(m, v.posters[i]);
    save();
    res.json(adminModel(m));
  } catch (e) { next(e); }
});

// QR access profiles: each QR code opens the library with its own set of unlocked models
const validIds = (ids) => (Array.isArray(ids) ? ids.filter((id) => findModel(id)) : []);
A.post('/profiles', (req, res) => {
  const p = { id: rid(4), code: rid(5), label: clean(req.body.label, 60) || 'New QR', mode: req.body.mode === 'custom' ? 'custom' : 'all', allowed: validIds(req.body.allowed), editor: req.body.editor === true };
  db.profiles.push(p);
  save();
  res.json(adminProfile(p, req));
});
A.patch('/profiles/:id', (req, res) => {
  const p = profileOf(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (req.body.label !== undefined) p.label = clean(req.body.label, 60) || p.label;
  if (req.body.mode) p.mode = req.body.mode === 'custom' ? 'custom' : 'all';
  if (req.body.allowed) p.allowed = validIds(req.body.allowed);
  if (req.body.editor !== undefined) p.editor = req.body.editor === true;
  save();
  res.json(adminProfile(p, req));
});
A.delete('/profiles/:id', (req, res) => {
  const p = profileOf(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  db.profiles = db.profiles.filter((x) => x !== p);
  db.users.forEach((u) => { if (u.profileId === p.id) u.profileId = null; });
  save();
  res.json({ ok: true });
});
A.get('/profiles/:id/qr.png', async (req, res) => {
  const p = profileOf(req.params.id);
  if (!p) return res.status(404).end();
  const size = Math.min(2000, Math.max(128, parseInt(req.query.size, 10) || 480));
  const png = await QRCode.toBuffer(`${origin(req)}/q/${p.code}`, { width: size, margin: 2, errorCorrectionLevel: 'M' });
  if (req.query.download) res.set('Content-Disposition', `attachment; filename="qr-${p.label.replace(/[^\w-]+/g, '_')}.png"`);
  res.set('Cache-Control', 'no-store').type('png').send(png);
});

// users
A.post('/users', (req, res) => {
  const username = clean(req.body.username, 40);
  const password = String(req.body.password || '');
  if (!username || password.length < 4) return res.status(400).json({ error: 'Enter a username and a password of at least 4 characters.' });
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'That username is taken.' });
  const u = { id: rid(4), username, role: req.body.role === 'admin' ? 'admin' : 'user', profileId: profileOf(req.body.profileId) ? req.body.profileId : null, ...hashPw(password) };
  db.users.push(u);
  save();
  res.json(adminUserOut(u));
});
A.patch('/users/:id', (req, res) => {
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (req.body.password) {
    if (String(req.body.password).length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    Object.assign(u, hashPw(req.body.password));
  }
  if (req.body.profileId !== undefined) u.profileId = profileOf(req.body.profileId) ? req.body.profileId : null;
  save();
  res.json(adminUserOut(u));
});
A.delete('/users/:id', (req, res) => {
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (u.id === req.sess.user.id) return res.status(400).json({ error: 'You cannot delete the account you are using.' });
  db.users = db.users.filter((x) => x !== u);
  save();
  res.json({ ok: true });
});
A.post('/password', (req, res) => {
  const { current, next } = req.body || {};
  if (!checkPw(req.sess.user, current || '')) return res.status(400).json({ error: 'Current password is wrong.' });
  if (String(next || '').length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  Object.assign(req.sess.user, hashPw(next));
  save();
  res.json({ ok: true });
});

// brand logo (replaces the built-in Luminary wordmark)
A.post('/logo', upload.single('file'), async (req, res, next) => {
  try {
    const f = req.file;
    // SVG can carry scripts and /brand/logo is same-origin, so only raster formats are accepted
    if (!f || !/^image\/(png|jpe?g|webp|gif)$/.test(f.mimetype)) { if (f) fs.rm(f.path, { force: true }, () => {}); return res.status(400).json({ error: 'Please choose a PNG, JPG or WebP image.' }); }
    const r = await store.put(path.basename(f.path), f.mimetype);
    rmFile(db.settings.logo);
    db.settings.logo = { file: r.name, type: f.mimetype, size: r.size || f.size };
    save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});
A.delete('/logo', (req, res) => { rmFile(db.settings.logo); db.settings.logo = null; save(); res.json({ ok: true }); });

app.use('/api/admin', A);

// ---------- optional: serve the frontend too (local development only) ----------
// In production the frontend is deployed separately (Firebase Hosting) and forwards /api, /media, /brand here.
const PUB = path.resolve(process.env.FRONTEND_DIR || path.join(__dirname, '..', 'frontend'));
if (fs.existsSync(path.join(PUB, 'index.html'))) {
  app.use(express.static(PUB, { index: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
  const spa = (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(PUB, 'index.html'));
  app.get(['/', '/q/:code'], spa);
}
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${MAX_UPLOAD_MB} MB.` : err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

Promise.all(seedUploads).then(() => {
  const server = app.listen(PORT, () => console.log(`Luminary running on port ${PORT}  (storage: ${store.cloud ? 'Cloudinary ' + store.cloudName : store.gcs ? 'gs://' + store.bucketName : DATA_DIR})`));
  // Cloud Run sends SIGTERM before stopping the container: make sure db.json reached remote storage
  process.on('SIGTERM', () => { server.close(); store.flush().finally(() => process.exit(0)); });
}).catch((e) => { console.error('Could not upload seed images:', e); process.exit(1); });
