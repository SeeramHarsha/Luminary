'use strict';
// Storage backends for uploaded media and the database file.
//   STORAGE=local (default): everything lives in DATA_DIR/uploads on disk.
//   STORAGE=gcs            : media + db.json + session secret live in a Google Cloud Storage bucket.
//                            The local uploads folder is only a scratch area for ffmpeg.
// Media is always addressed by a flat file name (e.g. "3fa9c1d2e4b5a687.mp4").
const fs = require('fs');
const path = require('path');
const os = require('os');

const KIND = (process.env.STORAGE || (process.env.GCS_BUCKET ? 'gcs' : 'local')).toLowerCase();
const GCS = KIND === 'gcs';
const BUCKET = process.env.GCS_BUCKET || '';
const PREFIX = (process.env.GCS_PREFIX || '').replace(/^\/+|\/+$/g, '');
if (GCS && !BUCKET) throw new Error('STORAGE=gcs needs GCS_BUCKET to be set.');

const DATA_DIR = path.resolve(process.env.DATA_DIR || (GCS ? path.join(os.tmpdir(), 'luminary') : path.join(__dirname, 'data')));
const UPLOADS = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const key = (name) => (PREFIX ? PREFIX + '/' : '') + 'media/' + name;
const metaKey = (name) => (PREFIX ? PREFIX + '/' : '') + name; // db.json, secret.txt
const local = (name) => path.join(UPLOADS, name);

let bucket = null;
if (GCS) {
  const { Storage } = require('@google-cloud/storage');
  bucket = new Storage().bucket(BUCKET);
}

const quiet = (label) => (e) => console.error(`[storage] ${label}: ${e.message}`);

// ---- start-up: pull db.json / secret.txt from the bucket so a fresh container sees the same data ----
async function init() {
  if (!GCS) return;
  for (const f of ['db.json', 'secret.txt']) {
    const obj = bucket.file(metaKey(f));
    const [exists] = await obj.exists();
    if (exists) await obj.download({ destination: path.join(DATA_DIR, f) });
  }
  console.log(`[storage] using gs://${BUCKET}/${PREFIX ? PREFIX + '/' : ''}`);
}

// ---- db.json / secret.txt sync (coalesced: at most one upload in flight, always the latest content) ----
const pending = new Map(); // file -> true when a newer version is waiting
const inflight = new Map();
function pushMeta(file) {
  if (!GCS) return;
  if (inflight.has(file)) { pending.set(file, true); return; }
  const p = bucket.file(metaKey(file))
    .save(fs.readFileSync(path.join(DATA_DIR, file)), { resumable: false, contentType: file.endsWith('.json') ? 'application/json' : 'text/plain' })
    .catch(quiet('could not save ' + file))
    .finally(() => {
      inflight.delete(file);
      if (pending.delete(file)) pushMeta(file);
    });
  inflight.set(file, p);
}
const flush = () => Promise.all([...inflight.values()]);

// ---- media ----
// Moves a finished local file into the backend (no-op for local storage).
async function put(name, type) {
  if (!GCS) return;
  await bucket.upload(local(name), { destination: key(name), resumable: false, metadata: { contentType: type || 'application/octet-stream', cacheControl: 'private, max-age=31536000, immutable' } });
  fs.rmSync(local(name), { force: true });
}
// Makes sure a copy of the file is in the local scratch folder (used before ffmpeg runs).
async function fetchLocal(name) {
  if (GCS && !fs.existsSync(local(name))) await bucket.file(key(name)).download({ destination: local(name) });
  return local(name);
}
// Deletes the file everywhere. Never throws.
function remove(name) {
  if (!name) return;
  fs.rm(local(name), { force: true }, () => {});
  if (GCS) bucket.file(key(name)).delete({ ignoreNotFound: true }).catch(quiet('delete ' + name));
}
// Server-side copy; resolves to the size of the copy.
async function copy(from, to) {
  if (!GCS) { fs.copyFileSync(local(from), local(to)); return fs.statSync(local(to)).size; }
  const dst = bucket.file(key(to));
  await bucket.file(key(from)).copy(dst);
  const [md] = await dst.getMetadata();
  return Number(md.size);
}
async function stat(name) {
  if (!GCS) { try { return { size: fs.statSync(local(name)).size }; } catch { return null; } }
  const f = bucket.file(key(name));
  const [ok] = await f.exists();
  if (!ok) return null;
  const [md] = await f.getMetadata();
  return { size: Number(md.size) };
}

// Sends a stored file with HTTP Range support (needed for video seeking).
function send(req, res, name, type) {
  if (!GCS) return res.type(type).sendFile(local(name), (e) => { if (e && !res.headersSent) res.status(e.status || 404).end(); });
  const f = bucket.file(key(name));
  f.getMetadata().then(([md]) => {
    const size = Number(md.size);
    res.set({ 'Content-Type': type, 'Accept-Ranges': 'bytes', ETag: md.etag ? `"${md.etag}"` : undefined, 'Last-Modified': md.updated ? new Date(md.updated).toUTCString() : undefined });
    if (req.get('if-none-match') && req.get('if-none-match') === res.get('ETag')) return res.status(304).end();
    let start = 0;
    let end = size - 1;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') || '');
    if (m && (m[1] || m[2])) {
      if (m[1] === '') { start = Math.max(0, size - Number(m[2])); }
      else { start = Number(m[1]); if (m[2] !== '') end = Math.min(Number(m[2]), size - 1); }
      if (start > end || start >= size) return res.status(416).set('Content-Range', `bytes */${size}`).end();
      res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.set('Content-Length', String(size ? end - start + 1 : 0));
    if (req.method === 'HEAD' || !size) return res.end();
    const rs = f.createReadStream({ start, end });
    rs.on('error', () => res.destroy());
    res.on('close', () => rs.destroy());
    rs.pipe(res);
  }).catch((e) => {
    if (res.headersSent) return res.destroy();
    res.status(e.code === 404 ? 404 : 502).end();
  });
}

// ---- direct browser -> bucket uploads (bypasses Cloud Run's 32 MB request limit) ----
// Returns a resumable-upload session URI the browser can PUT the file to.
async function directUploadUrl(name, type, origin) {
  const [uri] = await bucket.file(key(name)).createResumableUpload({ origin, metadata: { contentType: type || 'application/octet-stream' } });
  return uri;
}

module.exports = { kind: KIND, gcs: GCS, bucketName: BUCKET, DATA_DIR, UPLOADS, init, pushMeta, flush, put, fetchLocal, remove, copy, stat, send, directUploadUrl };
