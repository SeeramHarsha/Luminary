'use strict';
// Entry point: pulls db.json / secret.txt from the bucket (STORAGE=gcs), then starts the server.
console.log(`[start] Luminary booting (node ${process.version}, PORT=${process.env.PORT})`);
const store = require('./storage');
store.init().then(() => require('./server')).catch((e) => { console.error('Start-up failed:', e); process.exit(1); });
