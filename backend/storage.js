'use strict';
// Storage backends for uploaded media and the database file.
//   STORAGE=local (default): everything lives in DATA_DIR/uploads on disk; ffmpeg compresses videos here.
//   STORAGE=cloudinary     : photos and videos live in Cloudinary (private "authenticated" assets, compressed there),
//                            db.json is kept in Cloudinary too. The server only hands files to visitors who are allowed to see them.
//                            Set CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
// Media is addressed by a flat file name:
//   lm_<id>.jpg                photo / logo            (Cloudinary image)
//   lm_<id>.<short><l|p>.<kbps>.mp4   compressed video  (derived from the uploaded video lm_<id>)
//   lm_<id>.p<centiseconds>.jpg       video thumbnail   (derived frame)
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Readable } = require('stream');
const video = require('./video');

const HAS_CLD = !!(process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME);
const KIND = (process.env.STORAGE || (HAS_CLD ? 'cloudinary' : 'local')).toLowerCase();
const CLOUD = KIND === 'cloudinary';
if (!CLOUD && KIND !== 'local') throw new Error(`STORAGE=${KIND} is not supported any more: set CLOUDINARY_URL (and remove STORAGE / GCS_BUCKET), or STORAGE=local.`);

const DATA_DIR = path.resolve(process.env.DATA_DIR || (CLOUD ? path.join(os.tmpdir(), 'luminary') : path.join(__dirname, 'data')));
const UPLOADS = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const local = (name) => path.join(UPLOADS, name);
const quiet = (label) => (e) => console.error(`[storage] ${label}: ${(e && (e.message || (e.error && e.error.message))) || e}`);

let cloudinary = null;
let cfg = {};
const CHUNK = Math.max(5, Number(process.env.CLOUDINARY_CHUNK_MB || 20)) * 1024 * 1024;
const META_PID = 'luminary_state/'; // db.json lives here as a private raw file
if (CLOUD) {
  cloudinary = require('cloudinary').v2;
  if (!process.env.CLOUDINARY_URL) cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
  cloudinary.config({ secure: true });
  cfg = cloudinary.config();
  if (!cfg.cloud_name || !cfg.api_key || !cfg.api_secret) throw new Error('STORAGE=cloudinary needs CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME');
}

// ---- name <-> Cloudinary asset ----
const RE_REND = /^(lm_[a-z0-9]+)\.(\d+)([lp])\.(\d+)\.mp4$/;
const RE_POST = /^(lm_[a-z0-9]+)\.p(\d+)\.jpg$/;
const RE_IMG = /^(lm_[a-z0-9]+)\.([a-z0-9]+)$/;
const RE_PID = /^(lm_[a-z0-9]+)$/;
function parse(name) {
  let m;
  if ((m = RE_REND.exec(name))) return { pid: m[1], kind: 'rend', short: +m[2], orient: m[3], kbps: +m[4] };
  if ((m = RE_POST.exec(name))) return { pid: m[1], kind: 'poster', at: +m[2] / 100 };
  if ((m = RE_IMG.exec(name))) return { pid: m[1], kind: 'image', ext: m[2] };
  if ((m = RE_PID.exec(name))) return { pid: m[1], kind: 'source' };
  return null;
}
// tr strings: H.264 main profile, capped bitrate, mono AAC, keyframe every second (fast seeking)
const rendTr = (p) => `${p.orient === 'l' ? 'h' : 'w'}_${p.short},c_scale,vc_h264:main,br_${p.kbps}k,ac_aac,ki_1.0`;
const posterTr = (p) => `so_${p.at.toFixed(2)},w_640,c_scale`;

// signed (private) delivery URL for a stored name
function urlFor(name) {
  const p = parse(name);
  if (!p) return null;
  const base = { secure: true, sign_url: true, type: 'authenticated' };
  if (p.kind === 'rend') return cloudinary.url(p.pid, { ...base, resource_type: 'video', raw_transformation: rendTr(p), format: 'mp4' });
  if (p.kind === 'poster') return cloudinary.url(p.pid, { ...base, resource_type: 'video', raw_transformation: posterTr(p), format: 'jpg' });
  if (p.kind === 'image') return cloudinary.url(p.pid, { ...base, resource_type: 'image', format: p.ext });
  return null;
}

