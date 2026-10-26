# Web sites: kanban board + label editor

One Node app (`kanban/server.mjs`) serves two sites, chosen by the request's host:

| Site | Production origin | Local dev origin |
|---|---|---|
| Kanban board | https://kanban.liewjiaen.com | http://kanban.localhost:4173 |
| Label editor (the React app in `src/`, built for the web) | https://printer-editor.liewjiaen.com | http://printer-editor.localhost:4173 |

Browsers resolve `*.localhost` to 127.0.0.1, so both dev origins hit the same server. A request whose host
(port ignored) equals the editor origin's hostname is the editor site; every other host is the kanban site.

Both sites are private: Google sign-in, and only allowed email addresses get in. The Windows (Electron)
app keeps working unchanged; the web build is a second way to run the same editor.

## Environment

| Variable | Meaning |
|---|---|
| `KANBAN_ORIGIN`, `EDITOR_ORIGIN` | Public origins above. Default to the local dev origins with `PORT`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth web client. Authorized redirect URIs: `<KANBAN_ORIGIN>/auth/callback` and `<EDITOR_ORIGIN>/auth/callback`. |
| `ALLOWED_EMAILS` | Comma-separated, case-insensitive. Only these Google accounts (with a verified email) get in. |
| `SESSION_SECRET` | At least 32 characters. Signs the OAuth-state cookie. Sessions are server-side (below), so rotating it no longer signs anyone out. |
| `AGENT_TOKEN` | Bearer token of the Linux print agent. At least 32 characters (shorter is only accepted with `ALLOW_OPEN_BOARD=1`). |
| `DEPLOYER_URL`, `DEPLOYER_PROJECT_ID`, `DEPLOYER_API_KEY` | Injected by Deployer; storage goes to the project's MariaDB through the data API (the key must be a service key with developer role: the server runs `CREATE`/`ALTER`/`SELECT` on the query endpoint). The SQL data source must be MariaDB, not MySQL: boot runs `ADD COLUMN IF NOT EXISTS` / `ADD UNIQUE INDEX IF NOT EXISTS`. Without them, storage is files under `DATA_DIR`. |
| `DATA_DIR` | File storage root: `events.jsonl`, `editor/`, `sessions/`, `payloads/` (directories created `0700`, files `0600`; leftover `*.tmp` files are deleted on boot). Default the directory of `EVENTS_FILE`, else `kanban/data/`. |
| `GOOGLE_TOKEN_URL` | Local testing only: a stand-in for Google's token endpoint. Refused when `NODE_ENV=production` or either origin is `https:`. |
| `WEB_DIST` | Built editor directory. Default `<repo>/web-dist`. |
| `ALLOW_OPEN_BOARD=1` | Local development only: no sign-in at all, `/api/me` answers `{"email":"dev@localhost"}`. Refused when `NODE_ENV=production` or either origin is `https:`. |

`BOARD_KEY` (the old passcode) is gone. The server refuses to start without the Google variables,
`ALLOWED_EMAILS` and `SESSION_SECRET` unless `ALLOW_OPEN_BOARD=1`. Boot reads from Deployer retry 5 times
with backoff (1, 2, 4, 8 s) before the process exits.

## Sign-in (same on both hosts; cookies are host-only)

Cookie names: on an `https:` site `__Host-sid` and `__Host-oauth` (both `Path=/`, so no sibling subdomain can
shadow them); on `http:` dev `sid` and `oauth` (`oauth` at `Path=/auth`), since browsers refuse `__Host-`
without `Secure`. When a request carries several cookies of one name, any one that checks out is accepted.
`https:` sites also send `Strict-Transport-Security: max-age=31536000`.

- `GET /auth/login?return=/path` sets cookie `oauth` (signed: state, PKCE verifier, nonce, return path;
  `HttpOnly; Secure; SameSite=Lax; Max-Age=600`) and redirects (302) to Google's authorize
  endpoint with `response_type=code`, `scope=openid email`, S256 PKCE, `state`,
  `nonce`, `redirect_uri=<this site's origin>/auth/callback`. `return` must be a same-site path starting
  with a single `/`, printable ASCII only (`\x21`-`\x7e`, no backslash); anything else becomes `/`.
  No account chooser by default: `prompt=select_account` is sent only with `?switch=1` (the 403 page's
  "Use a different Google account"). Otherwise an optional `?hint=<email>` (at most 254 chars, no spaces,
  quotes, `<>` or backslash, `x@y.z` shape; anything else is ignored) is forwarded as `login_hint`. Session
  cookies are per host, so the board's "Label editor" link goes to
  `<editorUrl>/auth/login?hint=<signed-in email>` and Google signs straight in to the same account.
