# Luminary (by BotClub) — Complete System & Product Documentation

## 1. Executive Summary & Purpose

**Luminary** is a mobile-first, offline-capable digital manual and Progressive Web Application (PWA) designed to accompany physical hands-on STEM education kits. Developed by **BotClub**, it serves as an interactive video library for students, educators, and workshop participants assembling physical science, mechanics, and electronics experiment kits.

### The Problem It Solves
- **Fragile Paper Manuals**: Traditional printed booklets are easily torn, misplaced, or insufficient for explaining dynamic multi-gear interactions, kinetic transfers, or circuit wiring.
- **Classroom Connectivity Constraints**: Schools, maker spaces, science labs, and rural education centers often suffer from unreliable, slow, or nonexistent internet connections.
- **Friction in Student Access**: Requiring accounts, usernames, and passwords for young students creates significant classroom friction, delays, and lost login credentials.

### Luminary's Core Solutions
1. **Zero-Friction Access**: Direct scanning of physical QR codes on kit boxes or opening the web address grants instant access with no login or password required for students/visitors.
2. **Dual-Video Instruction**: Every kit features two parallel video tracks:
   - **Assembly Video**: Visual step-by-step construction instructions showing how physical pieces fit together.
   - **Working Video**: Demonstration of the completed model in action, explaining the physics/engineering theory behind it.
3. **100% Offline Resilience**: Single-tap offline downloading stores the entire UI, photos, descriptions, and compressed videos directly in the browser's persistent Cache API on the user's phone or computer.

---

## 2. Visitor & Student Experience

### A. Library & Browsing
- **Visual Folder Grid**: 32 color-coded model folders with embossed number tabs (`01` through `32`) and high-resolution kit photographs.
- **Real-Time Search**: Instant filtering by kit number or model name as the user types.
- **Model Details View**: Shows kit specifications, educational descriptions, kit photographs, and side-by-side video cards.
- **Sequential Pager**: Easy navigation buttons (`← Previous Model` / `Next Model →`) to move sequentially through kits.

### B. Custom Video Player (`frontend/player.js`)
Luminary features an ultra-lightweight, touch-friendly player built specifically for mobile devices:
- **Bandwidth Detection**: Uses the `navigator.connection` API to detect network speed (2G, 3G, 4G, Wi-Fi) and select the optimal video resolution automatically.
- **Auto-Stall Downshifting**: If playback stalls due to network congestion, the player automatically steps down to a lower bitrate to prevent buffering.
- **Orientation Lock & Cinema Mode**: Tapping play automatically switches mobile devices into fullscreen landscape mode for an unobstructed view of the assembly steps.
- **Touch Gestures & Scrubbing**: Double-tapping the left or right side of the screen jumps backward or forward by 10 seconds; speed controls range from `0.5x` to `2.0x`.

### C. Offline Download Manager
- Accessible via the **download icon** in the top navigation bar.
- Visitors select their preferred storage quality:
  - **Data Saver (360p)**: Lowest storage footprint (~350 kbps).
  - **Standard (540p)**: Balanced for phone screens (~750 kbps).
  - **HD (720p)**: Crisp, high-detail video (~1500 kbps).
- Tapping **"Download everything"** stores the entire library in local browser storage (`Cache API`), showing real-time progress bars and MB counts.
- Once downloaded, the application functions seamlessly even in Airplane Mode.

---

## 3. QR Code Access Control System

Luminary includes a dynamic QR generation and profile management system:

- **No Authentication Required**: Scanning a generated QR code immediately unlocks the relevant models without prompting for credentials.
- **Granular Kit Profiles**: In the Admin panel, instructors can generate distinct QR codes tailored to specific groups or classes:
  - *Full Access*: Unlocks all 32 models.
  - *Custom Subset*: Restricts access to selected kits (e.g., only unlocking Kits 1–5 for a morning electrical circuits lab). Unticked models display an "Authorized QR Required" lock state.