// ---- start-up: restore db.json from Cloudinary so a fresh container sees the same data ----
async function init() {
  if (!CLOUD) return;
  console.log(`[storage] connecting to Cloudinary (${cfg.cloud_name})`);
  const u = cloudinary.url(META_PID + 'db.json', { secure: true, sign_url: true, type: 'authenticated', resource_type: 'raw', version: Math.floor(Date.now() / 1000) });
  const r = await fetch(u);
  if (r.status === 404) console.log('[storage] db.json: not found (will be created)');
  else if (!r.ok) throw new Error(`could not read db.json from Cloudinary (HTTP ${r.status} ${r.headers.get('x-cld-error') || ''}) - check CLOUDINARY_URL`);
  else { fs.writeFileSync(path.join(DATA_DIR, 'db.json'), Buffer.from(await r.arrayBuffer())); console.log('[storage] db.json: restored'); }
  // the session secret is derived from the API secret unless SESSION_SECRET is set, so no extra storage is needed
  const sec = path.join(DATA_DIR, 'secret.txt');
  if (!process.env.SESSION_SECRET) fs.writeFileSync(sec, crypto.createHmac('sha256', cfg.api_secret).update('luminary-session').digest('hex'));
  console.log('[storage] using Cloudinary');
}

// ---- db.json sync (coalesced: at most one upload in flight, always the latest content) ----
const pending = new Map();
const inflight = new Map();
function pushMeta(file) {
  if (!CLOUD || file !== 'db.json') return;
  if (inflight.has(file)) { pending.set(file, true); return; }
  const p = cloudinary.uploader.upload(path.join(DATA_DIR, file), { resource_type: 'raw', type: 'authenticated', public_id: META_PID + file, overwrite: true, invalidate: true })
    .catch(quiet('could not save ' + file))
    .finally(() => { inflight.delete(file); if (pending.delete(file)) pushMeta(file); });
  inflight.set(file, p);
}
const flush = () => Promise.all([...inflight.values()]);

// ---- media ----
// Moves a finished local image into the backend. Resolves to { name, size } (the name can change: photos become .jpg).
async function put(name, type, opts = {}) {
  if (!CLOUD) { let size = 0; try { size = fs.statSync(local(name)).size; } catch {} return { name, size }; }
  const p = parse(name);
  if (!p || p.kind === 'rend' || p.kind === 'poster') throw new Error('cannot upload ' + name);
  const photo = !!opts.photo; // folder photos: max 900px, JPEG, auto quality
  const r = await cloudinary.uploader.upload(local(name), {
    public_id: p.pid, type: 'authenticated', resource_type: 'image', overwrite: true,
    ...(photo ? { transformation: [{ width: 900, height: 900, crop: 'limit', quality: 'auto' }], format: 'jpg' } : {}),
  });
  fs.rmSync(local(name), { force: true });
  return { name: `${p.pid}.${photo ? 'jpg' : r.format}`, size: r.bytes };
}
// Server-side copy of an image/thumbnail under a new name; resolves to the size.
async function copy(from, to) {
  if (!CLOUD) { fs.copyFileSync(local(from), local(to)); return fs.statSync(local(to)).size; }
  const p = parse(to);
  const r = await cloudinary.uploader.upload(urlFor(from), { public_id: p.pid, type: 'authenticated', resource_type: 'image', overwrite: true, format: p.ext });
  return r.bytes;
}
// Deletes the file everywhere. Videos: any of their names (or the bare id) deletes the uploaded video and all derived versions. Never throws.
const recentlyRemoved = new Map();
function remove(name) {
  if (!name) return;
  fs.rm(local(name), { force: true }, () => {});
  if (!CLOUD) return;
  const p = parse(name);
  if (!p) return;
  const video = p.kind !== 'image';
  const key = (video ? 'v:' : 'i:') + p.pid;
  if (recentlyRemoved.has(key)) return;
  recentlyRemoved.set(key, true);
  setTimeout(() => recentlyRemoved.delete(key), 60000).unref();
  cloudinary.uploader.destroy(p.pid, { resource_type: video ? 'video' : 'image', type: 'authenticated', invalidate: true }).catch(quiet('delete ' + name));
}
// size of an uploaded video (by id) or a stored local file, or null if it is not there
async function stat(name) {
  if (!CLOUD) { try { return { size: fs.statSync(local(name)).size }; } catch { return null; } }
  const info = await videoInfo(name).catch(() => null);
  return info ? { size: info.bytes } : null;
}

