# Luminary backend

Express API, QR access rules and FFmpeg video compression. Deployed to Cloud Run (build from `backend/Dockerfile`).

Environment variables
- `STORAGE=gcs`, `GCS_BUCKET=<bucket name>`: keep media, `db.json` and the session secret in a Cloud Storage bucket
- `MAX_UPLOAD_MB=2048`, `TRUST_PROXY=3`
- `PUBLIC_URL=<frontend address>`: used in QR links

Secrets: `ADMIN_PASSWORD`, `SESSION_SECRET`.
Run as a service account with Storage Object Admin on the bucket. Keep max instances at 1.
