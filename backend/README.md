# Luminary backend

Express API and QR access rules. Deployed to Cloud Run (build from `backend/Dockerfile`).
Photos, cover images and the database live in a Google Cloud Storage bucket. Videos are played from YouTube (the admin pastes a link), so the server handles no video files.

## Variables
- `GCS_BUCKET=<bucket name>` (only the name, no `gs://`)
- `ADMIN_PASSWORD` (first start only), `TRUST_PROXY=3`, `PUBLIC_URL=<frontend address>`

## Bucket setup
- Run the service as a service account with **Storage Object Admin** on the bucket
- 1 CPU / 1 GiB is enough, CPU always allocated, max instances 1 (the database is a single file)
- No bucket CORS is needed (nothing is uploaded from the browser directly to the bucket)

Without `GCS_BUCKET` the backend stores everything on local disk (development).
