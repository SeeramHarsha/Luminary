'use strict';
// Entry point: pulls db.json / secret.txt from the bucket (STORAGE=gcs), then starts the server.
const store = require('./storage');
store.init().then(() => require('./server')).catch((e) => { console.error('Start-up failed:', e); process.exit(1); });
