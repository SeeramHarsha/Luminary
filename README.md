# Luminary (BotClub)

Mobile-first model library: 32 folders, each with a working video and an assembly video.
Light on data, works offline once saved.

## Run locally
    cd backend && npm install
    ADMIN_PASSWORD=choose-a-strong-one npm start      # http://localhost:3000

First start seeds the 32 models (names, descriptions, photos from the supplier list) and an admin account
(`admin` / `ADMIN_PASSWORD`; default `admin123` - change it under Admin > Settings).
Compression uses the bundled `ffmpeg-static` binary (or set `FFMPEG_PATH` to your own ffmpeg).

## Layout
- `backend/`  Express API, QR rules, FFmpeg video compression (deploys to Cloud Run, storage in a GCS bucket)
- `frontend/` static app (deploys to Cloud Run behind nginx, forwards /api, /media, /brand to the backend)

## Google Cloud
Two Cloud Run services (`backend/` = luminary-api, `frontend/` = luminary-web) and one Cloud Storage bucket.
See LUMINARY_DOCUMENTATION.md, section 8.

## Host it (HTTPS is required for offline caching / install)
Any host that runs Node or Docker with a persistent disk: Render, Railway, Fly.io, a VPS.
- Mount a persistent volume and set `DATA_DIR` to it (uploads and db.json live there).
- Set `PUBLIC_URL=https://your-domain` so QR codes point at the right address.
- Set `ADMIN_PASSWORD`; optionally `SESSION_SECRET` and `MAX_UPLOAD_MB` (default 1024).
- Compression needs CPU: a 1-2 vCPU server compresses about as fast as the clip plays. One video is processed at a time; the rest wait in a queue.
- If you put a proxy (nginx etc.) in front, raise its upload limit (`client_max_body_size`) to match `MAX_UPLOAD_MB`.

## Videos
Every uploaded video, any size or format, is compressed on the server to up to three H.264 versions
(Data saver 360p, Standard 540p, HD 720p, by the short side, so portrait phone clips work too).
Only versions not bigger than the source are made. The original is deleted after compression.
Five thumbnail candidates are extracted; the admin picks the one that shows the finished model.
Viewers get the version that suits their connection (Auto), can pick one by hand, and Auto steps down
if playback stalls. Videos stream from the first second and seek quickly (short keyframe interval).

## Using it
- Admin > Models: upload / replace / delete folder image, working video, assembly video; rename or delete folders.
  A video stays playable with its old version while a replacement is compressing.
- Admin > QR access: each QR opens the library with its own unlocked set ("Open all models", or tick models; Open all / Lock all buttons). "Download PNG" saves a printable card (QR + label).
- Admin > Users: create user logins (optionally tied to a QR access set). QR visitors need no login.
- Admin > Settings: change password, upload the real Luminary logo image.
- Visitors: tap the download icon in the header, choose Data saver / Standard / HD, then "Download everything".
  Later QR scans open it from the device cache, even offline.
- On phones, pressing play opens the video in landscape automatically (real fullscreen + orientation lock where the browser
  allows it, otherwise a rotated full-screen player). Double-tap the left/right side to jump 10 s.
