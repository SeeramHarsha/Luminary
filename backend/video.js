'use strict';
// ffmpeg helper used only to shrink uploaded photos. Videos are stored exactly as uploaded (no compression).
const { spawn } = require('child_process');
const fs = require('fs');

const FFMPEG = process.env.FFMPEG_PATH || (() => { try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; } })();

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-4000); });
    child.on('error', (e) => resolve({ code: -1, stderr: String(e) }));
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

// Shrinks uploaded pictures (max 900px on the long edge, JPEG) so folder images stay light.
async function optimizeImage(src, dst) {
  const r = await run(['-y', '-hide_banner', '-i', src, '-frames:v', '1', '-vf', "scale=w='min(900,iw)':h='min(900,ih)':force_original_aspect_ratio=decrease", '-q:v', '4', dst]);
  return r.code === 0 && fs.existsSync(dst);
}

module.exports = { optimizeImage, FFMPEG };
