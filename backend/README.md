# Luminary backend

Express API and QR access rules. Deployed to Cloud Run (build from `backend/Dockerfile`).
Photos and videos live in Cloudinary, which also compresses the videos (360p / 540p / 720p + thumbnails).

Secret (Secret Manager, exposed as an environment variable)
- `CLOUDINARY_URL` = `cloudinary://API_KEY:API_SECRET@CLOUD_NAME`
- `ADMIN_PASSWORD` (first start only), optionally `SESSION_SECRET`

Variables
- `MAX_UPLOAD_MB=2048`, `TRUST_PROXY=3`
- `PUBLIC_URL=<frontend address>` (used in QR links)

Keep max instances at 1 (the database is a single file, saved in Cloudinary as a private file).
Without `CLOUDINARY_URL` the backend stores everything on local disk and compresses with ffmpeg (development).
