# Luminary (BotClub)

Mobile-first model library: 32 folders, each with a working video and an assembly video.
Light on data, works offline once saved.

## Run locally
    cd backend && npm install
    ADMIN_PASSWORD=choose-a-strong-one npm start      # http://localhost:3000

First start seeds the 32 models (names, descriptions, photos from the supplier list) and an admin account
(`admin` / `ADMIN_PASSWORD`; default `admin123` - change it under Admin > Settings).
Folder photos are shrunk with the bundled `ffmpeg-static` binary (or set `FFMPEG_PATH`). Videos are not processed.

## Layout
- `backend/`  Express API and QR rules (deploys to Cloud Run; photos/videos in a bucket)
- `frontend/` static app (deploys to Cloud Run behind nginx, forwards /api, /media, /brand to the backend)

## Google Cloud
Two Cloud Run services (`backend/`, `frontend/`) and a Google Cloud Storage bucket for photos, videos and the database.
Videos are stored as uploaded (MP4, MOV or WebM), with no compression. See backend/README.md and LUMINARY_DOCUMENTATION.md, section 8.

## Host it (HTTPS is required for offline caching / install)
Any host that runs Node or Docker with a persistent disk: Render, Railway, Fly.io, a VPS.
- Mount a persistent volume and set `DATA_DIR` to it (uploads and db.json live there).
- Set `PUBLIC_URL=https://your-domain` so QR codes point at the right address.
- Set `ADMIN_PASSWORD`; optionally `SESSION_SECRET` and `MAX_UPLOAD_MB` (default 1024).
- If you put a proxy (nginx etc.) in front, raise its upload limit (`client_max_body_size`) to match `MAX_UPLOAD_MB`.

## Videos
Videos are stored exactly as uploaded (MP4, MOV or WebM) and are watchable straight away. There is no compression,
so keep files reasonably small (720p to 1080p) to save visitors' mobile data and offline storage.

## Using it
- Admin > Models: upload / replace / delete folder image, working video, assembly video; rename or delete folders.
  Videos need no processing: a replacement is live as soon as the upload finishes.
- Admin > QR access: each QR opens the library with its own unlocked set ("Open all models", or tick models; Open all / Lock all buttons). "Download PNG" saves a printable card (QR + label).
- Admin > Users: create user logins (optionally tied to a QR access set). QR visitors need no login.
- Admin > Settings: change password, upload the real Luminary logo image.
- Visitors: tap the download icon in the header, choose Data saver / Standard / HD, then "Download everything".
  Later QR scans open it from the device cache, even offline.
- On phones, pressing play opens the video in landscape automatically (real fullscreen + orientation lock where the browser
  allows it, otherwise a rotated full-screen player). Double-tap the left/right side to jump 10 s.
