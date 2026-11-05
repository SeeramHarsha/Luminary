'use strict';
// ffmpeg helpers: probe, multi-quality compression, poster frames, image optimisation.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FFMPEG = process.env.FFMPEG_PATH || (() => { try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; } })();
// x264 speed/size trade-off: veryfast is ~3x quicker than medium for ~10-15% bigger files. Override with FFMPEG_PRESET (e.g. medium, slow).
const PRESET = process.env.FFMPEG_PRESET || 'veryfast';
const rid = () => crypto.randomBytes(8).toString('hex');

// Quality ladder, keyed by the SHORT side of the picture so portrait phone clips are handled too.
// Heavily compressed (CRF + bitrate cap) but never below 360p, so small parts stay identifiable.
const LADDER = [
  { q: 'low', short: 360, crf: 32, maxrate: '350k' },
  { q: 'mid', short: 540, crf: 30, maxrate: '750k' },
  { q: 'high', short: 720, crf: 28, maxrate: '1500k' },
];
const POSTER_AT = [0.12, 0.3, 0.5, 0.72, 0.92]; // candidate thumbnail positions; the last is "finished model"

function run(args, { job, onStderr } = {}) {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG, args, { windowsHide: true });
    if (job) job.child = child;
    let stderr = '';
    child.stderr.on('data', (d) => { const s = d.toString(); stderr = (stderr + s).slice(-20000); if (onStderr) onStderr(s); });
    child.on('error', (e) => resolve({ code: -1, stderr: String(e) }));
    child.on('close', (code) => { if (job) job.child = null; resolve({ code, stderr }); });
  });
}

async function probe(src) {
  const { stderr } = await run(['-hide_banner', '-i', src]);
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const v = /Stream #[^\n]*Video:[^\n]*?[ ,](\d{2,5})x(\d{2,5})(?=[ ,[])/.exec(stderr);
  if (!v) return null;
  let w = +v[1];
  let h = +v[2];
  const rot = /rotation of (-?[\d.]+) degrees/.exec(stderr) || /rotate\s*:\s*(-?\d+)/.exec(stderr);
  if (rot && Math.abs(Math.round(+rot[1] / 90)) % 2 === 1) [w, h] = [h, w];
  const f = /(\d+(?:\.\d+)?) fps/.exec(stderr);
  return {
    duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0,
    width: w, height: h,
    fps: f ? +f[1] : 30,
    audio: /Stream #[^\n]*Audio:/.test(stderr),
  };
}

function ladderFor(info) {
  const short = Math.min(info.width, info.height);
  const tiers = LADDER.filter((t) => t.short <= short + 8);
  if (!tiers.length) return [{ ...LADDER[0], short: short - (short % 2) }];
  return tiers;
}

const clock = (s) => { const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/g; let x; let last = null; while ((x = m.exec(s))) last = +x[1] * 3600 + +x[2] * 60 + +x[3]; return last; };

// Produces all renditions + poster candidates. onProgress(0..1). Throws on failure/cancel.
async function processVideo({ src, outDir, job, onProgress }) {
  const info = await probe(src);
  if (!info) throw new Error('This file does not look like a playable video.');
  const tiers = ladderFor(info);
  const made = { renditions: [], posters: [], duration: info.duration, width: info.width, height: info.height };
  const cleanup = () => [...made.renditions.map((r) => r.file), ...made.posters].forEach((f) => fs.rmSync(path.join(outDir, f), { force: true }));
  try {
    // thumbnails first: quick, and the admin can already see candidates while compression runs
    for (const p of POSTER_AT) {
      if (job.cancelled) throw new Error('cancelled');
      const f = rid() + '.jpg';
      const t = Math.max(0, info.duration * p - 0.05).toFixed(2);
      const r = await run(['-y', '-hide_banner', '-ss', t, '-i', src, '-frames:v', '1', '-vf', "scale=w='min(640,iw)':h=-2", '-q:v', '5', path.join(outDir, f)], { job });
      if (r.code === 0 && fs.existsSync(path.join(outDir, f))) made.posters.push(f);
    }
    onProgress(0.03, made);
    for (let i = 0; i < tiers.length; i++) {
      if (job.cancelled) throw new Error('cancelled');
      const t = tiers[i];
      const f = rid() + '.mp4';
      const landscape = info.width >= info.height;
      const vf = landscape ? `scale=-2:${t.short}` : `scale=${t.short}:-2`;
      const args = ['-y', '-hide_banner', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-vf', vf,
        '-c:v', 'libx264', '-preset', PRESET, '-crf', String(t.crf), '-maxrate', t.maxrate, '-bufsize', String(parseInt(t.maxrate, 10) * 2) + 'k',
        '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-g', '48', '-keyint_min', '24', '-movflags', '+faststart']; // short GOP = fast, accurate scrubbing
      if (info.fps > 30.5) args.push('-r', '30');
      if (info.audio) args.push('-c:a', 'aac', '-b:a', '48k', '-ac', '1', '-ar', '44100');
      args.push(path.join(outDir, f));
      const r = await run(args, { job, onStderr: (s) => { const c = clock(s); if (c != null && info.duration) onProgress(0.03 + 0.97 * ((i + Math.min(1, c / info.duration)) / tiers.length), made); } });
      if (job.cancelled) throw new Error('cancelled');
      if (r.code !== 0) throw new Error('Compression failed: ' + r.stderr.split('\n').filter(Boolean).slice(-2).join(' '));
      const out = path.join(outDir, f);
      const dim = landscape ? { w: Math.round((info.width / info.height) * t.short / 2) * 2, h: t.short } : { w: t.short, h: Math.round((info.height / info.width) * t.short / 2) * 2 };
      made.renditions.push({ q: t.q, file: f, size: fs.statSync(out).size, w: dim.w, h: t.short }); // h = short side, shown as "540p"
    }
    onProgress(1, made);
    return made;
  } catch (e) { cleanup(); throw e; }
}

// Shrinks uploaded pictures (max 900px on the long edge, JPEG) so folder images stay light.
async function optimizeImage(src, dst) {
  const r = await run(['-y', '-hide_banner', '-i', src, '-frames:v', '1', '-vf', "scale=w='min(900,iw)':h='min(900,ih)':force_original_aspect_ratio=decrease", '-q:v', '4', dst]);
  return r.code === 0 && fs.existsSync(dst);
}

module.exports = { processVideo, optimizeImage, probe, FFMPEG, ladderFor, LADDER, POSTER_AT };
