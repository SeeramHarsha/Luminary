# Luminary (by BotClub) — Complete System & Product Documentation

## 1. Executive Summary & Purpose

**Luminary** is a mobile-first, offline-capable digital manual and Progressive Web Application (PWA) designed to accompany physical hands-on STEM education kits. Developed by **BotClub**, it serves as an interactive video library for students, educators, and workshop participants assembling physical science, mechanics, and electronics experiment kits.

### The Problem It Solves
- **Fragile Paper Manuals**: Traditional printed booklets are easily torn, misplaced, or insufficient for explaining dynamic multi-gear interactions, kinetic transfers, or circuit wiring.
- **Classroom Connectivity Constraints**: Schools, maker spaces, science labs, and rural education centers often suffer from unreliable, slow, or nonexistent internet connections.
- **Friction in Student Access**: Requiring accounts, usernames, and passwords for young students creates significant classroom friction, delays, and lost login credentials.

### Luminary's Core Solutions
1. **Zero-Friction Access**: scanning the QR code on a kit box, or typing a 4-digit school code, grants instant access. No accounts, usernames or passwords for students.
2. **Dual-Video Instruction**: Every kit features two parallel video tracks:
   - **Assembly Video**: Visual step-by-step construction instructions showing how physical pieces fit together.
   - **Working Video**: Demonstration of the completed model in action, explaining the physics/engineering theory behind it.
3. **100% Offline Resilience**: Single-tap offline downloading stores the entire UI, photos, descriptions, and videos directly in the browser's persistent Cache API on the user's phone or computer.

---

## 2. Visitor & Student Experience

### A. Library & Browsing
- **Visual Folder Grid**: 32 color-coded model folders with embossed number tabs (`01` through `32`) and high-resolution kit photographs.
- **Real-Time Search**: Instant filtering by kit number or model name as the user types.
- **Model Details View**: Shows kit specifications, educational descriptions, kit photographs, and side-by-side video cards.
- **Sequential Pager**: Easy navigation buttons (`← Previous Model` / `Next Model →`) to move sequentially through kits.

### B. Custom Video Player (`frontend/player.js`)
Luminary features an ultra-lightweight, touch-friendly player built specifically for mobile devices:
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

## 3. School Codes & QR Access

Luminary asks every visitor for a **school code** before showing anything. Each school (class, group or customer) is created in **Admin > Schools** and gets:

- **A unique 4-digit code**, generated automatically (or chosen by the admin; it can be regenerated at any time). Visitors type it on the "Enter your school code" screen, which appears whenever someone opens Luminary without being signed in.
- **A QR code and link** that open Luminary for that school without typing the code (print it on the kit box).
- **Its own set of unlocked models**: *Open all models*, or tick the models the school may use (for example, only kits 1 to 5). Unticked models show a lock.

