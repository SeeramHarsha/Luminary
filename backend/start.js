'use strict';
// Entry point: restores db.json from Cloudinary (STORAGE=cloudinary), then starts the server.
console.log(`[start] Luminary booting (node ${process.version}, PORT=${process.env.PORT})`);
const store = require('./storage');
store.init().then(() => require('./server')).catch((e) => { console.error('Start-up failed:', e); process.exit(1); });