- `GET /auth/callback` checks `state` against the cookie, exchanges the code at Google's token endpoint
  (client secret + verifier), reads the `id_token` from that direct TLS response and checks `iss`
  (`https://accounts.google.com` or `accounts.google.com`), `aud` = client id, `exp`, `nonce`,
  `email_verified === true`, and email in `ALLOWED_EMAILS`. Only a failed code exchange, bad claims or a
  not-allowed account count toward the per-IP sign-in limit (20 per 15 min → 429); a callback without the
  `oauth` cookie or with the wrong `state` (any page can make a browser load it) and a Google `error`
  (cancelled sign-in) do not. On success: a server-side session and cookie
  `sid` = a random 256-bit id (base64url; `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`), clears
  `oauth`, 302 to the return path. Not allowed: 403 HTML page naming the account and offering "Use a different Google account"
  (`/auth/login?switch=1`, plus `return`). Any other failure: 400 HTML page with a "Try again" link
  (`/auth/login?return=<path>` when the `oauth` cookie said where sign-in started, else `/auth/login`);
  429 when locked out. These pages use the board's look (cream paper, ink, Space Mono, square outlined
  link), have no scripts, and their CSP allows only inline styles, `fonts.googleapis.com` styles and
  `fonts.gstatic.com` fonts.
- Sessions: 7 days, sliding: a request with less than half the life left extends it to 7 days and re-sends
  the cookie. The renew only updates an existing row (never inserts) and is skipped if the session was
  logged out meanwhile; writes to one session run in order, so a logout racing a renew always wins. Stored as `sha256(id) -> {email, exp}` in memory and in table `kanban_sessions` (or files
  `DATA_DIR/sessions/<hash>.json`), so restarts keep everyone signed in. Every request re-checks the email
  against `ALLOWED_EMAILS`.
- `POST /auth/logout` (needs `X-Requested-With: kanban`) deletes the session server-side and clears `sid`, 204.
- `GET /api/me` → 200 `{"email", "kanbanUrl", "editorUrl"}` or 401.
- `Secure` is dropped from cookies only when the site origin is `http://` (local dev).

## Pages

- Kanban host `GET /` → `kanban/public/index.html` (public HTML, CSP by script hash as before). The page
  calls `/api/me`; on 401 it shows a sign-in screen whose button is a plain link to `/auth/login`.
- Editor host, any `GET` that is not `/api/*`, `/auth/*` or `/healthz`: not signed in → 302
  `/auth/login?return=<path>`. Signed in → the file from `WEB_DIST` if it exists, else `index.html`
  (SPA fallback). `/assets/*` gets `Cache-Control: private, max-age=31536000, immutable`; HTML `no-cache`.
  If `WEB_DIST` is missing: 503 "Editor not built: run npm run build:web".
