# Handover: kanban board, print agent, deploy

Last updated 2026-10-26 (tooling moved to the Linux machine that also hosts Deployer). Work was stopped on request; this file is the brief for whoever (person or AI session) picks it up.

## What exists

| Part | Where | State |
|---|---|---|
| Pub/sub server | `kanban/server.mjs`, tests in `kanban/server.test.mjs` | Done, incl. Google sign-in, editor site, editor storage and raw prints (`docs/WEB.md`). `cd kanban && npm test` passes (12 tests). Node 20+, no dependencies. |
| Editor web build | `src/web/`, `vite.web.config.ts`, `npm run build:web` / `npm run start:web` | Done. Electron build unchanged. |
| Web UI | `kanban/public/index.html` (one file, inline CSS/JS) | Done. Interaction-checked in a browser at 1440 px and 375 px touch (drag, keyboard moves, edit, delete confirm, print, sign-in/out); four UI audit rounds. |
| Linux print agent | `agent/` (`printer_agent.py`, `install.sh`, systemd unit, env example, README) | Done: task and raw jobs, persisted state (`/var/lib/kanban-print-agent`) so restarts never reprint, transient printer errors retried. `python3 -I agent/printer_agent.py --self-test` passes. Not yet run against a real printer. |
| End-to-end | server + agent + a file standing in for `/dev/usb/lp0` | Passed for task labels and raw editor prints (bytes unchanged). A title containing `"\r\nPRINT 9,9` stayed inside one TEXT string. |
| Audits | `docs/audits/2026-10-26-round-{1..4}.md` | Four rounds (security, correctness, UI). Every finding at medium or above fixed; accepted lows listed in each record. |
| Design rules | `STYLE_GUIDE.md` | Written. |
| Knowledge graph | `graphify-out/` (git-ignored) | Built; code refreshed 2026-10-26 with `graphify update .` (1034 nodes). Doc changes are not re-extracted yet: run `/graphify . --update` for those. |

Deployed 2026-10-27. Not done yet: the print agent on this machine and a first real print (see "Next steps"). See "Next steps".

## How it works (one paragraph each)

**Store.** Every change is an event (`task.created`, `task.updated`, `task.deleted`, `print.requested`, `print.finished`) published on a topic (`tasks`, `print`). The broker appends it to the log first, then applies it to in-memory state, then fans it out to subscribers, strictly one at a time, so log order is apply order. If the append fails the request fails and nothing changes. Board state is the fold of the log (`apply()`), replayed on boot. Deployed, the log is the `kanban_events` table in the Deployer project's MariaDB, written through Deployer's data API with the app's `service` key; locally it is `kanban/data/events.jsonl`.

**Subscribers.** Browsers hold an SSE stream (`GET /api/stream`): a snapshot, then every event. `printer` and `resources` are ephemeral topics (not persisted). The print agent holds a pull subscription: `POST /api/agent/poll` every 3 s with its stats, printer readiness and results of jobs it finished; the reply carries up to 10 due jobs. Jobs are only handed out while the agent says the printer is ready, so while the printer is inactive they stay `queued` and print when it comes back. A `sent` job with no result after 60 s is handed out again; the agent remembers the last 200 finished job ids so a lost ack does not reprint.

**Auth.** Google sign-in (OAuth code + PKCE) on both sites, limited to `ALLOWED_EMAILS`; server-side sessions (`__Host-sid` cookie on https, 7 days sliding; sign-out ends the session on the server). Every non-GET API call must also carry `X-Requested-With: kanban`. Agent: `Authorization: Bearer AGENT_TOKEN`. Board CSP allows only its own inline script by hash. Full contract: `docs/WEB.md`.

**Two sites, one server.** The host picks the site: `kanban.liewjiaen.com` is the board, `printer-editor.liewjiaen.com` is the label editor's web build (`npm run build:web` → `web-dist/`, bridge in `src/web/`). Editor settings and templates live in table `editor_kv`; editor prints are raw TSPL jobs (`kind: "raw"`) that the agent writes to the printer unchanged.

**Labels.** The agent builds the TSPL itself (media size, density, speed, offsets live in `/etc/kanban-print-agent.env`, next to the printer). Default media is the editor's default, 40 × 30 mm, gap 2 mm.

## Deployer (https://deployer.liewjiaen.com)

The user always deploys to this instance. **It runs on this same Linux machine** (the one the repo is cloned on, `/home/jiaen`): systemd `deployer.service` (`/opt/deployer`, CLI `deployer`), Docker containers behind Caddy on `http://localhost:8080` (apps on 8100-8199), published as https://deployer.liewjiaen.com through a Cloudflare tunnel. Health: `curl http://localhost:8080/v1/health`. Drive the dashboard with Playwright (MCP server `playwright`) at http://localhost:8080; the user signs in there themselves.