// Sends a stored file with HTTP Range support (needed for video seeking). Cloudinary serves it to us, we serve it to the visitor.
async function send(req, res, name, type) {
  if (!CLOUD) return res.type(type).sendFile(local(name), (e) => { if (e && !res.headersSent) res.status(e.status || 404).end(); });
  const u = urlFor(name);
  if (!u) return res.status(404).end();
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    const headers = {};
    if (req.get('range')) headers.Range = req.get('range');
    const r = await fetch(u, { headers, signal: ac.signal });
    if (![200, 206, 416].includes(r.status)) return res.status(r.status === 404 || r.status === 423 ? 404 : 502).end();
    res.status(r.status);
    res.set('Content-Type', type);
    res.set('Accept-Ranges', 'bytes');
    for (const h of ['content-length', 'content-range', 'etag', 'last-modified']) if (r.headers.get(h)) res.set(h, r.headers.get(h));
    if (req.method === 'HEAD' || !r.body) return res.end();
    const body = Readable.fromWeb(r.body);
    body.on('error', () => res.destroy());
    body.pipe(res);
  } catch (e) {
    if (res.headersSent) res.destroy(); else res.status(502).end();
  }
}

// ---- direct browser -> Cloudinary video uploads (never touches Cloud Run's 32 MB request limit) ----
function uploadParams(pid) {
  const params = { public_id: pid, timestamp: Math.round(Date.now() / 1000), type: 'authenticated' };
  const signature = cloudinary.utils.api_sign_request(params, cfg.api_secret);
  return { url: `https://api.cloudinary.com/v1_1/${cfg.cloud_name}/video/upload`, fields: { ...params, api_key: cfg.api_key, signature }, chunk: CHUNK };
}

// ---- Cloudinary-side video compression ----
async function videoInfo(pid) {
  const r = await cloudinary.api.resource(pid, { resource_type: 'video', type: 'authenticated', media_metadata: true });
  let w = r.width;
  let h = r.height;
  if (r.rotation && Math.abs(Math.round(+r.rotation / 90)) % 2 === 1) [w, h] = [h, w];
  return { duration: r.duration || 0, width: w, height: h, bytes: r.bytes };
}
// sizes in bytes of the finished derived files, keyed by stored name
async function sizes(pid, names) {
  const r = await cloudinary.api.resource(pid, { resource_type: 'video', type: 'authenticated' });
  const out = {};
  for (const n of names) {
    const p = parse(n);
    const key = p.kind === 'rend' ? rendTr(p) : posterTr(p);
    const d = (r.derived || []).find((x) => x.transformation === key || x.transformation === key + '/' + x.format);
    out[n] = d ? d.bytes : 0;
  }
  return out;
}
// which compressed versions + thumbnails to create for this video (same quality ladder as the ffmpeg path)
function plan(pid, info) {
  const orient = info.width >= info.height ? 'l' : 'p';
  const renditions = video.ladderFor(info).map((t) => ({ q: t.q, h: t.short, file: `${pid}.${t.short}${orient}.${parseInt(t.maxrate, 10)}.mp4` }));
  const posters = video.POSTER_AT.map((f) => ({ file: `${pid}.p${String(Math.round(Math.max(0, info.duration * f - 0.05) * 100)).padStart(5, '0')}.jpg` }));
  return { renditions, posters };
}
// asks Cloudinary to build everything in the background
async function generate(pid, pl) {
  const eager = [
    ...pl.renditions.map((r) => ({ raw_transformation: rendTr(parse(r.file)), format: 'mp4' })),
    ...pl.posters.map((p) => ({ raw_transformation: posterTr(parse(p.file)), format: 'jpg' })),
  ];
  await cloudinary.uploader.explicit(pid, { resource_type: 'video', type: 'authenticated', eager, eager_async: true });
}
// is this derived file ready yet? -> { state: 'ready' | 'wait' | 'error', size?, error? }
async function ready(name) {
  const r = await fetch(urlFor(name), { headers: { Range: 'bytes=0-0' } });
  if (r.status === 200 || r.status === 206) {
    const cr = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
    await r.arrayBuffer().catch(() => {});
    return { state: 'ready', size: cr ? +cr[1] : Number(r.headers.get('content-length') || 0) };
  }
  const err = r.headers.get('x-cld-error') || `HTTP ${r.status}`;
  await r.arrayBuffer().catch(() => {});
  if (r.status === 423 || r.status === 404) return { state: 'wait', error: err };
  return { state: 'error', error: err };
}

module.exports = {
  kind: KIND, cloud: CLOUD, cloudName: cfg.cloud_name || null, DATA_DIR, UPLOADS,
  init, pushMeta, flush, put, copy, remove, stat, send, uploadParams, videoInfo, plan, generate, ready, sizes,
};