- **Smart LAN IP Detection**: When run locally or on a school server, QR codes automatically embed the server's local network Wi-Fi IP address (e.g., `http://192.168.1.39:3000/q/...`), ensuring physical smartphone cameras on the same Wi-Fi network connect directly.
- **Printable Card Export ("Download PNG")**: Admins can download high-resolution (1100 × 1320 px) ready-to-print cards containing the QR code, kit title, instructions, and BotClub branding to paste onto physical kit boxes.

---

## 4. Complete Catalog of 32 STEM Models

The platform is pre-loaded with 32 science, physics, and engineering demonstrators:

| No. | Model Name | Educational Focus & Scientific Concept |
| :---: | :--- | :--- |
| **01** | Circuit Construction 1 | Basic electrical circuits, complete closed loops, electron flow |
| **02** | Circuit Construction 2 | Series and parallel connections, component integration |
| **03** | Circuit Construction 3 | Complex circuits, multi-component interaction |
| **04** | Circuit Construction 4 | Advanced circuits and practical electrical applications |
| **05** | Types of Motion Kit (MC 2) | Rotary-to-linear and reciprocating motion conversion |
| **06** | Force & Gear Mechanics (GR) | Gear trains, gear ratios, torque vs. speed trade-offs |
| **07** | Lever & Balanced Forces (UB) | First/second/third-class levers, fulcrum position, equilibrium |
| **08** | Law of Reflection | Planar optics, angle of incidence equals angle of reflection |
| **09** | Types of Switches | SPST, SPDT, pushbuttons, circuit control logic |
| **10** | Light & Image Formation (II) | Optical ray tracing, focal points, image projection |
| **11** | Newton's Cradle | Conservation of momentum and kinetic energy transfer |
| **12** | Gravitational Force (PG) | Conversion of mechanical potential energy into electrical energy |
| **13** | Simple Machines & Pulley (PF) | Mechanical advantage, single/double pulley efficiency |
| **14** | Potential & Kinetic Energy (PE & KE) | Transformation between stored and moving energy states |
| **15** | Concave & Convex Lens (CL) | Refraction, focal length, converging and diverging rays |
| **16** | Magnetic Effects of Current (EMI) | Electromagnetic induction (Faraday's Law) |
| **17** | Electro Magnetic Bell | Solenoids, electromagnetic strike mechanisms, sound generation |
| **18** | Friction Demonstrator (PT) | Rotational friction, torque, resistance vs. contact surface |
| **19** | Motion Conversion Kit (MC1) | Mechanical cams, linkages, and directional force transfer |
| **20** | Magnetic Field Explorer | Magnetic dipoles, flux lines, field orientation |
| **21** | Transfer of Heat (JT - Peltier) | Thermoelectric effects, Peltier heating/cooling differential |
| **22** | Time and Distance (ADTG 1) | Freefall kinematics, gravitational acceleration ($g \approx 9.8\text{ m/s}^2$) |
| **23** | Pendulum Clock (ADTG 2) | Periodic oscillation, pendulum frequency vs. string length |
| **24** | Air Pressure Kit (AL) | Atmospheric pressure, barometric displacement, vacuum seals |
| **25** | Buoyant Force | Archimedes' principle, displacement, positive/negative buoyancy |
| **26** | Force Balance Demonstrator (FT) | Vector addition, concurrent force resolution on a force table |
| **27** | Heat Transfer | Thermal conduction, convection currents, and infrared radiation |
| **28** | Sound Basics (BS) | Mechanical vibrations, frequency, pitch, medium transmission |
| **29** | Concave & Convex Mirrors (CM) | Curved optical reflection, real vs. virtual image formation |
| **30** | Sound Waves (PS) | Longitudinal pressure waves, amplitude, wavelength |
| **31** | Matter Expansion (Earth Energy) | Thermal expansion and contraction in solids, liquids, and gases |
| **32** | Units and Measurement | Standard SI metrics, vernier calipers, volume, mass, and time |

---

## 5. Administrative Dashboard (`frontend/admin.js`)

Instructors access the management panel via **Account Icon > Admin sign in** or by visiting `#/admin`:

- **Models Tab**:
  - Add new kits or edit existing folder names, descriptions, and sequence numbers.
  - Upload folder cover photographs.
  - Upload working and assembly videos (supports any source resolution or phone recording).
  - **Visual Thumbnail Selector**: Review 5 candidate video frames extracted automatically by the server to pick the thumbnail that best showcases the completed model.
- **QR Access Tab**:
  - Create, rename, or delete QR code profiles.
  - Bulk select / deselect kits via "Tick all" or "Untick all" buttons.
  - Generate and download printable high-resolution QR cards.
- **Users Tab**:
  - Optionally create named user accounts tied to specific access profiles.
- **Settings Tab**:
  - Change administrator password.
  - Upload a custom school, organization, or sponsor logo to replace the default Luminary wordmark.

---

## 6. Technical Architecture & Media Pipeline

### A. System Architecture Diagram

```
[ Student / Phone / Browser ]
         │
         ├─── Scan Physical QR Code ──────► Express Server (Port 3000)
         │                                       │
         ├─── Stream Video (Byte Ranges) ────────┤
         │                                       ▼
         └─── Download All for Offline ────► Browser Cache API (lm-media)
                                                 ▲
                                                 │
[ Admin Dashboard ]                              │
         │                                       │
         ├─── Uploads Raw Video (MP4/MOV) ───────┤
         ▼                                       │
[ FFmpeg Background Transcoding Queue ]          │
         │                                       │
         ├── 360p (Data Saver) ──────────────────┤
         ├── 540p (Standard) ────────────────────┤
         ├── 720p (HD) ──────────────────────────┤
         └── 5x Poster Candidates (.jpg) ────────┘
```

### B. Video Transcoding Engine (`backend/video.js`)
1. **Multi-Bitrate Ladder**: Every uploaded video is transcoded into three H.264/AAC renditions (360p, 540p, 720p).
2. **Short-Side Scaling**: Transcoding scales by the short side of the frame, natively supporting both vertical smartphone videos and horizontal landscape videos without black bars or distortion.
3. **Queue Protection**: Video compression processes one file at a time in the background so CPU utilization never spikes or freezes live visitor playback.
4. **Fast Scrubbing**: Keyframe intervals are capped at 1 second, enabling instant seeking and scrubbing even over slow networks.

### C. Security & Data Integrity
- **Zero Heavy Dependencies**: Operates on a single atomic JSON database (`data/db.json`), ensuring portability without needing external database engines (PostgreSQL, MongoDB, or MySQL).
- **Cryptographic Security**: Admin authentication uses Node.js `crypto.scryptSync` with 16-byte random salts and HMAC-SHA256 signed session cookies.
- **Offline Byte-Range Streaming**: Custom Service Worker interceptors handle HTTP 206 Partial Content responses from local cache storage, allowing video scrubbing even when fully offline.

---

## 7. Storage & File System Structure

```
luminary-model-assembly-app/
├── backend/                  # deployed to Cloud Run
│   ├── server.js             # Express REST API, session auth, video queue
│   ├── start.js              # Entry point (restores db.json from the bucket / Cloudinary, then starts server.js)
│   ├── storage.js            # Local-disk, Google bucket or Cloudinary storage backend
│   ├── video.js              # FFmpeg transcoding ladder & thumbnail extractor (local disk and bucket storage)
│   ├── seed.js               # Initial dataset containing 32 model kits
│   ├── seed-images/          # Preloaded stock photos for the 32 models
│   ├── Dockerfile, cors.json (bucket upload CORS)
│   └── data/                 # Local mode only: db.json, secret.txt, uploads/
├── frontend/                 # deployed to Cloud Run (nginx)
│   ├── index.html, app.js, app.css   # Single-page app, routing, styling
│   ├── player.js             # Custom HTML5 video player with adaptive bitrate
│   ├── admin.js              # Admin / editor dashboard (lazy-loaded)
│   ├── sw.js                 # Service Worker for offline asset & video caching
│   ├── manifest.webmanifest, fonts/, icons/
│   └── Dockerfile, nginx.conf.template
└── LUMINARY_DOCUMENTATION.md
```

### File Locations:
- **Server Media Storage**: `data/uploads/` (stores all compressed `.mp4` renditions and `.jpg` posters).
- **Database File**: `data/db.json` (stores catalog models, descriptions, user logins, and QR profile access rules).
- **Client Offline Storage**: Stored inside browser cache under cache partition **`lm-media`**.

---

## 8. Running & Deployment Guide

### Running Locally
```powershell
cd backend
npm install
npm start
```
The backend also serves the sibling `frontend/` folder when it exists, so `http://localhost:3000` works as one app (and on your Wi-Fi at `http://<your-ip>:3000`).

### Deploying to Google Cloud: two Cloud Run services + a storage option

| Part | Folder | Runs on |
| :--- | :--- | :--- |
| Backend (API, QR rules, database) | `backend/` | Cloud Run service (builds from `backend/Dockerfile`) |
| Frontend (the app screens) | `frontend/` | Cloud Run service (nginx, builds from `frontend/Dockerfile`) |
| Photos and videos | n/a | Google Cloud Storage bucket **or** Cloudinary (choose one) |

The frontend (nginx) forwards `/api`, `/media` and `/brand` to the backend, so visitors see one address (login cookies, QR links and offline mode work without CORS). Set `BACKEND_URL` and `BACKEND_HOST` on the frontend service.

**Storage option A: Google Cloud Storage bucket** (`STORAGE=gcs`, `GCS_BUCKET=<name>`). No limit on video size, so 500 MB+ videos work. The admin or an editor uploads a video **directly from the browser to the bucket** (avoids Cloud Run's 32 MB request limit). The backend downloads it, compresses it with FFmpeg into 360p/540p/720p plus five thumbnail candidates, and saves the results back. Needs a service account with Storage Object Admin on the bucket, the bucket CORS rule in `backend/cors.json`, and compression power on the backend: 4 CPU, 8 GiB memory, CPU always allocated, request timeout 3600 s.

**Storage option B: Cloudinary** (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`). Cloudinary compresses the video, so the backend needs only 1 CPU / 1 GiB. The browser uploads in 20 MB chunks straight to Cloudinary. The free plan limits videos to 100 MB per file; larger files need a paid plan.

Either way the files are private: visitors stream them through the backend, so the QR locks still apply. The database (`db.json`) is saved in the same storage and restored on start, so a restarted or redeployed container keeps its data. Keep **1 instance only** (`db.json` is a single file).

| Variable | Purpose |
| :--- | :--- |
| `GCS_BUCKET` | Bucket name; turns on bucket storage (option A) |
| `CLOUDINARY_URL` or the three `CLOUDINARY_*` variables | Turns on Cloudinary storage (option B) |
| `STORAGE` | Optional: `gcs`, `cloudinary` or `local` to force the choice |
| `ADMIN_PASSWORD` | Admin password for the first start |
| `SESSION_SECRET` | Optional cookie signing key (stored in the storage if unset) |
| `PUBLIC_URL` | Frontend address, used in QR links |
| `MAX_UPLOAD_MB` | Largest video the admin may upload (2048 for the bucket; 100 for Cloudinary free) |
| `TRUST_PROXY` | Number of proxies in front of the backend (3 behind two Cloud Run services) |
| `COMPRESS` | `background` (default: play the upload at once, compress later), `off` (never compress) or `on` (wait for compression) |
| `GCS_PREFIX` | Optional folder inside the bucket |
| `FRONTEND_DIR` | Folder the backend also serves (local development; default `../frontend`) |

### Default Credentials
- **Username**: `admin`
- **Password**: `admin123` *(Change via Admin > Settings after first login)*

### Production Environment Variables
- `PORT`: Server listening port (default: `3000`).
- `DATA_DIR`: Directory for database and uploads (default: `./data`).
- `PUBLIC_URL`: Full domain URL for production QR code generation (e.g. `https://models.botclub.in`).
- `ADMIN_PASSWORD`: Pre-set password for the initial seed admin account.
- `MAX_UPLOAD_MB`: Maximum raw video upload size in MB (default: `1024`).

