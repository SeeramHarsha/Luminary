# Luminary backend

Express API and QR access rules. Deployed to Cloud Run (build from `backend/Dockerfile`).
Photos, videos and the database live in a Google Cloud Storage bucket. Videos are stored exactly as uploaded (MP4, MOV or WebM): no compression, so they are watchable at once.

## Variables
- `GCS_BUCKET=<bucket name>` (only the name, no `gs://`)
- `ADMIN_PASSWORD` (first start only), `MAX_UPLOAD_MB` (e.g. 2048), `TRUST_PROXY=3`, `PUBLIC_URL=<frontend address>`

## Bucket setup
- Run the service as a service account with **Storage Object Admin** on the bucket
- Allow browser uploads: put your frontend address in `cors.json` (`origin`) and run
  `gcloud storage buckets update gs://BUCKET --cors-file=backend/cors.json`
- 1 CPU / 1 GiB is enough, CPU always allocated, max instances 1 (the database is a single file)

Without `GCS_BUCKET` the backend stores everything on local disk (development).