- Project **Thermal Kanban**, id `a4cd4446-734a-4006-a445-aa72e3ea5cea`, managed MariaDB `main-sql` (healthy).
- API key **kanban-app**, role `service`, created. Do not copy its secret anywhere: attach it to the app (`api_key_id`), which injects `DEPLOYER_URL`, `DEPLOYER_PROJECT_ID`, `DEPLOYER_API_KEY`.
- **App `thermal-kanban/thermal-kanban`** is **live** (2026-10-27) at https://kanban.liewjiaen.com and https://printer-editor.liewjiaen.com: repo root, preset `node`, install `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci`, build `npm run build:web`, start `npm run start:web`, key `kanban-app` attached, push to `main` deploys. Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS`, `SESSION_SECRET`, `AGENT_TOKEN`, `KANBAN_ORIGIN`, `EDITOR_ORIGIN`, `DEPLOYER_SOURCE_ID` (main-sql; set as a workaround before the server learned to find the source through the schema endpoint, since API keys may not list data sources).
- Drive it from the CLI (signed in on this machine): `deployer app show|logs thermal-kanban/thermal-kanban`, `deployer env list|set <app> NAME`, `deployer deploy <app> --wait`. Read `AGENT_TOKEN` for the print agent with `deployer env list thermal-kanban/thermal-kanban --show` (never paste it into chat).
- Before any deploy, the deploy-website skill still asks the platform question; the answer so far has always been this instance.

## Linux server (printer side)

```bash
git clone https://github.com/nyx-ulrix/Thermal-printer-editor && cd Thermal-printer-editor
sudo sh agent/install.sh
sudo nano /etc/kanban-print-agent.env   # SERVER_URL=https://<board host>, AGENT_TOKEN=<same as on Deployer>
sudo systemctl restart kanban-print-agent
python3 /opt/kanban-print-agent/printer_agent.py --test-print   # calibration label
```

Details and troubleshooting: `agent/README.md`.

## Known limits (deliberate, marked `ponytail:` in code)

- Boot replays the whole log (raw label bytes live in their own table, so rows are small); add a snapshot row around 100k events.
- Finished jobs leave memory after a day; queued raw labels expire after an hour; at most 50 raw labels wait at once.
- Deploy the server and the print agent together: an older agent ignores the `expired` flag on stale raw jobs.
- The Deployer SQL source must be MariaDB (the server uses `ADD COLUMN IF NOT EXISTS`).
- A jammed USB printer can block the agent's write to `/dev/usb/lp0` with no timeout; `systemctl restart kanban-print-agent` clears it.
- One server instance only (the broker is in-process). Several replicas would need a shared broker (Deployer has Redis).
- The login rate limit keys on `cf-connecting-ip`, which is only trustworthy behind the Cloudflare tunnel.
- `cups:` printer targets are untested under the unit's `ProtectSystem=strict`.

## Next steps, in order

1. ~~Finish UI interaction checks.~~ Done 2026-10-26 (Playwright library; the Playwright MCP server cannot launch here because there is no Chrome at `/opt/google/chrome/chrome`).
2. ~~Audit loop.~~ Done 2026-10-26, four rounds. See `docs/audits/`.
3. ~~Commit, push to `main`.~~ Done.
4. ~~Deploy.~~ Done 2026-10-27. **Install the print agent on this machine**, point the Linux agent at the hostname and confirm the board shows PRINTER READY.
5. ~~Refresh the graph.~~ Done 2026-10-26; refresh again after code changes with `/graphify . --update`.

## Working instructions for the next session

These are the user's standing instructions for this work. Follow them without asking again.

### Parallel agents

Split independent work across background agents (Agent tool) and run them at the same time; keep the integration and final checks in the main session. Good splits: server vs UI vs Linux agent; one auditor per audit dimension. Give each agent a complete brief (files it owns, files it must not touch, the contract it codes against, what "done" looks like, a short report format) because it sees nothing else. Two agents never edit the same file. Verify every agent's report yourself (run the tests, look at the diff) before telling the user it is done.

### Audit loop

Audits run as several agents in parallel, each read-only and given the code, not your conclusions:

1. **Security**: `kanban/server.mjs`, `kanban/public/index.html`, `agent/` (auth, cookie, CSRF, CSP, rate limit, input validation, SSE limits, data API use, secret handling, TSPL injection, install script and systemd hardening, redirects and TLS in the agent, anything that lets someone on the internet print or read tasks).
2. **Correctness and robustness**: event ordering, replay, job delivery and redelivery, lost acks, reconnects, agent offline/online transitions, partial failures of the Deployer data API.
3. **UI/UX against taste**: load the `design-taste-frontend` skill (from https://github.com/Leonxlnx/taste-skill; use its app-screen run) and `STYLE_GUIDE.md`, then audit `kanban/public/index.html`. Apply only the parts that fit a dense app UI (design read, dials, layout, shape lock, WCAG AA contrast, labels above inputs, copy self-audit, reduced motion, type and spacing rhythm, mobile 375 px); ignore landing-page-only rules. Use Playwright (MCP server `playwright`) with screenshots at 1440 px and 375 px.

Each auditor returns findings as: file:line, severity, concrete failure scenario, suggested fix. The main session verifies each finding (reproduce or reason it through), fixes the confirmed ones (in parallel agents when the fixes touch different files), reruns `npm test`, the agent self-test and the end-to-end check, then **runs the audits again on the changed code**. Stop when a full round returns no confirmed findings at medium severity or above, or after 4 rounds (then list what is left for the user). Write the outcome of each round to `docs/audits/<date>-round-<n>.md`.

### Auto-continue and the weekly limit

The user wants this week's usage used up on this work: keep going through the steps above without stopping to ask, except for things that genuinely need the user (secrets, deploy platform question, anything outward-facing not already approved). If a session or usage limit stops work, resume as soon as it resets: this runs in the coding-agent CLI on the Linux machine, so schedule a one-off resume at the reset time with `/schedule` (prompt "Continue the work in HANDOVER.md from the first unfinished step") or, inside a `/loop`, `ScheduleWakeup`. On resume, read this file and `git log` first, and update this file's tables before stopping again.