- Editor CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' data: blob: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self';
  worker-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`.

## API (both hosts; every `/api/*` except the agent route needs a signed-in session)

Every non-GET `/api/*` and `/auth/logout` call must carry `X-Requested-With: kanban`. JSON in and out.
Kanban routes are unchanged (`/api/stream`, `/api/tasks`, `/api/tasks/:id`, `/api/tasks/:id/print`), except:

- `/api/stream`: at most 5 open streams per account (429), 50 in all (503). A stream whose reader stops
  reading is dropped after 30 s of unsent backlog.
- The snapshot's `jobs` holds the latest job of each task plus raw jobs requested in the last 24 h.
- Every job has `requested` (ms, when it was asked for; never changes) next to `ts` (last status change).
- `print.sent` is persisted, so after a restart a sent job stays sent with its original `ts` (and its 60 s
  resend grace). It only applies to a queued or sent job (a finished job stays finished); a repeated
  `print.requested` for an existing jobId is ignored.
- Finished jobs older than 24 h leave the server's memory (`/api/jobs/:id` → 404). Raw jobs still queued
  1 h after `requested` fail with `error: "Expired before the printer was ready"`; a sent raw job is in the
  agent's hands and waits for its result (resent every 60 s while the agent polls; the agent dedupes by
  jobId). A later `ok` result from the agent replaces an expiry. Task jobs never expire.
- Bad agent bearer tokens count toward their own per-IP limit (20 per 15 min, separate from sign-in) → 429.
  Each limiter tracks at most 10 000 IPs; when full, expired entries go first, then the oldest.

Editor storage (body limit 8 MB on these routes; 64 KB elsewhere):

| Route | Body / reply |
|---|---|
| `GET /api/editor/cache` | `{"values": {"<key>": <json>, ...}}` every stored key except `templates` |
| `PUT /api/editor/cache/:key` | `{"value": <json>}` → 204. `key` matches `^[A-Za-z0-9._-]{1,100}$`, never `templates`. `value: null` deletes. A new key equal to an existing one ignoring case → 409. |
| `GET /api/editor/templates` | `{"templates": [...]}` (`[]` when none) |
| `PUT /api/editor/templates` | `{"templates": [...]}` (must be an array) → 204 |

Quota: 200 keys (`templates` included) and 64 MB of stored JSON in all, writes still in flight included
(each write reserves its key and size before it starts); over either → 413.

Stored as table `editor_kv (k VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PRIMARY KEY, v LONGTEXT NOT NULL,
updated BIGINT NOT NULL)` (a table made before keeps its collation; the 409 rule covers it) through the data
API (PATCH by pk, POST when 404; DELETE for null), or files `DATA_DIR/editor/<key>.json` (write to a temp file,
then rename). Writes to one key are serialized. Values that are not valid JSON are dropped with a warning on boot.

Editor printing:

| Route | Body / reply |
|---|---|
| `GET /api/printer` | the printer status object the board already gets (`{state: "ready"|"inactive", reason, target, agent}`) |
| `POST /api/editor/print` | `{"payload": "<base64 TSPL bytes>", "description": "<= 140 chars", "jobId": "<optional lowercase UUID v4>"}`. `jobId` is an idempotency key: if a job with that id exists (or is being queued), the reply is 200 `{"job": {...}}` and nothing new is queued, whatever the printer state. A malformed `jobId` → 400. Decoded size 1 B..2 MB else 400/413. Printer not ready → 409 `{"error": "<reason>"}` and nothing is queued. 50 raw jobs already queued or sent → 503 `{"error": "50 labels are already waiting to print; ..."}`. Else stores the payload, then publishes persisted `print.requested {jobId, kind: "raw", description}` → 202 `{"job": {...}}` |
| `GET /api/jobs/:jobId` | `{"job": {id, kind, status: "queued"|"sent"|"printed"|"failed", error, description, requested, ts}}` or 404 |

Payloads never enter the event log and never reach browsers (snapshot, SSE, `/api/jobs`). They live in table
`print_payloads (k = jobId, v = base64, updated)` (same shape as `editor_kv`) or files
`DATA_DIR/payloads/<jobId>.b64`, written before `print.requested` is published (removed again, before a
retry with the same jobId can start, if publishing fails; writes to one jobId run in order), loaded on boot only for unfinished raw jobs, and deleted on `print.finished`. Old logs whose
`print.requested` still carries `payload` replay as before. Kanban jobs keep `kind: "task"` (old events
without `kind` are task jobs).

Event log: every event has a client-made `id` (UUID). Deployer table `kanban_events` gains `eid VARCHAR(36)
NULL` with a unique index (added by `ALTER TABLE ... IF NOT EXISTS` on boot); an append that errors or times
out is looked up by `eid` before it counts as failed, and replay skips repeated ids. Boot reads the table in
pages of `seq > last`. The file log is read line by line: a torn last line is cut off with a warning, a bad
line followed by good ones stops the boot. An append that fails part-way (ENOSPC, EIO) is cut back to the
end of the last good line at once, or before the next append if that cut fails too.

Agent poll reply items: task jobs `{jobId, task: {...}}` as now; raw jobs `{jobId, raw: "<base64>"}`. The agent
sends raw bytes to the printer unchanged (the editor's TSPL already sets size, gap, density, speed).

## Web bridge in the editor (`src/web/`)

The web build installs `window.printer` and `window.appCache` (same interfaces as `electron/preload.ts`)
before React renders:

- On boot `GET /api/editor/cache`; 401 → `location.href = '/auth/login?return=' + current path`.
- `appCache.read(key)` answers synchronously from that preloaded map; `write` updates the map and PUTs.
- `readTemplates` / `writeTemplates` use `/api/editor/templates`.
- `printer.listPrinters()` → one printer `{name: "agent", displayName: "GP-3120TL via print agent", isDefault: true, status: 0 ready / 1 not}`.
- `printer.printRaw(name, bytes)` → POST `/api/editor/print`; 409 → `{ok: false, error}`. Then polls
  `/api/jobs/:id` every second for up to 60 s: `printed` → `{ok: true}`, `failed` → `{ok: false, error}`,
  timeout → `{ok: false, error: "Queued, but the print agent has not confirmed it yet. It will print when the printer is ready."}`.
  The bridge should send a fresh `jobId` (`crypto.randomUUID()`) per print and reuse it when retrying that
  same print, so a retry after a lost reply cannot print twice. A queued label that has not printed within
  1 h fails as expired.

## Build and deploy (Deployer app, project "Thermal Kanban")

- Repo root (`.`), preset `node`, branch `main`.
- Install: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci`. Build: `npm run build:web` (Vite → `web-dist/`).
  Start: `npm run start:web` (`node kanban/server.mjs`, listens on `$PORT`).
- Attach API key `kanban-app`. Environment (typed by the owner, never in chat): `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS`, `SESSION_SECRET`, `AGENT_TOKEN`, `KANBAN_ORIGIN`, `EDITOR_ORIGIN`.
- Domains: `kanban.liewjiaen.com` and `printer-editor.liewjiaen.com`, both on this app.
