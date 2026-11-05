# Luminary backend

Express API and QR access rules. Deployed to Cloud Run (build from `backend/Dockerfile`).
Pick ONE place for photos, videos and the database with environment variables:

## Option A: Google Cloud Storage bucket (no video size limit, videos compressed on Cloud Run with ffmpeg)
- `STORAGE=gcs`, `GCS_BUCKET=<bucket name>` (only the name, no `gs://`)
- Run the service as a service account with **Storage Object Admin** on the bucket
- Allow browser uploads: edit `cors.json` (put your frontend address in `origin`) and run
  `gcloud storage buckets update gs://BUCKET --cors-file=backend/cors.json`
- Needs CPU for compression: 4 CPU, 8 GiB memory, CPU always allocated, request timeout 3600 s

## Option B: Cloudinary (compression done by Cloudinary; free plan limits videos to 100 MB)
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (or one `CLOUDINARY_URL=cloudinary://KEY:SECRET@NAME`)
- 1 CPU / 1 GiB is enough

## Both
- `ADMIN_PASSWORD` (first start only), `MAX_UPLOAD_MB` (e.g. 2048 for the bucket, 100 on Cloudinary free), `TRUST_PROXY=3`, `PUBLIC_URL=<frontend address>`
- Keep max instances at 1 (the database is a single file, saved in the bucket / Cloudinary)
- If you use the bucket, remove the Cloudinary variables (and the other way round). `STORAGE` can force the choice.

Without any of these the backend stores everything on local disk and compresses with ffmpeg (development).

## Video compression (`COMPRESS`, bucket / local storage)
- `background` (default): the uploaded video is playable immediately; 360p/540p/720p versions are made in the background and replace it when ready. Needs the CPU only while compressing.
- `off`: never compress. Visitors get the uploaded file as it is (mp4, mov or webm). Fastest; 1 CPU / 1 GiB is enough. Big files use more mobile data, and "download for offline" is large.
- `on`: the video appears only after compression finishes.
Files that browsers cannot play directly (mkv, avi ...) are always compressed first. Cloudinary does its own compression.
