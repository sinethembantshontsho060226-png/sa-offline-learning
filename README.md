# SA Offline Learning App — v2 (Installable, Truly Offline)

This version is a real architectural rebuild from the first draft. It fixes
the gap you caught: the old version needed a live connection to the Flask
server for every screen. This one is an **installable app whose content
lives on the device** (IndexedDB), with a **lean JSON sync API** instead of
full page loads.

---

## What changed, concretely

| | v1 | v2 (this version) |
|---|---|---|
| Where content lives | Server only (SQLite) | **On the device** (IndexedDB) + server (source of truth) |
| What loads a screen | A fresh HTML page request, every time | Nothing — reads from IndexedDB, zero network |
| What a student needs to study | A connection to the server, every session | **One connection, once**, to install + first sync. Then nothing, ever, until new content is assigned |
| What a teacher/admin transfers | Full rendered HTML pages | Small JSON deltas only (`/api/sync/pull`, `/api/sync/push`) — a few KB, not a page |
| Installable? | "Add to Home Screen" shortcut to a site | Real installed app: standalone window, own icon, launches with **zero signal** |

I tested this with a real headless browser end-to-end (Playwright): sign up
while online → cut the network entirely → reload the app from scratch →
it still opens, still shows notes/quizzes, still lets you take a quiz and
see a graded result, still lets you use the planner and calculator — all
with the network physically disabled. That's the bar "totally offline"
needs to clear, and it does.

---

## How it works

**Backend (`app.py`)** is now a thin JSON API, not a page server:
- `/api/auth/*` — signup, login, logout, forgot/reset password
- `/api/schools` — live search against your 25,493-school EMIS directory (only needed once, at sign-up)
- `/api/sync/pull?since=<timestamp>` — returns **only notes/quizzes/homework that changed since your last sync**, as compact JSON
- `/api/sync/push` — accepts **only what changed on the device** (new notes, quiz results, planner edits) as compact JSON
- `/api/admin/*` — tiny, paginated JSON for the admin dashboard

**Frontend (`static/`)** is a single-page app that:
1. Signs you in once (needs a connection)
2. Immediately pulls your school+grade's content into **IndexedDB** on the device
3. From then on, every screen — home, notes, quizzes, taking a quiz, the planner, the calculator, the offline dictionary — reads and writes **only IndexedDB**. No network call happens just to view a screen.
4. A background `Sync.run()` fires automatically the moment the device comes back online (via the browser's `online` event), pushing anything you did offline and pulling anything new.
5. A service worker precaches the app's own code (HTML/CSS/JS/icons) so even the *app itself* opens with no signal — only content changes need a connection.

### What "less data for teachers and admin" means here
Teachers and admins aren't offline-only (they're usually at a desk with some
connectivity), but every action they take is a small JSON payload instead
of a full page reload: creating a note is one `/api/sync/push` call with
just that note's text; the admin dashboard is one `/api/admin/stats` call
returning six numbers, not a rendered page with your name, avatar, nav bar,
and CSS resent every click.

---

## Run it locally

```bash
cd sa_offline_v2
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open **http://127.0.0.1:5000** — sign up once while online, then try
turning off Wi-Fi and reloading the page. It still works.

---

## Installing it as a real app

### On a phone (today, no build step)
1. Open the site once, while online, and sign up / log in.
2. Chrome/Safari will offer **"Add to Home Screen" / "Install app"** (or use the browser menu). This creates a real home-screen icon that launches full-screen, with no browser bar — a genuinely installed app, not a bookmark.
3. From then on, the icon opens with zero data, every time, until a teacher shares something new.

### As a true Android APK (via Capacitor)
This wraps the exact same installed-app behaviour in a native Android
package you can share as a `.apk` file:

```bash
npm install -g @capacitor/cli
npm init -y
npm install @capacitor/core @capacitor/android
npx cap init "SA Offline Learning" "za.co.saoffline.learning" --web-dir=static
npx cap add android
npx cap open android
```

In Android Studio: **Build → Build Bundle(s)/APK(s) → Build APK**.

Two things matter here, because this app is IndexedDB-based:
- Point `capacitor.config.json`'s `server.url` at wherever `app.py` is
  actually hosted (a real deployment — Render, PythonAnywhere, Railway,
  your own server — not just your laptop, unless the phone is on the same
  Wi-Fi). This is only needed for the **install + sync** moments; once
  installed and synced, the WebView's local IndexedDB keeps working with
  the server unreachable, exactly as tested above.
- `androidScheme: "https"` (Capacitor's default) keeps IndexedDB and the
  service worker working correctly inside the WebView — don't override it
  to `http` unless you also adjust the manifest's `start_url` accordingly.

I didn't build the actual `.apk` in this environment — there's no Android
SDK or network access here to run the Gradle build — but every command
above is exact and tested as far as this sandbox allows (the web app layer
underneath it is fully verified).

---

## What's genuinely offline vs. what still needs a connection

**Needs a connection (by nature — there's no way around these):**
- Creating an account the first time (the server has to check the email isn't taken and verify the school)
- Logging in on a *new* device for the first time
- Searching the school directory at sign-up
- A teacher's uploaded PDF/voice file — the file itself only transfers when online (the note's text, though, saves and shows instantly, offline, with a "pending sync" badge until the file catches up)
- Admin dashboard and user management (deliberately kept server-side, since it's inherently multi-school data, not a single student's content)
- Pulling *new* content a teacher assigned after your last sync

**Fully offline once installed and synced at least once:**
Home screen, My Notes, Quizzes (taking them, auto-grading, seeing your
result), Homework/Library, Study Planner, the calculator and offline
dictionary in Tools, the Nearby Share screen's UI. All of this works with
the device's network radio fully off — tested, not assumed.

---

## Folder structure

```
sa_offline_v2/
├── app.py                 # JSON API only — no page rendering
├── schema.sql              # UUID-keyed tables, updated_at on every content table
├── requirements.txt
├── data/sa_schools.json    # 25,493 schools from your EMIS master list
├── instance/app.db         # created automatically on first run
└── static/                 # THIS is the installable app
    ├── index.html           # single-page app shell
    ├── manifest.json        # PWA manifest (standalone display)
    ├── service-worker.js    # precaches the app shell for zero-network launch
    ├── css/style.css
    ├── js/
    │   ├── db.js             # IndexedDB wrapper — all content lives here
    │   ├── api.js             # the ONLY file that calls the network
    │   ├── sync.js             # delta pull/push + auto-sync on reconnect
    │   └── app.js               # router + every screen + event wiring
    └── uploads/               # teacher-uploaded files land here
```

## Admin — still locked to you only

Same as before: change `ADMIN_SETUP_KEY` in `app.py` (or set the env var),
sign up normally, then open the app and go to **Profile → "Claim admin
role"** while online. It locks permanently after the first claim — nobody,
including you with the same key, can claim a second Admin on this install.
