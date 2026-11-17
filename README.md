# Luminary (BotClub)

Mobile-first model library: 32 folders, each with a working video and an assembly video.
Light on data, works offline once saved.

## Run locally
    cd backend && npm install
    ADMIN_PASSWORD=choose-a-strong-one npm start      # http://localhost:3000

First start seeds the 32 models (names, descriptions, photos from the supplier list) and an admin account
(`admin` / `ADMIN_PASSWORD`; default `admin123` - change it under Admin > Settings).
Folder photos are shrunk with the bundled `ffmpeg-static` binary (or set `FFMPEG_PATH`).

## Layout
- `backend/`  Express API and QR rules (deploys to Cloud Run; photos/videos in a bucket)
- `frontend/` static app (deploys to Cloud Run behind nginx, forwards /api, /media, /brand to the backend)

## Google Cloud
Two Cloud Run services (`backend/`, `frontend/`) and a Google Cloud Storage bucket for photos, videos and the database.
Videos are on YouTube. See backend/README.md and LUMINARY_DOCUMENTATION.md, section 8.

## Host it (HTTPS is required for offline caching / install)
Any host that runs Node or Docker with a persistent disk: Render, Railway, Fly.io, a VPS.
- Mount a persistent volume and set `DATA_DIR` to it (uploads and db.json live there).
- Set `PUBLIC_URL=https://your-domain` so QR codes point at the right address.
- Set `ADMIN_PASSWORD`; optionally `SESSION_SECRET` and `MAX_UPLOAD_MB` (default 1024).
- If you put a proxy (nginx etc.) in front, raise its upload limit (`client_max_body_size`) to match `MAX_UPLOAD_MB`.

## Videos
Videos are played from YouTube. Upload each video to YouTube (Unlisted is fine; embedding must be allowed), then paste its
link in Admin > Models next to the working / assembly video. The server stores no video files, so there is nothing to compress.

## Using it
- Admin > Models: folder image, a YouTube link for the working video and for the assembly video, and a separate cover image for each video (shown before the video plays; if none is set the folder image is used); rename or delete folders.
- Admin > Schools: each school gets a unique 4-digit code (visitors type it when they open Luminary) and a QR link that skips the code. Choose which models each school can open ("Open all models", or tick models; Open all / Lock all buttons). "Download PNG" saves a printable card. A school marked "Editor link" has no code (QR only) and can manage models and videos.
- Admin > Usage: per school and period, time spent, videos played, model pages, visits, active days, last active and most used models; "Download CSV" exports it. Counters only, no personal data.
- Admin > Calendar: each school's academic calendar in the layout of its plan (month by month: grade, chapter, type, line, models, what happens, slot, dates, status), compared with the usage: done, due now, delayed (with the days late). "Import a school calendar (file)" loads a plan file such as `calendars/navy-children-school.json` (creates the school if needed). Each school has **View calendar** (read-only) and **Edit calendar**. Schools see the same calendar on their own plan page (View calendar button in the library and account menu); CSV export. "Message teacher" writes today's message for the teacher of a school from its calendar (copy, WhatsApp or SMS; you press send).
- Admin > Users: create user logins (optionally tied to a QR access set). Visitors need no login, only their school code or QR.
- Admin > Settings: change password, upload the real Luminary logo image.
- Visitors: tap the download icon in the header, choose Data saver / Standard / HD, then "Download everything".
  Later QR scans open it from the device cache, even offline.
- On phones, pressing play opens the video in landscape automatically (real fullscreen + orientation lock where the browser
  allows it, otherwise a rotated full-screen player). Double-tap the left/right side to jump 10 s.