How it behaves:
- A correct code signs the device in for 90 days. **Account icon > Use a different school code** signs out.
- Wrong codes show a clear message. After 10 wrong codes a visitor is paused for 10 minutes, and the whole site pauses after 200 wrong codes in 10 minutes, so guessing codes stays slow.
- Deleting a school ends its sessions at once and its code stops working.
- **Editor links** (a school with "Editor link" ticked, for people who manage videos and models) have **no 4-digit code**. They work only through their QR link, because a short code must never grant editing rights.
- Admins sign in with the **Admin sign in** link on the code screen.
- **Usage tracking**: Admin > Usage shows, for each school and a chosen period (7 days, 30 days, 90 days, 1 year), the **time spent**, **videos played**, **model pages opened**, **visits**, **active days**, when the school was **last active** and its **most used models**, with a small 14-day activity chart. **Download CSV** exports the same table. Only counters per school are stored: no names, no personal data. Staff (admins and editors) are not counted. Time is counted while the app is open and being used, or while a video is open, in 30-second steps.
- **Academic calendar per school (same layout as the school's PDF)**: Admin > Calendar shows, for each school, its plan **month by month**, one row per teaching session: **Grade, Chapter, Type** (revision, live, enrichment), **Line** (hardware or VIS), the **Models** used, **What happens**, the **Slot** and the **Dates**, plus the plan's heading, intro note, an **"Every model accounted for"** table (where each model lands and how many of those sessions were opened), and the notes (**Mappings**, **Gaps**, **Collect from the school**). Luminary compares each session with the usage counters and gives it a **Status**: **Done** (every model of the session opened inside its dates), **Done early**, **Due now**, **Upcoming**, **Done late** or **Delayed** (its dates are over and not every model was opened; the number of days is shown). Every model chip is ticked (✓) once opened. Dates can be edited per row. Simple tools remain for schools without a plan file: create a plan (N days per model, one school or all), add one model, copy a calendar. The overview lists the schools that are behind first; **Download status as CSV** gives one row per session and model. Dates are UTC days.
- **View or edit (admin)**: in Admin > Calendar every school has a **View calendar** button (read-only, exactly what the school sees: nothing can be changed by accident) and an **Edit calendar** button (change dates, remove rows, planning tools). The Schools tab has the same shortcut on every school card. A school without a calendar shows **Set up calendar**.
- **Import a school calendar from a file**: Admin > Calendar > *Import a school calendar (file)* reads a JSON file with `school`, optional `heading`, `subtitle`, `intro`, `mappings`, `gaps`, `collect`, `skus` and `sessions` (each: `grade`, `chapter`, `type`, `line`, `models` as Luminary model numbers, `what`, `slot`, `from`, `to`). It creates the school if it does not exist (with its 4-digit code) and replaces its calendar. `calendars/navy-children-school.json` holds the Navy Children School plan from its PDF: 50 sessions, Sep 2026 to Mar 2027, 30 models. Older files with an `entries` list (one model per row) still import.
- **The school sees its own calendar**: the library screen shows a "Your school's plan" card (models opened so far, what is **delayed**, what to open **Now**) with a link **See the full calendar**, and a **View calendar** button at the top of the library and in the account menu, which open the school's plan page in the same month-by-month layout as the PDF, with every model chip linking to its model. Each model tile carries a small tag (**Now**, **Next**, **Delayed**, **✓ Opened**) and the model page shows its planned dates and the grade/chapter. A model opened after its dates still counts as opened. A school without a calendar sees none of this.
- A 4-digit code is light protection, meant to keep casual visitors out. Do not use it for anything confidential.
- **Smart LAN IP Detection**: when run locally or on a school server, QR codes embed the server's local network Wi-Fi IP address, so phones on the same Wi-Fi connect directly.
- **Printable Card Export ("Download PNG")**: admins can download a ready-to-print card (QR code, name and branding) to paste on kit boxes.

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
  - Paste the YouTube link of the working video and of the assembly video, and upload a separate cover image for each.
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

### A. System Architecture

```
[ Student / Phone / Browser ]
         |
         |-- Scan Physical QR Code --------> Frontend (nginx on Cloud Run)
         |                                        |  forwards /api, /media, /brand
         |                                        v
         |                                 Backend (Express on Cloud Run) -- QR rules, logins, db.json
         |                                        |
         |<-- photos, cover images <-- Cloud Storage bucket
         |
         |<-- embedded player -------------- YouTube (the videos)
```

### B. Videos (YouTube)
1. **Hosted on YouTube**: the admin uploads each video to YouTube (an **Unlisted** video works, and embedding must be allowed), then pastes its link next to the working or assembly video. Links like `youtube.com/watch?v=`, `youtu.be/`, `/shorts/` and `/embed/` are all understood.
2. **Played in the app**: visitors see the cover image with a play button; tapping it loads the embedded YouTube player (privacy-enhanced `youtube-nocookie.com`).
3. **QR locks**: a locked model does not receive the video id at all. Anyone who is allowed to see a model can, of course, find the YouTube link, so use Unlisted rather than Private (Private videos cannot be embedded).
4. **No upload, no compression, no size limit** on the server. Videos are not available offline; photos and covers still are.
5. **Cover images**: each video can have its own cover image (Admin > Models), separate from the folder image.

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
│   ├── start.js              # Entry point (restores db.json from the bucket, then starts server.js)
│   ├── storage.js            # Local-disk or Google Cloud Storage backend
│   ├── video.js              # ffmpeg helper that shrinks uploaded photos
│   ├── seed.js               # Initial dataset containing 32 model kits
│   ├── seed-images/          # Preloaded stock photos for the 32 models
│   ├── Dockerfile
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
- **Server Media Storage**: `data/uploads/` (photos and cover images when STORAGE is local).
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

### Deploying to Google Cloud: two Cloud Run services + a bucket

| Part | Folder | Runs on |
| :--- | :--- | :--- |
| Backend (API, QR rules, database) | `backend/` | Cloud Run service (builds from `backend/Dockerfile`) |
| Frontend (the app screens) | `frontend/` | Cloud Run service (nginx, builds from `frontend/Dockerfile`) |
| Photos, videos, `db.json` | n/a | Google Cloud Storage bucket |

The frontend (nginx) forwards `/api`, `/media` and `/brand` to the backend, so visitors see one address (login cookies, QR links and offline mode work without CORS). Set `BACKEND_URL` and `BACKEND_HOST` on the frontend service.

**Bucket storage** (`GCS_BUCKET=<name>`) holds the photos, cover images and `db.json`; the videos are on YouTube. Files stay private: visitors receive them through the backend, so the QR locks still apply. The database (`db.json`) is saved in the bucket and restored on start, so a restarted or redeployed container keeps its data. Requirements: the service runs as a service account with **Storage Object Admin** on the bucket. Keep **1 instance only** (`db.json` is a single file).

Backend Cloud Run settings: **1 instance only** (`db.json` is a single file), CPU always allocated (it saves the database in the background), 1 CPU / 1 GiB memory, `TRUST_PROXY=3`.

| Variable | Purpose |
| :--- | :--- |
| `GCS_BUCKET` | Bucket name (only the name, no `gs://`); turns on bucket storage |
| `ADMIN_PASSWORD` | Admin password for the first start |
| `SESSION_SECRET` | Optional cookie signing key (stored in the bucket if unset) |
| `PUBLIC_URL` | Frontend address, used in QR links |
| `MAX_UPLOAD_MB` | Largest photo upload (default 1024; photos are small, so this rarely matters) |
| `TRUST_PROXY` | Number of proxies in front of the backend (3 behind two Cloud Run services) |
| `GCS_PREFIX` | Optional folder inside the bucket |
| `STORAGE` | Optional: `local` forces disk storage (development) |
| `FRONTEND_DIR` | Folder the backend also serves (local development; default `../frontend`) |

### Default Credentials
- **Username**: `admin`
- **Password**: `admin123` *(Change via Admin > Settings after first login)*

### Production Environment Variables
- `PORT`: Server listening port (default: `3000`).
- `DATA_DIR`: Directory for database and uploads (default: `./data`).
- `PUBLIC_URL`: Full domain URL for production QR code generation (e.g. `https://models.botclub.in`).
- `ADMIN_PASSWORD`: Pre-set password for the initial seed admin account.

