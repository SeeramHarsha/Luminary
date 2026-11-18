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
const { DATA_DIR, UPLOADS } = store; // with STORAGE=gcs UPLOADS is only a scratch folder
const DB_FILE = path.join(DATA_DIR, 'db.json');
// Videos live on YouTube: the admin pastes a link and visitors watch it in an embedded player.
// Pulls the 11-character video id out of any usual YouTube link (watch, youtu.be, shorts, embed, live) or a bare id.
function youtubeId(input) {
  const t = String(input || '').trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  let u;
  try { u = new URL(/^https?:\/\//i.test(t) ? t : 'https://' + t); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = /^\/(embed|shorts|live|v)\/([\w-]{11})/.exec(u.pathname); if (m) id = m[2]; }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}
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
// usage counters are saved a few seconds after the last change (many small events, one write)
let saveTimer = null;
const saveSoon = () => { if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; save(); }, 10000); };
const seedUploads = []; // seed photos that still have to reach the bucket
// every school (access profile) has a unique 4-digit code that visitors type on the sign-in screen
function genPin() {
  const used = new Set(db.profiles.map((p) => p.pin));
  for (let i = 0; i < 2000; i++) {
    const pin = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    if (!used.has(pin)) return pin;
  }
  throw new Error('All 10000 school codes are in use.');
}
function seedDb() {
  db = { models: [], profiles: [], users: [], settings: { logo: null } };
  SEED.forEach(([name, description], i) => {
    const m = { id: rid(4), number: i + 1, name, description, files: {} };
    const src = path.join(__dirname, 'seed-images', `m${String(i + 1).padStart(2, '0')}.jpg`);
    if (fs.existsSync(src)) {
      const file = 'lm_' + rid(8) + '.jpg';
      fs.copyFileSync(src, path.join(UPLOADS, file));
      seedUploads.push(store.put(file, 'image/jpeg'));
      m.files.image = { file, size: fs.statSync(src).size, type: 'image/jpeg' };
    }
    db.models.push(m);
  });
  db.profiles.push({ id: rid(4), code: rid(5), pin: genPin(), label: 'All models', mode: 'all', allowed: [], created: Date.now() });
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
// profiles made before school codes existed get one (editor links never get a code: they are QR-only)
if (db.profiles.some((p) => !p.editor && !p.pin)) { db.profiles.forEach((p) => { if (!p.editor && !p.pin) p.pin = genPin(); }); save(); }

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

  // No school code, QR or login yet: nothing is unlocked until the visitor enters a school code
  return { role: 'viewer', via: 'guest', profile: null };
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
const needAuth = (req, res, next) => (req.sess && req.sess.via !== 'guest' ? next() : res.status(401).json({ error: 'Please enter your school code.' }));
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
function videoInfo(v, locked, cover) {
  if (!v || locked) return null;
  // YouTube video: the player embeds it (the cover image, if any, is shown until the visitor taps play)
  if (v.youtube) return { youtube: v.youtube, duration: 0, poster: cover ? '/media/' + cover.file : null, renditions: [] };
  if (!v.renditions || !v.renditions.length) return null;
  const p = selectedPoster(v);
  return {
    // the admin's own cover image wins over a frame taken from the video
    duration: v.duration, poster: cover ? '/media/' + cover.file : p ? '/media/' + p : null,
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

// School code sign-in: 4 digits -> the same access a QR code of that school gives
const schoolFails = { n: 0, t: Date.now() };
app.post('/api/school', (req, res) => {
  const now = Date.now();
  if (now - schoolFails.t > 10 * 60e3) { schoolFails.n = 0; schoolFails.t = now; }
  const key = 'school:' + req.ip;
  // per visitor: 10 wrong codes per 10 minutes; for the whole site: 200 (guessing all 10000 codes must stay slow)
  if (throttled(key) || schoolFails.n >= 200) return res.status(429).json({ error: 'Too many wrong codes. Please try again in a few minutes.' });
  const code = String((req.body || {}).code || '').trim();
  const p = /^\d{4}$/.test(code) ? db.profiles.find((x) => x.pin === code && !x.editor) : null;
  if (!p) { attempts.get(key).n++; schoolFails.n++; return res.status(404).json({ error: 'That school code is not correct. Please check it and try again.' }); }
  attempts.delete(key);
  setSession(req, res, { r: 'qr', p: p.id });
  res.json({ ok: true, label: p.label, code: p.code });
});

// ---------- usage tracking (per school, counters only: no names, no personal data) ----------
// db.stats[profileId] = { visits, views, plays, seconds, first, last, days: { 'YYYY-MM-DD': { v, w, p, s, m: { modelId: [views, plays] } } } }
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const lastSeen = new Map(); // 'profile:ip' -> { visit, ping } timestamps, keeps counters honest
function trackedProfile(sess) {
  // only school visitors count: not guests, admins or editors
  if (!sess || sess.via === 'guest' || !sess.profile) return null;
  return sess.role === 'viewer' || sess.role === 'user' ? sess.profile.id : null;
}
app.post('/api/track', (req, res) => {
  res.json({ ok: true });
  const pid = trackedProfile(req.sess);
  if (!pid) return;
  const { type, m, slot, d: dev } = req.body || {};
  const now = Date.now();
  db.stats = db.stats || {};
  const st = db.stats[pid] || (db.stats[pid] = { visits: 0, views: 0, plays: 0, seconds: 0, first: now, last: now, days: {} });
  const key = pid + ':' + (typeof dev === 'string' && /^[\w-]{8,40}$/.test(dev) ? dev : req.ip); // per device, so visitors sharing one network are not mixed up
  const seen = lastSeen.get(key) || {};
  const dk = dayKey(now);
  const day = st.days[dk] || (st.days[dk] = { v: 0, w: 0, p: 0, s: 0, m: {} });
  const model = typeof m === 'string' && findModel(m) ? m : null;
  if (type === 'visit') {
    if (seen.visit && now - seen.visit < 30 * 60e3) return; // reloads within 30 minutes are the same visit
    seen.visit = now; st.visits++; day.v++;
  } else if (type === 'view') {
    st.views++; day.w++;
    if (model) { const e = day.m[model] || (day.m[model] = [0, 0]); e[0]++; }
  } else if (type === 'play') {
    st.plays++; day.p++;
    if (model) { const e = day.m[model] || (day.m[model] = [0, 0]); e[1]++; }
  } else if (type === 'ping') {
    // time spent: the page pings every 30 s while someone is really using it
    if (seen.ping && now - seen.ping < 20000) return; // pings come every 30 s; anything faster is ignored
    const add = seen.ping ? Math.min(35, Math.round((now - seen.ping) / 1000)) : 15; // first ping of a visit counts half an interval
    seen.ping = now; st.seconds += add; day.s += add;
    if (model) { const e = day.m[model] || (day.m[model] = [0, 0]); e[2] = (e[2] || 0) + add; } // time spent on this model's page
  } else return;
  st.last = now;
  lastSeen.set(key, seen);
  const old = Object.keys(st.days).sort();
  if (old.length > 400) old.slice(0, old.length - 400).forEach((d) => delete st.days[d]);
  saveSoon();
});

app.post('/api/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

// the school's own calendar, per model: 'now' (its dates are running), 'next', 'overdue' = delayed (dates over, not opened) or 'done' (opened)
function planFor(sess) {
  const pid = trackedProfile(sess);
  const p = pid && profileOf(pid);
  if (!p || !(p.calendar || []).length) return null;
  const rank = { now: 0, overdue: 1, next: 2, done: 3 };
  const map = new Map();
  for (const e of calendarReport(p).entries) {
    const note = e.note || (e.grade ? `Grade ${e.grade}${e.chapter ? ' \u00b7 ' + e.chapter : ''}${e.type ? ' \u00b7 ' + e.type : ''}` : '');
    for (const it of e.items) {
      const state = it.status === 'due' ? 'now' : it.status === 'upcoming' ? 'next' : it.status === 'missed' ? 'overdue' : 'done'; // opened late still counts as opened
      const prev = map.get(it.model);
      if (!prev || rank[state] < rank[prev.state] || (state === prev.state && e.from < prev.from)) map.set(it.model, { from: e.from, to: e.to, state, note, days: it.status === 'missed' ? it.delayDays : 0 });
    }
  }
  return map;
}
app.get('/api/catalog', needAuth, (req, res) => {
  const s = req.sess;
  res.set('Cache-Control', 'no-store');
  const plans = planFor(s);
  const models = [...db.models].sort((a, b) => a.number - b.number).map((m) => {
    const locked = isLocked(s, m);
    return {
      id: m.id, number: m.number, name: m.name, description: m.description, locked,
      image: imageInfo(m.files.image),
      working: videoInfo(m.files.working, locked, (m.covers || {}).working),
      assembly: videoInfo(m.files.assembly, locked, (m.covers || {}).assembly),
      busy: !locked && ['working', 'assembly'].some((s) => !m.files[s] && m.pending && m.pending[s] && m.pending[s].status === 'processing'),
      plan: (plans && plans.get(m.id)) || null,
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
      const c = (m.covers || {})[s];
      if (c && c.file === name) return { m, kind: 'image', type: c.type };
      const v = m.files[s];
      if (!v) continue;
      if ((v.posters || []).includes(name)) return { m, kind: 'poster', type: 'image/jpeg' };
      if ((v.renditions || []).some((r) => r.file === name)) return { m, kind: 'rendition', type: (v.renditions.find((r) => r.file === name) || {}).type || 'video/mp4' };
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
A.use(['/profiles', '/users', '/password', '/logo', '/usage', '/usage.csv', '/calendar', '/calendar.csv'], needAdmin);

const adminVideo = (m, s) => {
  const v = m.files[s];
  const p = m.pending && m.pending[s];
  if (!v && !p) return null;
  return {
    ready: !!(v && ((v.renditions && v.renditions.length) || v.youtube)),
    youtube: v && v.youtube ? v.youtube : undefined,
    duration: v ? v.duration : 0,
    renditions: v && v.renditions ? v.renditions.map((r) => ({ q: r.q, h: r.h, size: r.size, url: '/media/' + r.file })) : [],
    posters: v && v.posters ? v.posters.map((f) => '/media/' + f) : [],
    poster: v && v.posters ? Math.min(v.poster == null ? v.posters.length - 1 : v.poster, v.posters.length - 1) : 0,
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
  // cover image shown on the video itself (separate from the folder image)
  covers: Object.fromEntries(['working', 'assembly'].map((k) => [k, (m.covers || {})[k] ? { url: '/media/' + m.covers[k].file, size: m.covers[k].size } : undefined])),
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
    storage: { kind: store.kind, bucket: store.bucketName },
    defaultPassword: !!req.sess.user && checkPw(req.sess.user, 'admin123'),
  });
});

const clean = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
const findModel = (id) => db.models.find((m) => m.id === id);
const rmName = (n) => store.remove(n);
const rmFile = (f) => f && rmName(f.file);
const rmVideo = (v) => { if (v) { (v.renditions || []).forEach((r) => rmName(r.file)); (v.posters || []).forEach(rmName); } };

// ---- videos: a YouTube link per slot (older uploaded files keep playing until they are replaced) ----
for (const m of db.models) delete m.pending; // older versions queued compression jobs

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
  rmFile(m.files.image); rmVideo(m.files.working); rmVideo(m.files.assembly);
  Object.values(m.covers || {}).forEach(rmFile);
  db.models = db.models.filter((x) => x !== m);
  db.profiles.forEach((p) => { p.allowed = p.allowed.filter((id) => id !== m.id); p.calendar = (p.calendar || []).filter((e) => e.model !== m.id); });
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
    if (!isImage) { bin(); return res.status(400).json({ error: 'Videos are added with a YouTube link.' }); }
    if (!f.mimetype.startsWith('image/')) { bin(); return res.status(400).json({ error: 'Please choose an image file.' }); }
    if (isImage) {
      // shrink to a light JPEG up front
      const out = 'lm_' + rid(8) + '.jpg';
      const ok = await video.optimizeImage(f.path, path.join(UPLOADS, out));
      let rec;
      if (ok) { bin(); rec = { file: out, size: fs.statSync(path.join(UPLOADS, out)).size, type: 'image/jpeg' }; }
      else rec = { file: path.basename(f.path), size: f.size, type: f.mimetype };
      await store.put(rec.file, rec.type); // no-op for local disk, uploads to the bucket otherwise
      rmFile(m.files.image);
      m.files.image = rec;
      save();
    }
    res.json(adminModel(m));
  } catch (e) { next(e); }
});
// Add or replace the YouTube video of a slot (working / assembly)
A.put('/models/:id/youtube/:slot', (req, res) => {
  const m = findModel(req.params.id);
  const slot = req.params.slot;
  if (!m || !['working', 'assembly'].includes(slot)) return res.status(404).json({ error: 'Not found' });
  const id = youtubeId(req.body.url);
  if (!id) return res.status(400).json({ error: 'That does not look like a YouTube link. Paste the video link from YouTube (Share > Copy).' });
  rmVideo(m.files[slot]);
  m.files[slot] = { youtube: id, renditions: [], posters: [], duration: 0, poster: -1 };
  save();
  res.json(adminModel(m));
});
A.delete('/models/:id/file/:slot', (req, res) => {
  const m = findModel(req.params.id);
  const slot = req.params.slot;
  if (!m || !SLOT_TYPE[slot]) return res.status(404).json({ error: 'Not found' });
  if (slot === 'image') { rmFile(m.files.image); delete m.files.image; }
  else { rmVideo(m.files[slot]); delete m.files[slot]; }
  save();
  res.json(adminModel(m));
});
// QR access profiles: each QR code opens the library with its own set of unlocked models
const validIds = (ids) => (Array.isArray(ids) ? ids.filter((id) => findModel(id)) : []);
A.post('/profiles', (req, res) => {
  const p = { id: rid(4), code: rid(5), label: clean(req.body.label, 60) || 'New school', mode: req.body.mode === 'custom' ? 'custom' : 'all', allowed: validIds(req.body.allowed), editor: req.body.editor === true, created: Date.now() };
  p.pin = p.editor ? null : genPin();
  db.profiles.push(p);
  save();
  res.json(adminProfile(p, req));
});
A.patch('/profiles/:id', (req, res) => {
  const p = profileOf(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  // check the school code first so a bad code changes nothing
  const wantPin = req.body.pin !== undefined && String(req.body.pin).trim() !== '' ? String(req.body.pin).trim() : null;
  if (wantPin !== null) {
    if (!/^\d{4}$/.test(wantPin)) return res.status(400).json({ error: 'The school code must be exactly 4 digits.' });
    if (db.profiles.some((x) => x !== p && x.pin === wantPin)) return res.status(409).json({ error: 'That code is already used by another school.' });
  }
  if (req.body.label !== undefined) p.label = clean(req.body.label, 60) || p.label;
  if (req.body.mode) p.mode = req.body.mode === 'custom' ? 'custom' : 'all';
  if (req.body.allowed) p.allowed = validIds(req.body.allowed);
  if (req.body.editor !== undefined) p.editor = req.body.editor === true;
  if (p.editor) p.pin = null; // editor links are QR-only: a 4-digit code must never grant editing
  else if (req.body.regenPin) p.pin = genPin();
  else if (wantPin !== null) p.pin = wantPin;
  else if (!p.pin) p.pin = genPin();
  save();
  res.json(adminProfile(p, req));
});
A.delete('/profiles/:id', (req, res) => {
  const p = profileOf(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  db.profiles = db.profiles.filter((x) => x !== p);
  if (db.stats) delete db.stats[p.id];
  db.users.forEach((u) => { if (u.profileId === p.id) u.profileId = null; });
  save();
  res.json({ ok: true });
});
// ---------- academic calendar per school ----------
// profile.calendar = [{ id, models: [modelId], from, to, grade?, chapter?, type?, line?, what?, slot?, note? }]: one row per teaching
// session of the school's plan (like the school's PDF): which kits, for which grade/chapter, in which dates.
// profile.calendarInfo = { heading, subtitle, intro, mappings, gaps, collect, skus } holds the plan's header and notes.
// Compared with the usage counters to tell whether each kit was opened in time. Dates are UTC days (like the usage counters).
const isDate = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(Date.parse(x + 'T00:00:00Z')) && new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) === x;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const OPENED = ['done', 'early', 'late'];
function calendarReport(p, today = dayKey()) {
  const days = ((db.stats || {})[p.id] || {}).days || {};
  const act = {}; // model -> [[day, views, plays]]
  for (const [d, x] of Object.entries(days)) for (const [mid, [v, pl, sec]] of Object.entries(x.m || {})) if (v || pl || sec) (act[mid] = act[mid] || []).push([d, v, pl, sec || 0]);
  // status of one kit inside the dates of one session
  const itemOf = (id, from, to) => {
    // a kit is 'opened' only when it was opened inside the month(s) of this session; a kit shared with other sessions
    // is not counted as opened here because it was opened in another month
    let views = 0; let plays = 0; let seconds = 0; let firstIn = null;
    for (const [d, v, pl, sec] of act[id] || []) {
      if (d >= from && d <= to) { views += v; plays += pl; seconds += sec; if ((v || pl) && (!firstIn || d < firstIn)) firstIn = d; }
    }
    let status;
    if (firstIn) status = 'done';
    else if (today < from) status = 'upcoming';
    else if (today <= to) status = 'due'; // its month is running and it has not been opened yet
    else status = 'missed'; // 'missed' is shown as Delayed: month over, never opened
    const m = findModel(id);
    return { model: id, number: m ? m.number : 0, name: m ? m.name : 'Removed model', status, delayDays: 0, views, plays, seconds, first: firstIn };
  };
  const entries = (p.calendar || []).map((e) => {
    const ids = e.models || (e.model ? [e.model] : []);
    const items = ids.map((id) => itemOf(id, e.from, e.to)).sort((x, y) => x.number - y.number);
    const every = (f) => items.length > 0 && items.every(f);
    let status; // the session as a whole
    if (every((i) => i.status === 'done' || i.status === 'early')) status = every((i) => i.status === 'early') ? 'early' : 'done';
    else if (items.some((i) => i.status === 'missed')) status = 'missed';
    else if (every((i) => OPENED.includes(i.status))) status = 'late';
    else status = today < e.from ? 'upcoming' : 'due';
    const firsts = items.map((i) => i.first).filter(Boolean).sort();
    return {
      id: e.id, from: e.from, to: e.to, grade: e.grade || null, chapter: e.chapter || '', type: e.type || '', line: e.line || '', what: e.what || '', slot: e.slot || '', note: e.note || '',
      status, total: items.length, opened: items.filter((i) => OPENED.includes(i.status)).length,
      views: items.reduce((t, i) => t + i.views, 0), plays: items.reduce((t, i) => t + i.plays, 0), seconds: items.reduce((t, i) => t + i.seconds, 0),
      delayDays: Math.max(0, ...items.map((i) => i.delayDays)), first: firsts[0] || null, items,
    };
  }).sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : (x.grade || 0) - (y.grade || 0)));
  const n = (k) => entries.filter((e) => e.status === k).length;
  return { entries, info: p.calendarInfo || null, summary: { total: entries.length, opened: n('done') + n('early') + n('late'), late: n('late'), missed: n('missed'), due: n('due'), upcoming: n('upcoming') } };
}
const schoolOf = (id) => { const p = profileOf(id); return p && !p.editor ? p : null; };
const planModels = (p) => [...db.models].sort((a, b) => a.number - b.number).filter((m) => p.mode === 'all' || (p.allowed || []).includes(m.id));
const canOpen = (p, modelId) => !!findModel(modelId) && (p.mode === 'all' || (p.allowed || []).includes(modelId));
function checkDates(from, to) {
  if (!isDate(from) || !isDate(to)) return 'Please choose both dates.';
  if (to < from) return 'The end date must not be before the start date.';
  return null;
}
A.get('/calendar', (req, res) => {
  const today = dayKey();
  const schools = db.profiles.filter((p) => !p.editor).map((p) => ({ id: p.id, label: p.label, pin: p.pin, ...calendarReport(p, today) }));
  res.json({ today, schools, models: [...db.models].sort((a, b) => a.number - b.number).map((m) => ({ id: m.id, number: m.number, name: m.name })) });
});
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthsText = (from, to) => { const a = MONTH_NAMES[+from.slice(5, 7) - 1] + ' ' + from.slice(0, 4); return from.slice(0, 7) === to.slice(0, 7) ? a : a + ' - ' + MONTH_NAMES[+to.slice(5, 7) - 1] + ' ' + to.slice(0, 4); };
const monthStart = (d, add) => { const t = new Date(d + 'T00:00:00Z'); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + add, 1)).toISOString().slice(0, 10); };
const monthEndOf = (d, add) => { const t = new Date(d + 'T00:00:00Z'); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + add + 1, 0)).toISOString().slice(0, 10); };
A.get('/calendar.csv', (req, res) => {
  const today = dayKey();
  const label = { done: 'Opened in time', early: 'Opened before its dates', due: 'Due now - not opened', upcoming: 'Upcoming', late: 'Opened late (delayed)', missed: 'Delayed - not opened' };
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [['School', 'School code', 'Month', 'Grade', 'Chapter', 'Type', 'Line', 'Model no.', 'Model', 'Status', 'First opened (month)', 'Minutes spent', 'Slot'].map(q).join(',')];
  for (const p of db.profiles.filter((x) => !x.editor)) {
    for (const e of calendarReport(p, today).entries) for (const i of e.items) lines.push([p.label, p.pin, monthsText(e.from, e.to), e.grade || '', e.chapter, e.type, e.line, i.number, i.name, label[i.status], (i.first || '').slice(0, 7), Math.round((i.seconds || 0) / 60), e.slot].map(q).join(','));
  }
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="luminary-calendar-status.csv"' }).send('\ufeff' + lines.join('\r\n'));
});
// the school's own calendar (same layout as its plan), for visitors signed in with the school code or QR
app.get('/api/plan', needAuth, (req, res) => {
  const pid = trackedProfile(req.sess);
  const p = pid && profileOf(pid);
  if (!p || !(p.calendar || []).length) return res.status(404).json({ error: 'Your school has no calendar yet.' });
  res.set('Cache-Control', 'no-store');
  res.json({ school: p.label, today: dayKey(), ...calendarReport(p) });
});
A.post('/profiles/:id/calendar', (req, res) => {
  const p = schoolOf(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (!canOpen(p, b.model)) return res.status(400).json({ error: 'Choose a model this school can open.' });
  const err = checkDates(b.from, b.to);
  if (err) return res.status(400).json({ error: err });
  p.calendar = p.calendar || [];
  if (p.calendar.length >= 600) return res.status(400).json({ error: 'A calendar can have up to 600 rows.' });
  p.calendar.push({ id: rid(4), models: [b.model], from: b.from, to: b.to, note: clean(b.note, 300) });
  save();
  res.json({ ok: true });
});
A.patch('/profiles/:id/calendar/:eid', (req, res) => {
  const p = schoolOf(req.params.id);
  const e = p && (p.calendar || []).find((x) => x.id === req.params.eid);
  if (!e) return res.status(404).json({ error: 'Not found' });
  const from = req.body.from || e.from;
  const to = req.body.to || e.to;
  const err = checkDates(from, to);
  if (err) return res.status(400).json({ error: err });
  e.from = from; e.to = to;
  if (req.body.note !== undefined) e.note = clean(req.body.note, 300);
  save();
  res.json({ ok: true });
});
A.delete('/profiles/:id/calendar/:eid', (req, res) => {
  const p = schoolOf(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  p.calendar = (p.calendar || []).filter((x) => x.id !== req.params.eid);
  save();
  res.json({ ok: true });
});
// import a whole plan from a file (creates the school if needed and replaces its calendar):
// { school, mode?, heading?, subtitle?, intro?, mappings?, gaps?, collect?, skus?: [{ code, model, type }],
//   sessions: [{ grade, chapter, type, line, models: [model numbers], what, slot, from, to }] }   (older files with "entries" still work)
A.post('/calendar/import', (req, res) => {
  const b = req.body || {};
  const name = clean(b.school, 60);
  if (!name) return res.status(400).json({ error: 'The file has no school name.' });
  const list = Array.isArray(b.sessions) ? b.sessions : Array.isArray(b.entries) ? b.entries : [];
  if (!list.length || list.length > 600) return res.status(400).json({ error: 'The file must contain between 1 and 600 calendar rows.' });
  const byNumber = new Map(db.models.map((m) => [m.number, m]));
  const rows = [];
  const skipped = new Set();
  for (let i = 0; i < list.length; i++) {
    const e = list[i] || {};
    const err = checkDates(e.from, e.to);
    if (err) return res.status(400).json({ error: `Row ${i + 1}: ${err}` });
    const nums = Array.isArray(e.models) ? e.models : e.model != null ? [e.model] : [];
    const ids = [];
    for (const num of nums) { const m = byNumber.get(Number(num)); if (m) ids.push(m.id); else skipped.add(Number(num)); }
    if (!ids.length) continue;
    rows.push({ id: rid(4), models: [...new Set(ids)], from: e.from, to: e.to, grade: Number(e.grade) || null, chapter: clean(e.chapter, 200), type: clean(e.type, 20).toLowerCase(), line: clean(e.line, 20), what: clean(e.what, 300), slot: clean(e.slot, 200), note: clean(e.note, 300) });
  }
  if (!rows.length) return res.status(400).json({ error: 'None of the models in the file exist here.' });
  let p = db.profiles.find((x) => !x.editor && x.label.toLowerCase() === name.toLowerCase());
  const created = !p;
  if (!p) {
    p = { id: rid(4), code: rid(5), label: name, mode: b.mode === 'custom' ? 'custom' : 'all', allowed: [], editor: false, created: Date.now() };
    if (p.mode === 'custom') p.allowed = [...new Set(rows.flatMap((r) => r.models))];
    p.pin = genPin();
    db.profiles.push(p);
  }
  p.calendar = rows.map((r) => ({ ...r, models: r.models.filter((id) => canOpen(p, id)) })).filter((r) => r.models.length);
  const txt = (x) => (Array.isArray(x) ? x.map((t) => clean(t, 400)).filter(Boolean).slice(0, 40) : []);
  p.calendarInfo = {
    heading: clean(b.heading, 160), subtitle: clean(b.subtitle, 240), intro: clean(b.intro, 500), mappings: txt(b.mappings), gaps: txt(b.gaps), collect: txt(b.collect),
    skus: (Array.isArray(b.skus) ? b.skus : []).map((k) => ({ code: clean(k.code, 12), model: (byNumber.get(Number(k.model)) || {}).id, type: clean(k.type, 20) })).filter((k) => k.model),
  };
  save();
  res.json({ ok: true, id: p.id, school: p.label, pin: p.pin, created, entries: p.calendar.length, skipped: [...skipped] });
});
// plan: one model after another, N days each, starting on a date (for one school or all of them)
A.post('/calendar/plan', (req, res) => {
  const { to, start } = req.body || {};
  const months = Math.round(+req.body.months);
  if (!isDate(start)) return res.status(400).json({ error: 'Please choose the first month.' });
  if (!(months >= 1 && months <= 12)) return res.status(400).json({ error: 'Months per model must be between 1 and 12.' });
  const targets = to === 'all' ? db.profiles.filter((p) => !p.editor) : [schoolOf(to)].filter(Boolean);
  if (!targets.length) return res.status(404).json({ error: 'Not found' });
  for (const p of targets) { p.calendar = planModels(p).map((m, i) => ({ id: rid(4), models: [m.id], from: monthStart(start, i * months), to: monthEndOf(start, (i + 1) * months - 1) })); p.calendarInfo = null; }
  save();
  res.json({ ok: true, schools: targets.length });
});
// copy one school's calendar to another school (or all others)
A.post('/calendar/copy', (req, res) => {
  const src = schoolOf((req.body || {}).from);
  if (!src) return res.status(404).json({ error: 'Not found' });
  const to = req.body.to;
  const targets = to === 'all' ? db.profiles.filter((p) => !p.editor && p !== src) : [schoolOf(to)].filter((p) => p && p !== src);
  if (!targets.length) return res.status(400).json({ error: 'Choose another school to copy to.' });
  for (const p of targets) {
    p.calendar = (src.calendar || []).map((e) => ({ ...e, id: rid(4), models: (e.models || (e.model ? [e.model] : [])).filter((id) => canOpen(p, id)) })).filter((e) => e.models.length);
    p.calendarInfo = src.calendarInfo ? JSON.parse(JSON.stringify(src.calendarInfo)) : null;
  }
  save();
  res.json({ ok: true, schools: targets.length });
});

// Usage report: one row per school for the last N days
function usageReport(days) {
  const since = dayKey(Date.now() - (days - 1) * 864e5);
  const names = new Map(db.models.map((m) => [m.id, m]));
  const spark = [];
  for (let i = 13; i >= 0; i--) spark.push(dayKey(Date.now() - i * 864e5));
  const rows = db.profiles.filter((p) => !p.editor).map((p) => {
    const st = (db.stats || {})[p.id];
    const r = { id: p.id, label: p.label, pin: p.pin, cal: calendarReport(p).summary, visits: 0, views: 0, plays: 0, seconds: 0, activeDays: 0, last: st ? st.last : null, top: [], spark: spark.map(() => 0) };
    if (!st) return r;
    const per = new Map();
    for (const [d, x] of Object.entries(st.days)) {
      const i = spark.indexOf(d);
      if (i >= 0) r.spark[i] = x.s;
      if (d < since) continue;
      r.visits += x.v; r.views += x.w; r.plays += x.p; r.seconds += x.s;
      if (x.v || x.s || x.p || x.w) r.activeDays++;
      for (const [mid, [vw, pl]] of Object.entries(x.m || {})) { const e = per.get(mid) || [0, 0]; e[0] += vw; e[1] += pl; per.set(mid, e); }
    }
    r.top = [...per.entries()].map(([mid, [vw, pl]]) => ({ id: mid, number: names.get(mid) ? names.get(mid).number : 0, name: names.get(mid) ? names.get(mid).name : 'Removed model', views: vw, plays: pl }))
      .sort((a, b) => b.plays * 2 + b.views - (a.plays * 2 + a.views)).slice(0, 3);
    return r;
  });
  rows.sort((a, b) => b.seconds - a.seconds || b.plays - a.plays);
  return { days, rows, spark, totals: rows.reduce((t, r) => ({ visits: t.visits + r.visits, views: t.views + r.views, plays: t.plays + r.plays, seconds: t.seconds + r.seconds }), { visits: 0, views: 0, plays: 0, seconds: 0 }) };
}
const daysParam = (q) => Math.min(3650, Math.max(1, parseInt(q, 10) || 30));
A.get('/usage', (req, res) => res.json(usageReport(daysParam(req.query.days))));
// forget everything recorded for one school (counters, calendar status starts again from nothing)
A.post('/profiles/:id/usage/reset', (req, res) => {
  const p = schoolOf(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (db.stats) delete db.stats[p.id];
  for (const k of [...lastSeen.keys()]) if (k.startsWith(p.id + ':')) lastSeen.delete(k);
  save();
  res.json({ ok: true });
});
// month by month, model by model: opened, views, plays, time spent, next to what the timetable planned
A.get('/usage-monthly.csv', (req, res) => {
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const nextMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0'); };
  const lines = [['School', 'School code', 'Month', 'Model no.', 'Model', 'In the timetable this month', 'Opened', 'Model page views', 'Videos played', 'Minutes spent'].map(q).join(',')];
  for (const p of db.profiles.filter((x) => !x.editor && (!req.query.school || x.id === req.query.school))) {
    const agg = new Map();
    for (const [d, x] of Object.entries(((db.stats || {})[p.id] || {}).days || {})) for (const [mid, a] of Object.entries(x.m || {})) { const k = d.slice(0, 7) + '|' + mid; const e = agg.get(k) || [0, 0, 0]; e[0] += a[0] || 0; e[1] += a[1] || 0; e[2] += a[2] || 0; agg.set(k, e); }
    const planned = new Set();
    for (const e of p.calendar || []) for (let ym = e.from.slice(0, 7); ym <= e.to.slice(0, 7); ym = nextMonth(ym)) for (const id of e.models || []) planned.add(ym + '|' + id);
    const rows = [...new Set([...agg.keys(), ...planned])].map((k) => { const [ym, id] = k.split('|'); const m = findModel(id); return { ym, num: m ? m.number : 0, name: m ? m.name : 'Removed model', pl: planned.has(k), a: agg.get(k) || [0, 0, 0] }; })
      .sort((x, y) => (x.ym < y.ym ? -1 : x.ym > y.ym ? 1 : x.num - y.num));
    for (const r of rows) lines.push([p.label, p.pin, monthsText(r.ym + '-01', r.ym + '-01'), r.num, r.name, r.pl ? 'Yes' : 'No', r.a[0] || r.a[1] ? 'Yes' : r.pl ? 'No' : '', r.a[0], r.a[1], Math.round(r.a[2] / 60)].map(q).join(','));
  }
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="luminary-monthly-metrics.csv"' }).send('\ufeff' + lines.join('\r\n'));
});
A.get('/usage.csv', (req, res) => {
  const rep = usageReport(daysParam(req.query.days));
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [['School', 'School code', 'Visits', 'Model pages opened', 'Videos played', 'Minutes spent', 'Active days', 'Last active (UTC)', 'Most used models'].map(q).join(',')];
  for (const r of rep.rows) lines.push([r.label, r.pin, r.visits, r.views, r.plays, Math.round(r.seconds / 60), r.activeDays, r.last ? new Date(r.last).toISOString().replace('T', ' ').slice(0, 16) : '', r.top.map((t) => String(t.number).padStart(2, '0') + ' ' + t.name).join('; ')].map(q).join(','));
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="luminary-usage-last-${rep.days}-days.csv"` }).send('\ufeff' + lines.join('\r\n'));
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
  const server = app.listen(PORT, () => console.log(`Luminary running on port ${PORT}  (storage: ${store.gcs ? 'gs://' + store.bucketName : DATA_DIR})`));
  // Cloud Run sends SIGTERM before stopping the container: make sure db.json reached the bucket
  process.on('SIGTERM', () => { server.close(); if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; save(); } store.flush().finally(() => process.exit(0)); });
}).catch((e) => { console.error('Could not upload seed images:', e); process.exit(1); });
