# Thermal Printer Editor

Label design and printing for the **Gprinter GP-3120TL** (TSPL, 203 dpi), in three parts that share one printer:

| Part | What it is | Where it runs |
|---|---|---|
| **Desktop editor** | Windows app for designing labels, saving templates and printing runs as raw TSPL | Windows 10/11, printer on USB |
| **Web editor** | The same editor in a browser, printing through the print agent | https://printer-editor.liewjiaen.com |
| **Kanban board** | A task board that prints a label for any card, with a live printer and server monitor | https://kanban.liewjiaen.com |
| **Print agent** | A small Linux service next to the printer that pulls print jobs from the server | The Linux machine the printer is plugged into |

The web editor and the board are one Node server (`kanban/server.mjs`); the host name decides which site a request gets. Both sites are private: Google sign-in, and only listed email addresses get in.

**[Download the Windows installer](https://github.com/nyx-ulrix/Thermal-printer-editor/releases/latest)**

## Contents

- [Desktop editor](#desktop-editor)
- [Web editor](#web-editor)
- [Kanban board](#kanban-board)
- [How printing works](#how-printing-works)
- [Architecture](#architecture)
- [Security](#security)
- [Run locally](#run-locally)
- [Server configuration](#server-configuration)
- [Deploy (Deployer)](#deploy-deployer)
- [Print agent](#print-agent)
- [HTTP API](#http-api)
- [Tests and checks](#tests-and-checks)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)
- [Known limits](#known-limits)
- [Further reading](#further-reading)

## Desktop editor

You lay out the label on a live preview, save it as a template, then fill in values and print a run, without changing the paper size in Windows printer preferences.

### Design
- Live label canvas with rulers, snap guides and a floating toolbar
- Add **text**, **lines**, **images**, **input fields** and **groups**
- Drag to move, resize from handles, align, bring forward or send back, rotate in quarter turns
- Click text on the label to retype it; the box grows with what you type
- Drop an image onto the label to place it, then adjust threshold, dither and invert for thermal output
- Group elements into rows or columns, with padding and gap
- Reorder layers by dragging, with the arrow keys on a focused grip, or with Move up / Move down on touch screens; click a group's arrow to hide its children
- Undo and redo while you design

### Media
- Width, height, gap, density, speed and print direction, set from the app
- Die-cut labels with a rounded-corner preview, or continuous stock
- Keep-out padding inside the label edge
- Size presets you can add and edit in Settings
- Warns when content sits past the 76 mm print width or off the label

### Fonts
- Built-in thermal and Roman faces, plus a starter set of common desktop fonts
- Import TTF or OTF files and reuse them on any text or input field
- Point sizes you can type or nudge

### Templates
- Save the full design: media, every element and every input field
- Open a template later and keep editing it
- Group templates on Home; click a group name to hide its cards
- Duplicate, move or delete from the Home preview cards

### Print
- Fill in text or image inputs without changing the design
- Drag input fields to choose the order they appear on the Print page
- Count-up fields bump serial numbers after each successful print, keeping zero padding
- Reuse values from the last run, or pick a saved fill
- Choose printer and copies; the job goes out as raw TSPL so the driver does not rewrite the label
- Ctrl+Enter prints from anywhere on the Print page
- Test print from Settings to check the connection

### Workspace
- Home, Design, Print and Settings
- Light, dark, or follow the system; the label preview stays white stock with black ink
- Remembers the last media size, copies, printer and theme

### Install

Install the Gprinter GP-3120TL driver so the printer appears in Windows, then run the setup exe from [Releases](https://github.com/nyx-ulrix/Thermal-printer-editor/releases). Templates stay on that computer as editable design files in the app data folder.

## Web editor

https://printer-editor.liewjiaen.com is the same React app as the desktop editor, built for the browser (`npm run build:web` → `web-dist/`). A small bridge (`src/web/bridge.ts`) stands in for the desktop app's file and printer access:

- **Settings and templates** are stored on the server (table `editor_kv`), so they follow your account across browsers and devices. A failed save rolls back to the last value the server confirmed.
- **Printing** sends the label as raw TSPL to the server, which queues it for the print agent. There is one printer, "GP-3120TL via print agent", shown ready or not ready from the agent's last report.
- After pressing Print the editor waits up to 60 s for the agent to confirm. If the printer is busy or offline the label stays queued and prints when the printer is back. A queued editor label that has not printed within **1 hour** is dropped as expired, so an old label never comes out unexpectedly.
- Each print carries its own job id, and a retry reuses it, so a retry after a lost reply never prints twice.
- **Phones** (up to 820 px wide) get a stacked layout, a canvas zoomed to fit the width, touch-sized controls and tap wording.

## Kanban board

https://kanban.liewjiaen.com is a three-column board (**To do**, **Doing**, **Done**) whose cards can be printed as labels.

- **Cards** have a title (up to 140 characters), optional notes (up to 1000), an urgency (low, medium or high) and an optional due date and time. Add them with the New task form; edit or delete them on the card (delete asks to confirm).
- **Colours:** a band across the top of each card shows its urgency (low teal, medium yellow, high red) and its due date: "Due today", "Due tomorrow", the date, or **OVERDUE** once it has passed (not in Done). The card itself takes its column's colour: To do pale red, Doing pale yellow, Done pale blue.
- **Moving cards:** drag them to another column or use the arrow buttons. On a phone, hold a card for a moment (or press its dotted handle) to pick it up; the page scrolls when your finger nears the top or bottom edge.
- **Order:** within a column, cards sort by due date (soonest first, no date last), then by urgency (high first).
- **Folding columns:** tap a column's name to fold it away; Done starts folded. Each browser remembers your choice.
- **Due dates** are picked from a calendar in the board's own style, usable by keyboard (arrows move by day and week, Page Up/Down by month, Enter picks, Escape closes). The optional **due time** is typed beside it: `15:00`, `1500`, `9:30`, `3pm` and `3:30 pm` all work. A task with a time is overdue once that time passes.
- **Google Calendar sync** (Settings → Google Calendar → Connect): every open task with a due date becomes an event in a calendar called *Kanban* that the app creates in your Google account. It is all-day, or 30 minutes at the due time, coloured by urgency. Editing, moving or deleting the task updates the event within seconds; marking it done or clearing its date removes the event. The sync is one way (changes made in Google Calendar are not read back) and only ever touches events it made itself. *Sync now* and *Disconnect* are in Settings.
- **Install as an app:** in Chrome, use the install icon in the address bar (or Settings → Install app). The board and the label editor install separately, each with its own icon. The board's icon is a riso-printed to-do checkbox.
- **Print** on a card queues a label for it. One label per task waits at a time: pressing Print again while one is queued returns the same job instead of queuing another.
- **Live updates:** every open board sees changes instantly over Server-Sent Events; the board reconnects by itself after a drop.
- **Printer dot:** next to LIVE in the header, PRINTER has a teal dot when the printer is ready and a red one when it is down. Clicking it opens the details. Print buttons read *Queue print* while it is down; the label waits and prints when the printer is back.
- **Settings** (header button): your account (the signed-in email and Sign out), and a *Printer and resources* dropdown with the printer state and its reason, plus the resource monitor: the print agent's machine reports CPU, memory, disk, load, temperature and uptime with every poll (a NO AGENT stamp when it has stopped reporting).
- **Label editor link** in the header signs you in to the editor with the same Google account.

## How printing works

There are two kinds of print job, and both go through the same queue:

| Kind | Comes from | What the agent receives | How the label is built |
|---|---|---|---|
| `task` | Print on a kanban card | the task (title, notes, column, urgency, due date) | The agent builds the TSPL itself from the label settings in its env file: urgency and column on the top line, the due date in the footer |
| `raw` | Print in the web editor | base64 TSPL bytes | Sent to the printer unchanged; the editor's TSPL already sets size, gap, density and speed |

A job moves through `queued` → `sent` → `printed` or `failed`:

1. The server records `print.requested` in the event log. A raw job's bytes go to a separate store first and are deleted once the job finishes; they never reach the event log or any browser.
2. The agent polls `POST /api/agent/poll` every 3 seconds with its printer state, system stats and the results of finished jobs. Jobs are handed out only while the agent reports the printer ready, at most 10 per poll.
3. A handed-out job becomes `sent`. If no result arrives within 60 s it is handed out again; the agent remembers the last 200 finished job ids, so a lost acknowledgement never reprints.
4. The agent marks a job "printing" on disk before writing any byte. If it dies mid-write it reports that job failed on restart ("check the label and print again") instead of printing it twice.
5. If sending fails before anything reached the printer (printer off, connection refused), the job is not acknowledged and is redelivered later. If it fails part-way, the job is reported failed, since something may have printed.

Expiry rules:
- Task jobs never expire.
- A raw job still `queued` 1 hour after it was requested fails as expired.
- A raw job stuck as `sent` for over an hour is handed out flagged `expired`, and the agent fails it unless it already printed it. The server gives up on it after a further day. A late "printed" report always wins over an expiry.
- At most 50 raw jobs wait at once; the 51st is refused with a clear message.

## Architecture

```
 Browser (board)          Browser (web editor)                  Windows desktop editor
       |  SSE + JSON API          |  JSON API                          |  USB, raw TSPL
       v                          v                                    v
 +-------------------------------------------+                   GP-3120TL
 |  kanban/server.mjs  (Node 20+, no deps)   |
 |  - host routing: board / editor site      |
 |  - Google sign-in, sessions               |
 |  - event-sourced pub/sub broker           |
 |  - editor storage, print queue            |
 +-------------------------------------------+
       |  data API (service key)       ^  POST /api/agent/poll every 3 s (Bearer token)
       v                               |
 Deployer project MariaDB        agent/printer_agent.py (Linux, systemd)
 kanban_events, editor_kv,             |  /dev/usb/lp0, tcp://host:9100 or a raw CUPS queue
 kanban_sessions, print_payloads       v
                                   GP-3120TL
```

- **Event log.** Every change is an event (`task.created`, `task.updated`, `task.deleted`, `print.requested`, `print.sent`, `print.finished`) with a unique id. The broker appends it to the log first, then applies it to in-memory state, then fans it out to subscribers, one event at a time, so log order is apply order. If the append fails, the request fails and nothing changes. Board state is the fold of the log, replayed on boot (duplicate ids are skipped; a torn last line in the file log is cut off).
- **Topics.** `tasks` and `print` are persisted. `printer` and `resources` (agent reports) are ephemeral.
- **Storage.** Deployed, everything lives in the Deployer project's MariaDB through Deployer's data API: `kanban_events` (the log), `editor_kv` (editor settings and templates), `kanban_sessions`, `print_payloads` and `kanban_calendar` (the Google Calendar link; its refresh token is encrypted with a key derived from `SESSION_SECRET`). Locally it is files under `kanban/data/` (`events.jsonl`, `editor/`, `sessions/`, `payloads/`, `calendar/`; directories `0700`, files `0600`).
- **Calendar sync** (`kanban/calendar.mjs`) follows the `tasks` topic: each change queues the task, and changes in quick succession go out as one request. Event ids are `kb` + the task's UUID, so a re-added date reuses its event. Every 6 hours, on boot and on *Sync now* it reconciles: it removes its own events whose task is gone, done or undated. Failures retry with backoff up to 5 minutes; a revoked Google grant stops the sync until you connect again.
- **One instance.** The broker is in-process, so the server runs as a single instance.

## Security

- **Sign-in:** Google OAuth code flow with PKCE (S256), `state` and `nonce`, run on the server. The ID token is checked for issuer, audience, expiry, nonce and a verified email in `ALLOWED_EMAILS`, which is checked again on every request.
- **Sessions:** server-side, 7 days, extended while you use the site. The cookie is `__Host-sid` (`HttpOnly; Secure; SameSite=Lax`), per site; Sign out ends the session on the server.
- **Cross-site requests:** every state-changing API call must carry `X-Requested-With: kanban`. The live stream only answers same-origin requests.
- **Browser hardening:** a strict Content Security Policy on both sites (the board allows only its own inline script, by hash; the editor allows only its own scripts), HSTS on https, and no framing.
- **Rate limits:** 20 failed sign-ins per IP per 15 minutes, and a separate limit of 20 bad agent tokens per IP. Requests without a token don't count, so other web pages can't lock the agent out.
- **Agent:** a Bearer token of at least 32 characters, and https only (plain http only for localhost). It runs as an unprivileged user under a hardened systemd unit. Its token lives in a root-only env file and is removed from the process environment after start-up.
- **Label safety:** task text is escaped inside TSPL strings, so a title can't inject printer commands. Raw editor jobs are passed through unchanged; only allowed accounts can send them.
- **Limits:** request bodies are capped at 64 KB (8 MB for editor storage, 2 MB per raw label). There are at most 5 live streams per account and 50 in all. Editor storage is capped at 200 keys and 64 MB.

## Run locally

Needs Node.js 20 or later (and Python 3.8+ for the agent).

### Desktop editor

```bash
npm install
npm run dev          # Electron app with hot reload
npm run dist         # Windows installer: release/Receipt Printer Editor Setup <version>.exe
```

### Board and web editor

```bash
npm install
npm run build:web                    # builds the web editor into web-dist/
ALLOW_OPEN_BOARD=1 AGENT_TOKEN=dev-token npm run start:web
```

Then open http://kanban.localhost:4173 and http://printer-editor.localhost:4173 (browsers send `*.localhost` to your own machine). `ALLOW_OPEN_BOARD=1` skips sign-in and is refused with https origins or `NODE_ENV=production`. Data goes to `kanban/data/`.

The board alone, without building the editor: `cd kanban && ALLOW_OPEN_BOARD=1 AGENT_TOKEN=dev-token npm start`.

To try printing without a printer, point a local agent at a file:

```bash
SERVER_URL=http://localhost:4173 AGENT_TOKEN=dev-token PRINTER=/tmp/label.prn STATE_DIR=/tmp/agent-state \
  python3 agent/printer_agent.py
```

## Server configuration

| Variable | Required | Meaning |
|---|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | yes | Google OAuth web client. Authorized redirect URIs: `<KANBAN_ORIGIN>/auth/callback` and `<EDITOR_ORIGIN>/auth/callback`. |
| `ALLOWED_EMAILS` | yes | Comma-separated Google accounts allowed in (case-insensitive). |
| `SESSION_SECRET` | yes | At least 32 characters (`openssl rand -hex 32`). Signs the short-lived sign-in cookie. |
| `AGENT_TOKEN` | yes | The print agent's token, at least 32 characters. The same value goes in the agent's env file. |
| `KANBAN_ORIGIN`, `EDITOR_ORIGIN` | in production | Public origins, e.g. `https://kanban.liewjiaen.com`. Default `http://kanban.localhost:$PORT` and `http://printer-editor.localhost:$PORT`. |
| `PORT` | no | Listen port, default 4173 (Deployer sets it). |
| `DEPLOYER_URL`, `DEPLOYER_PROJECT_ID`, `DEPLOYER_API_KEY` | no | Injected by Deployer when an API key is attached; storage then moves to the project's MariaDB. The key needs the `service` role. |
| `DEPLOYER_SOURCE_ID` | no | Picks the SQL data source; by default the project's first SQL source is used. It must be MariaDB. |
| `DATA_DIR` | no | File storage root when not on Deployer. Default `kanban/data/`. |
| `WEB_DIST` | no | Built web editor directory. Default `web-dist/`. |
| `ALLOW_OPEN_BOARD=1` | no | Local development only: no sign-in (and no calendar sync). |
| `GOOGLE_TOKEN_URL`, `GOOGLE_CALENDAR_URL` | no | Local testing only: stand-ins for Google's token endpoint and Calendar API. Refused with https origins or `NODE_ENV=production`. |

The server refuses to start without the Google settings, `ALLOWED_EMAILS` and `SESSION_SECRET` (unless `ALLOW_OPEN_BOARD=1`), so a misconfigured deploy never comes up unprotected.

## Deploy (Deployer)

Live on the Deployer instance at https://deployer.liewjiaen.com, project **Thermal Kanban**, app `thermal-kanban/thermal-kanban`:

| Setting | Value |
|---|---|
| Repository | `https://github.com/nyx-ulrix/Thermal-printer-editor`, branch `main`, root `.` |
| Preset | `node` (Node 22) |
| Install | `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` |
| Build | `npm run build:web` |
| Start | `npm run start:web` |
| API key | `kanban-app` (role `service`), attached to the app |
| Domains | `kanban.liewjiaen.com`, `printer-editor.liewjiaen.com` |
| Environment | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS`, `SESSION_SECRET`, `AGENT_TOKEN`, `KANBAN_ORIGIN`, `EDITOR_ORIGIN` |

Every push to `main` deploys automatically. From the Deployer CLI:

```bash
deployer app show thermal-kanban/thermal-kanban        # status, addresses, variable names
deployer app logs thermal-kanban/thermal-kanban        # runtime logs
deployer deploy thermal-kanban/thermal-kanban --wait   # deploy now and follow the build
deployer env set thermal-kanban/thermal-kanban NAME    # set a variable (asks for the value, hidden)
deployer google-oauth thermal-kanban/thermal-kanban    # Google client: shows the redirect URIs, saves ID and secret
```

Health check: `GET /healthz` → 200 on either host.

**Google Calendar sync** needs two one-time settings in [Google Cloud Console](https://console.cloud.google.com/), on the project that holds the sign-in client:

1. *APIs & Services → Library*: enable **Google Calendar API**.
2. *Google Auth Platform → Data access → Add or remove scopes*: add `https://www.googleapis.com/auth/calendar.app.created` (lets the app create its own calendar and manage events in it, nothing else). Save.
   You can skip this step: Google then shows an "unverified app" warning while you link the calendar; tap *Advanced → Go to …* to continue. While the consent screen is in *Testing* mode, Google lets the calendar access lapse after 7 days; the board then shows **Reconnect** under Settings → Google, and one tap links it again.

Then connect from the board: Settings → Google Calendar → Connect. Google may show a "Google hasn't verified this app" screen, because the app is unverified; choose *Advanced → Go to …* to continue. No new environment variables are needed: the existing Google client and redirect URI are reused.

## Print agent

The agent (`agent/`) is one Python 3.8+ script using only the standard library, run by systemd on the machine the printer is plugged into. Install:

```bash
git clone https://github.com/nyx-ulrix/Thermal-printer-editor && cd Thermal-printer-editor
sudo sh agent/install.sh
sudo nano /etc/kanban-print-agent.env      # SERVER_URL=https://kanban.liewjiaen.com, AGENT_TOKEN=<same as the server>
sudo systemctl restart kanban-print-agent
journalctl -u kanban-print-agent -f        # logs
```

Re-run `install.sh` after `git pull` to upgrade; the env file is never overwritten. Upgrade the agent together with the server, since older agents ignore the `expired` flag on stale editor labels.

Main settings in `/etc/kanban-print-agent.env` (all documented in `agent/agent.env.example`):

| Setting | Default | Meaning |
|---|---|---|
| `SERVER_URL` | | The board's URL; https only (http only for localhost) |
| `AGENT_TOKEN` | | Same value as the server's `AGENT_TOKEN` |
| `PRINTER` | `/dev/usb/lp0` | Or `tcp://HOST:9100`, or `cups:QUEUE` for a raw CUPS queue |
| `LABEL_WIDTH_MM`, `LABEL_HEIGHT_MM`, `LABEL_GAP_MM` | 40, 30, 2 | Task label stock; gap 0 = continuous |
| `DENSITY`, `SPEED`, `DIRECTION` | 8, 4, 1 | Darkness 0-15, inches per second, 0/1 flips 180° |
| `OFFSET_X_DOTS`, `OFFSET_Y_DOTS` | 0, 0 | Calibration shift (8 dots = 1 mm) |
| `POLL_SECONDS` | 3 | Time between polls |

The label settings apply to task labels only; editor labels carry their own.

Useful commands:

```bash
sudo sh -c 'set -a; . /etc/kanban-print-agent.env; python3 /opt/kanban-print-agent/printer_agent.py --test-print'   # calibration label
python3 agent/printer_agent.py --dump-label "Some title"   # show the TSPL without printing
python3 -I agent/printer_agent.py --self-test               # built-in checks
sudo sh agent/install.sh --uninstall                         # remove (keeps the env file and job state)
```

Full details and troubleshooting: [agent/README.md](agent/README.md).

## HTTP API

All routes answer on both hosts. Every `/api/*` route except the agent's needs a signed-in session, and every non-GET call needs `X-Requested-With: kanban`.

| Route | Purpose |
|---|---|
| `GET /auth/login?return=/path` | Start Google sign-in (`hint=<email>` pre-selects an account, `switch=1` shows the chooser) |
| `GET /auth/callback` | Google's redirect back |
| `POST /auth/logout` | End the session |
| `GET /api/me` | `{email, kanbanUrl, editorUrl}` or 401 |
| `GET /api/stream` | Server-Sent Events: a snapshot, then every event |
| `POST /api/tasks` | Create a task `{title, notes?, column?, urgency?, due?, dueTime?, dueTz?}`; urgency `low`, `medium` (default) or `high`, due `YYYY-MM-DD` or empty, dueTime `HH:MM` (needs a due date), dueTz an IANA zone |
| `PATCH /api/tasks/:id` | Change a task (any of title, notes, column, urgency, due, order) |
| `DELETE /api/tasks/:id` | Delete a task |
| `POST /api/tasks/:id/print` | Queue a label for the task |
| `GET /auth/calendar` | Connect Google Calendar (board host, signed in): Google consent, then back to `/?calendar=connected` |
| `GET /api/calendar` | Sync status `{available, connected, email, calendarId, lastSync, error, pending}` |
| `POST /api/calendar/sync`, `POST /api/calendar/disconnect` | Sync now; disconnect (revokes Google access) |
| `GET /manifest.webmanifest`, `/sw.js`, `/icons/<name>.png` | Install files, served without sign-in on both hosts |
| `GET /api/printer` | Printer state `{state: "ready" or "inactive", reason, target, agent}` |
| `POST /api/editor/print` | Queue a raw label `{payload: base64 TSPL, description, jobId?}` |
| `GET /api/jobs/:id` | One job's status |
| `GET /api/editor/cache`, `PUT /api/editor/cache/:key` | Editor settings |
| `GET /api/editor/templates`, `PUT /api/editor/templates` | Editor templates |
| `POST /api/agent/poll` | The print agent's pull subscription (Bearer token) |
| `GET /healthz` | Health check |

Full contract, including every status code and limit: [docs/WEB.md](docs/WEB.md).

## Tests and checks

```bash
cd kanban && npm test                       # server tests (Node's built-in runner)
python3 -I agent/printer_agent.py --self-test
npm run typecheck                           # TypeScript, desktop and web
npm run build:web                           # web editor build
npm run build                               # desktop build
```

## Project layout

```
electron/            Desktop main process: window, app cache, raw printing to the Windows spooler
src/                 The React editor shared by desktop and web
  components/        Canvas, panels, toolbar, Home / Print / Settings views
  lib/               TSPL generation, rasterising, media, fonts, layout, storage
  web/               Web build entry and the bridge to the server API
kanban/
  server.mjs         The server: both sites, sign-in, broker, storage, print queue
  server.test.mjs    Server tests
  public/index.html  The board (one file, inline CSS and JS)
agent/               Linux print agent, systemd unit, installer, env example
docs/WEB.md          Web and API contract
docs/audits/         Security, correctness and UI audit records
STYLE_GUIDE.md       Visual rules for the board
HANDOVER.md          Current state and next steps
vite.web.config.ts   Web editor build config
```

## Troubleshooting

- **Board says NO AGENT:** the agent isn't polling. Check `systemctl status kanban-print-agent` and its logs; `bad AGENT_TOKEN (HTTP 401)` means the token differs from the server's.
- **Board says the printer isn't ready:** the agent runs but can't reach the printer. Check `ls -l /dev/usb/lp0` (load the module with `sudo modprobe usblp`), that the `kanban-print` user is in group `lp`, and that CUPS or `ipp-usb` hasn't claimed the printer.
- **"Not allowed" after Google sign-in:** that account isn't in `ALLOWED_EMAILS`; use "Use a different Google account".
- **"Too many failed attempts":** the IP is locked out for 15 minutes after 20 failed sign-ins.
- **Editor print says it's queued but nothing prints:** it waits for the printer, and expires after an hour if the printer doesn't come back.
- **Deploy fails at "Starting":** read `deployer app logs thermal-kanban/thermal-kanban`. The server names any missing setting.
- **Labels shifted, faint or skipping:** adjust `OFFSET_*_DOTS` or `DENSITY`, and check `LABEL_GAP_MM` matches the stock (run the printer's gap calibration by holding FEED at power-on).

## Known limits

- Boot replays the whole event log; a snapshot would be needed around 100k events.
- One server instance only (the broker is in-process).
- A jammed USB printer can block the agent's write; `sudo systemctl restart kanban-print-agent` clears it.
- The sign-in rate limit trusts the `cf-connecting-ip` header, which is only reliable behind the Cloudflare tunnel.
- `cups:` printer targets are untested under the service's strict filesystem protection.

## Further reading

- [docs/WEB.md](docs/WEB.md): the full web and API contract
- [agent/README.md](agent/README.md): print agent install, calibration and troubleshooting
- [STYLE_GUIDE.md](STYLE_GUIDE.md): the board's design rules
- [docs/audits/](docs/audits/): audit rounds and accepted findings
- [HANDOVER.md](HANDOVER.md): current state and next steps
