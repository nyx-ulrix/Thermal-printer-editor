// Kanban board + resource monitor for the thermal printer, and the web host of the label editor.
// Tasks live in an append-only event log published on pub/sub topics; the board is the fold
// of that log. One server, two sites chosen by Host (docs/WEB.md). Node 20+ standard library only.
import http from 'node:http'
import { appendFile, mkdir, open as openFile, readFile, readdir, rename, stat, truncate, unlink, writeFile } from 'node:fs/promises'
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const COLUMNS = ['todo', 'doing', 'done']
export const COLORS = ['red', 'blue', 'yellow', 'pink']
const AGENT_STALE_MS = 15_000
const RESEND_AFTER_MS = 60_000
const HISTORY = 60
const MAX_BODY = 64 * 1024
const MAX_EDITOR_BODY = 8 * 1024 * 1024
const MAX_RAW = 2 * 1024 * 1024
const MAX_CLIENTS = 50
const MAX_STREAMS_PER_EMAIL = 5
const STALL_MS = 30_000
const SESSION_MS = 7 * 24 * 3600_000
const OAUTH_MS = 600_000
const DAY_MS = 24 * 3600_000
const EXPIRE_RAW_MS = 3600_000
const MAX_KEYS = 200
const MAX_EDITOR_TOTAL = 64 * 1024 * 1024
const MAX_RAW_JOBS = 50
const MAX_FAILURES = 20
const FAILURE_MS = 15 * 60_000
const MAX_TRACKED_IPS = 10_000
const EXPIRED = 'Expired before the printer was ready'
const KEY_RE = /^[A-Za-z0-9._-]{1,100}$/
const UUID_RE = /^[0-9a-f-]{36}$/
const UUID4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SID_RE = /^[A-Za-z0-9_-]{43}$/
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// ---------- state: the fold of the event log ----------

export function emptyState() {
  return { tasks: new Map(), jobs: new Map(), payloads: new Map(), events: 0 }
}

export function apply(state, { type, data, ts }) {
  switch (type) {
    case 'task.created':
      state.tasks.set(data.id, { ...data, created: ts, updated: ts })
      break
    case 'task.updated': {
      const task = state.tasks.get(data.id)
      if (task) Object.assign(task, data, { updated: ts })
      break
    }
    case 'task.deleted':
      state.tasks.delete(data.id)
      for (const [id, job] of state.jobs) if (job.taskId === data.id) state.jobs.delete(id)
      break
    case 'print.requested':
      // Old events have no kind: they are task jobs. Raw payloads never go into a job object.
      // `requested` never changes; `ts` follows the latest status change. A repeated jobId changes nothing.
      if (state.jobs.has(data.jobId)) break
      // A print that raced its task's deletion would never be handed out or pruned.
      if (data.kind !== 'raw' && !state.tasks.has(data.taskId)) break
      if (data.kind === 'raw') {
        state.jobs.set(data.jobId, { id: data.jobId, kind: 'raw', description: data.description ?? '', status: 'queued', error: null, requested: ts, ts })
        // Logs written before payloads moved to their own store still carry the bytes.
        if (typeof data.payload === 'string') state.payloads.set(data.jobId, data.payload)
      } else {
        state.jobs.set(data.jobId, { id: data.jobId, kind: 'task', taskId: data.taskId, status: 'queued', error: null, requested: ts, ts })
      }
      break
    case 'print.sent': {
      const job = state.jobs.get(data.jobId)
      // A finished job stays finished.
      if (job && (job.status === 'queued' || job.status === 'sent')) Object.assign(job, { status: 'sent', ts })
      break
    }
    case 'print.finished': {
      const job = state.jobs.get(data.jobId)
      if (job) Object.assign(job, { status: data.ok ? 'printed' : 'failed', error: data.ok ? null : data.error, ts })
      // A finished job is never handed out again, so its bytes are dead weight either way.
      state.payloads.delete(data.jobId)
      break
    }
  }
  return state
}

/** Persisted events are written before fan-out, one at a time, so log order is apply order. */
export function createBroker(state, store, now = Date.now) {
  const subs = new Map()
  let tail = Promise.resolve()

  function fanOut(event) {
    apply(state, event)
    for (const fn of subs.get(event.topic) ?? []) fn(event)
    return event
  }

  return {
    subscribe(topic, fn) {
      if (!subs.has(topic)) subs.set(topic, new Set())
      subs.get(topic).add(fn)
      return () => subs.get(topic).delete(fn)
    },
    publish(topic, type, data, persist = true) {
      // `id` lets a store recognise an append it already made (Deployer timeouts) and replay skip duplicates.
      const event = { id: randomUUID(), topic, type, data, ts: now() }
      if (!persist) return Promise.resolve(fanOut(event))
      const run = tail.then(async () => {
        await store.append(event)
        state.events += 1
        return fanOut(event)
      })
      tail = run.catch(() => {})
      return run
    }
  }
}

// ---------- input validation (the web is untrusted) ----------

function text(value, max, field) {
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new HttpError(400, `${field} is longer than ${max} characters`)
  return trimmed
}

export function validTask(body, partial = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object')
  const out = {}
  if (!partial || body.title !== undefined) {
    out.title = text(body.title ?? '', 140, 'title')
    if (!out.title) throw new HttpError(400, 'title is required')
  }
  if (body.notes !== undefined) out.notes = text(body.notes, 1000, 'notes')
  if (body.column !== undefined) {
    if (!COLUMNS.includes(body.column)) throw new HttpError(400, `column must be one of ${COLUMNS.join(', ')}`)
    out.column = body.column
  }
  if (body.color !== undefined) {
    if (!COLORS.includes(body.color)) throw new HttpError(400, `color must be one of ${COLORS.join(', ')}`)
    out.color = body.color
  }
  if (body.order !== undefined) {
    if (typeof body.order !== 'number' || !Number.isFinite(body.order)) throw new HttpError(400, 'order must be a number')
    out.order = body.order
  }
  return out
}

/** Editor print body → normalized base64 payload and description. */
export function validRawPrint(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object')
  const { payload } = body
  if (typeof payload !== 'string' || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    throw new HttpError(400, 'payload must be base64')
  }
  const bytes = Buffer.from(payload, 'base64')
  if (!bytes.length) throw new HttpError(400, 'payload is empty')
  if (bytes.length > MAX_RAW) throw new HttpError(413, 'payload is larger than 2 MB')
  return { payload: bytes.toString('base64'), description: text(body.description ?? '', 140, 'description') }
}

/** A same-site path starting with exactly one slash, or '/'. */
export function safeReturn(value) {
  if (typeof value !== 'string' || value.length > 2000) return '/'
  // Printable ASCII only: anything else cannot go into a Location header as is.
  if (!value.startsWith('/') || value.startsWith('//') || /[^\x21-\x7e]|\\/.test(value)) return '/'
  try {
    return new URL(value, 'http://x.invalid').origin === 'http://x.invalid' ? value : '/'
  } catch {
    return '/'
  }
}

const num = (value, lo, hi) => (Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : 0)
const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '')

/** The agent is trusted by token, but its numbers still reach every browser, so clamp them. */
export function cleanAgentReport(body) {
  const s = body?.stats ?? {}
  const p = body?.printer ?? {}
  return {
    stats: {
      host: str(s.host, 64),
      cpu: num(s.cpu, 0, 100),
      mem: { usedMb: num(s.mem?.usedMb, 0, 1e7), totalMb: num(s.mem?.totalMb, 0, 1e7), pct: num(s.mem?.pct, 0, 100) },
      disk: { usedGb: num(s.disk?.usedGb, 0, 1e6), totalGb: num(s.disk?.totalGb, 0, 1e6), pct: num(s.disk?.pct, 0, 100) },
      load: [0, 1, 2].map((i) => num(s.load?.[i], 0, 1e4)),
      tempC: Number.isFinite(s.tempC) ? num(s.tempC, -50, 200) : null,
      uptimeS: num(s.uptimeS, 0, 1e10)
    },
    printer: { ready: p.ready === true, target: str(p.target, 128), detail: str(p.detail, 200) },
    results: (Array.isArray(body?.results) ? body.results : [])
      .slice(0, 50)
      .filter((r) => typeof r?.jobId === 'string')
      .map((r) => ({ jobId: r.jobId, ok: r.ok === true, error: r.ok === true ? null : str(r.error, 300) || 'Print failed' }))
  }
}

// ---------- storage ----------

const fatal = (message) => Object.assign(new Error(message), { fatal: true })

/** One JSON event per line. A torn last line (crash mid-append) is cut off with a warning; a bad
 * line with good lines after it is real corruption and stops the boot. `io` is for tests. */
export function fileStore(path, io = { appendFile, truncate }) {
  let size = null // bytes up to the end of the last good line
  let dirty = false // a failed append may have left a fragment after `size`
  async function cut() {
    try {
      await io.truncate(path, size)
    } catch (error) {
      if (error.code !== 'ENOENT' || size) throw error
    }
  }
  return {
    async load() {
      let handle
      try {
        handle = await openFile(path, 'r+')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        size = 0
        return []
      }
      const events = []
      let offset = 0
      let good = 0
      let torn = null
      let n = 0
      try {
        for await (const line of handle.readLines({ encoding: 'utf8', autoClose: false })) {
          n += 1
          const end = offset + Buffer.byteLength(line) + 1
          if (line.trim()) {
            if (torn) throw fatal(`${path}: line ${torn} is corrupt and later lines follow it; fix the file by hand`)
            try {
              events.push(JSON.parse(line))
              good = end
            } catch {
              torn = n
            }
          }
          offset = end
        }
        size = (await handle.stat()).size
        if (torn) {
          console.warn(`${path}: dropping unfinished last line ${torn}`)
          await truncate(path, good)
          size = good
        } else if (size) {
          // A complete last line without its newline would glue the next append onto it.
          const last = Buffer.alloc(1)
          await handle.read(last, 0, 1, size - 1)
          if (last[0] !== 0x0a) {
            await appendFile(path, '\n')
            size += 1
          }
        }
      } finally {
        await handle.close()
      }
      return events
    },
    async append(event) {
      const line = JSON.stringify(event) + '\n'
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      size ??= await stat(path).then((s) => s.size, (error) => (error.code === 'ENOENT' ? 0 : Promise.reject(error)))
      if (dirty) {
        await cut()
        dirty = false
      }
      try {
        await io.appendFile(path, line, { mode: 0o600 })
        size += Buffer.byteLength(line)
      } catch (error) {
        // A torn append (part written, then ENOSPC/EIO) would glue the next line onto its fragment:
        // cut back to the last good line now, or before the next append if that fails too.
        dirty = true
        await cut().then(() => (dirty = false), () => {})
        throw error
      }
    }
  }
}

/** Key/value files: <dir>/<key><ext>, written to a temp file then renamed (owner-only modes). Holds
 * editor values, sessions and raw print payloads. `update` writes only over an existing key. */
function fileKv(dir, ext = '.json') {
  return {
    async load() {
      const out = new Map()
      let names = []
      try {
        names = await readdir(dir)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      for (const name of names) {
        // Left by a crash between write and rename.
        if (name.endsWith('.tmp')) {
          await unlink(join(dir, name)).catch(() => {})
          continue
        }
        const key = name.slice(0, -ext.length)
        if (name.endsWith(ext) && KEY_RE.test(key)) out.set(key, await readFile(join(dir, name), 'utf8'))
      }
      return out
    },
    async put(key, value, { update = false } = {}) {
      const file = join(dir, `${key}${ext}`)
      if (value === null) return unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error })
      if (update && !(await stat(file).then(() => true, () => false))) return
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const temp = `${file}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, value, { mode: 0o600 })
        await rename(temp, file)
      } catch (error) {
        await unlink(temp).catch(() => {})
        throw error
      }
    }
  }
}

// `eid` is the event's own id: an append that timed out is looked up by it, replay skips repeats.
const CREATE_EVENTS = `CREATE TABLE IF NOT EXISTS kanban_events (
  seq BIGINT AUTO_INCREMENT PRIMARY KEY,
  eid VARCHAR(36) NULL,
  topic VARCHAR(32) NOT NULL,
  type VARCHAR(32) NOT NULL,
  data MEDIUMTEXT NOT NULL,
  ts BIGINT NOT NULL,
  UNIQUE KEY kanban_events_eid (eid)
);
ALTER TABLE kanban_events ADD COLUMN IF NOT EXISTS eid VARCHAR(36) NULL AFTER seq, ADD UNIQUE INDEX IF NOT EXISTS kanban_events_eid (eid)`
// Binary collation: keys are case-sensitive, as in memory. ponytail: an editor_kv created before this
// keeps its old (case-insensitive) collation; the server refuses case-only key collisions (409) instead.
const createKv = (name) => `CREATE TABLE IF NOT EXISTS ${name} (
  k VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PRIMARY KEY,
  v LONGTEXT NOT NULL,
  updated BIGINT NOT NULL
)`

/** The Deployer project's MariaDB through its data API; one SQL source shared by all tables. Writes go
 * through the rows endpoints (the query console logs its query text, so no payload goes there). */
function deployerApi({ url, key, projectId, sourceId }) {
  const base = `${url.replace(/\/$/, '')}/projects/${projectId}/data-sources`
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  let source

  async function call(target, init = {}) {
    const res = await fetch(target, { ...init, headers, signal: AbortSignal.timeout(15_000) })
    const body = await res.text()
    if (!res.ok) {
      const error = new Error(`Deployer ${init.method ?? 'GET'} ${res.status}: ${body.slice(0, 200)}`)
      error.status = res.status
      throw error
    }
    return body ? JSON.parse(body) : null
  }

  /** Runs SQL on the query endpoint; the last statement's rows as objects. */
  async function sql(query, maxRows = 500) {
    source ??= sourceId || (await call(base)).find((s) => s.kind === 'sql')?.id
    if (!source) throw new Error('No SQL data source in this Deployer project')
    const reply = await call(`${base}/${source}/query`, { method: 'POST', body: JSON.stringify({ query, max_rows: maxRows, timeout_seconds: 10 }) })
    const failed = reply.results?.find((r) => r.type === 'error')
    if (failed) throw new Error(`Deployer query failed: ${JSON.stringify(failed.error ?? failed).slice(0, 200)}`)
    const last = reply.results?.at(-1)
    return last?.type === 'rows' ? last.rows.map((row) => Object.fromEntries(last.columns.map((c, i) => [c, row[i]]))) : []
  }

  async function table(create, name) {
    await sql(create)
    return `${base}/${source}/tables/${name}/rows`
  }

  async function* rows(rowsUrl, orderBy, pageSize) {
    for (let offset = 0; ; offset += pageSize) {
      const page = await call(`${rowsUrl}?limit=${pageSize}&offset=${offset}&order_by=${orderBy}&order=asc`)
      yield* page.rows
      if (page.rows.length < pageSize) return
    }
  }

  return { call, sql, table, rows }
}

function deployerStore(api) {
  let rowsUrl
  const PAGE = 200
  return {
    async load() {
      rowsUrl = await api.table(CREATE_EVENTS, 'kanban_events')
      const events = []
      // ponytail: full replay on boot, add a snapshot row when the log reaches ~100k events
      for (let last = 0; ; ) {
        const page = await api.sql(`SELECT seq, eid, topic, type, data, ts FROM kanban_events WHERE seq > ${last} ORDER BY seq LIMIT ${PAGE}`, PAGE)
        for (const row of page) {
          events.push({ ...(row.eid && { id: row.eid }), topic: row.topic, type: row.type, data: JSON.parse(row.data), ts: Number(row.ts) })
        }
        if (page.length < PAGE) return events
        last = Number(page.at(-1).seq)
      }
    },
    async append(event) {
      const values = { eid: event.id, topic: event.topic, type: event.type, data: JSON.stringify(event.data), ts: event.ts }
      try {
        await api.call(rowsUrl, { method: 'POST', body: JSON.stringify({ values }) })
      } catch (error) {
        // A timeout or 5xx may still have committed: look the row up by its id before failing.
        // ponytail: an insert still in flight after this check shows up on the next boot (replay dedupes by eid).
        if (!UUID_RE.test(event.id)) throw error
        const found = await api.sql(`SELECT seq FROM kanban_events WHERE eid = '${event.id}'`, 1).catch(() => [])
        if (!found.length) throw error
      }
    }
  }
}

/** <name> rows (k, v, updated). The data API takes the primary key in the body: PATCH {pk, values}, DELETE {pk}.
 * `update` never inserts (PATCH only). */
function deployerKv(api, name, pageSize = 50) {
  let rowsUrl
  return {
    async load() {
      rowsUrl = await api.table(createKv(name), name)
      const out = new Map()
      for await (const row of api.rows(rowsUrl, 'k', pageSize)) if (KEY_RE.test(row.k)) out.set(row.k, row.v)
      return out
    },
    async put(key, value, { update = false } = {}) {
      const pk = { k: key }
      try {
        if (value === null) return await api.call(rowsUrl, { method: 'DELETE', body: JSON.stringify({ pk }) })
        await api.call(rowsUrl, { method: 'PATCH', body: JSON.stringify({ pk, values: { v: value, updated: Date.now() } }) })
      } catch (error) {
        if (error.status !== 404) throw error
        if (value === null || update) return
        await api.call(rowsUrl, { method: 'POST', body: JSON.stringify({ values: { k: key, v: value, updated: Date.now() } }) })
      }
    }
  }
}

/** Boot-time reads retry with backoff (1, 2, 4, 8 s) unless the error says retrying cannot help. */
async function withRetry(what, fn, tries = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      if (error.fatal || attempt >= tries) throw error
      console.warn(`${what} failed (${error.message}); retrying`)
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)))
    }
  }
}

// ---------- http helpers ----------

function sendJson(res, status, body) {
  if (body === undefined) {
    res.writeHead(status).end()
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function readJson(req, max = MAX_BODY) {
  if (Number(req.headers['content-length']) > max) throw new HttpError(413, 'Request body too large')
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > max) throw new HttpError(413, 'Request body too large')
    chunks.push(chunk)
  }
  if (!size) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'Body is not valid JSON')
  }
}

/** Every value sent under `name`: a sibling subdomain can plant a same-named cookie, so callers accept
 * the request if any one of them checks out. */
function cookieValues(req, name) {
  const out = []
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) out.push(rest.join('='))
  }
  return out
}

const digest = (value) => createHmac('sha256', 'kanban-compare').update(value).digest()
const sameSecret = (a, b) => timingSafeEqual(digest(a), digest(b))
const b64url = (buf) => Buffer.from(buf).toString('base64url')

/** Signed cookie values: base64url(JSON) "." base64url(HMAC). `exp` (ms) lives inside the signed part. */
export function signer(secret) {
  const mac = (body) => createHmac('sha256', secret).update(body).digest()
  return {
    sign: (payload) => {
      const body = b64url(JSON.stringify(payload))
      return `${body}.${b64url(mac(body))}`
    },
    verify(value) {
      const dot = typeof value === 'string' ? value.lastIndexOf('.') : -1
      if (dot < 1 || value.length > 4096) return null
      const body = value.slice(0, dot)
      const given = Buffer.from(value.slice(dot + 1), 'base64url')
      const want = mac(body)
      if (given.length !== want.length || !timingSafeEqual(given, want)) return null
      try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
        return payload && typeof payload === 'object' && typeof payload.exp === 'number' && payload.exp > Date.now() ? payload : null
      } catch {
        return null
      }
    }
  }
}

/** The id_token arrives in the direct TLS response from Google's token endpoint, so its claims are
 * trusted without checking the signature (OpenID Connect Core 3.1.3.7). Only the payload is read. */
export function jwtPayload(token) {
  const parts = typeof token === 'string' ? token.split('.') : []
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null
  } catch {
    return null
  }
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// Error pages share the board's paper, ink and type. No scripts; the only outside requests are Space Mono.
function sendPage(res, status, title, message, link, label) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap">
<style>html,body{background:#F4EFE6}body{margin:0;color:#1d1d1b;font:400 14px/1.55 "Space Mono",ui-monospace,Menlo,Consolas,monospace}
main{max-width:34rem;margin:0 auto;padding:clamp(48px,14vh,140px) 16px 48px}
h1{margin:0 0 18px;padding-bottom:12px;border-bottom:6px solid #1d1d1b;font-size:clamp(26px,5vw,40px);line-height:1;letter-spacing:-.03em;text-transform:uppercase;overflow-wrap:anywhere}
p{margin:0 0 22px;overflow-wrap:anywhere}
a{display:inline-flex;align-items:center;min-height:42px;padding:6px 14px;border:2px solid #1d1d1b;border-radius:0;color:#1d1d1b;text-decoration:none;font-weight:700;font-size:12px;line-height:1.2;letter-spacing:.08em;text-transform:uppercase}
a:hover{background:#1d1d1b;color:#F4EFE6}a:focus-visible{outline:3px solid #0078BF;outline-offset:3px}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${message}</p><p><a href="${escapeHtml(link)}">${escapeHtml(label)}</a></p></main></body></html>`
  res
    .writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    })
    .end(html)
}

/** `/auth/login` with a sanitized return path (omitted when it is just '/') and any extra params. */
const loginPath = (back, extra = {}) => {
  const params = new URLSearchParams(extra)
  const path = safeReturn(back)
  if (path !== '/') params.set('return', path)
  const qs = params.toString()
  return qs ? `/auth/login?${qs}` : '/auth/login'
}

/** A plausible email for Google's `login_hint`, or '' (only a hint: Google still asks the user). */
export function loginHint(value) {
  if (typeof value !== 'string' || value.length > 254) return ''
  return /^[^\s@<>"'\\]+@[^\s@<>"'\\]+\.[^\s@<>"'\\]+$/.test(value) ? value : ''
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY'
}

/** CSP allows exactly the inline scripts shipped in index.html, by hash. */
function pageCsp(html) {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    ([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`
  )
  return [
    "default-src 'self'",
    `script-src ${hashes.join(' ') || "'none'"}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ')
}

const EDITOR_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: blob: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm'
}

const hostname = (value) => {
  try {
    return new URL(`http://${value}`).hostname
  } catch {
    return ''
  }
}

/** Runs fn once every earlier call under the same key has settled: writes to one key land in order. */
function serial(locks, key, fn) {
  const run = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(fn)
  locks.set(key, run)
  run.finally(() => locks.get(key) === run && locks.delete(key)).catch(() => {})
  return run
}

/** Failed attempts per client IP: MAX_FAILURES within FAILURE_MS locks the IP out until the window ends. */
function limiter() {
  const failures = new Map() // ip -> { count, since }, oldest first
  const stale = (entry, now) => now - entry.since > FAILURE_MS
  return {
    limited(ip) {
      const entry = failures.get(ip)
      if (entry && stale(entry, Date.now())) failures.delete(ip)
      return (failures.get(ip)?.count ?? 0) >= MAX_FAILURES
    },
    fail(ip) {
      const now = Date.now()
      let entry = failures.get(ip)
      if (entry && stale(entry, now)) failures.delete(ip)
      entry = failures.get(ip)
      if (!entry) {
        if (failures.size >= MAX_TRACKED_IPS) for (const [key, other] of failures) if (stale(other, now)) failures.delete(key)
        // ponytail: still full means very many addresses at once; the oldest entry makes room (its lockout ends early)
        if (failures.size >= MAX_TRACKED_IPS) failures.delete(failures.keys().next().value)
        entry = { count: 0, since: now }
        failures.set(ip, entry)
      }
      entry.count += 1
    },
    clear: (ip) => failures.delete(ip)
  }
}

// ---------- the app ----------

/** `hooks` is for tests only (a stand-in token endpoint); it cannot come from the environment. */
export async function start(env = process.env, hooks = {}) {
  const agentToken = env.AGENT_TOKEN ?? ''
  const open = env.ALLOW_OPEN_BOARD === '1'
  const clientId = env.GOOGLE_CLIENT_ID ?? ''
  const clientSecret = env.GOOGLE_CLIENT_SECRET ?? ''
  const allowed = new Set((env.ALLOWED_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))
  const secret = env.SESSION_SECRET ?? ''
  const port = Number(env.PORT) || 4173
  const kanbanOrigin = new URL(env.KANBAN_ORIGIN || `http://kanban.localhost:${port}`).origin
  const editorOrigin = new URL(env.EDITOR_ORIGIN || `http://printer-editor.localhost:${port}`).origin
  const editorHost = new URL(editorOrigin).hostname
  const webDist = resolve(env.WEB_DIST || join(HERE, '..', 'web-dist'))
  if (open) {
    if (env.NODE_ENV === 'production' || kanbanOrigin.startsWith('https:') || editorOrigin.startsWith('https:')) {
      throw new Error('ALLOW_OPEN_BOARD=1 is for local development only: unset it, or NODE_ENV=production / https origins')
    }
  } else {
    const missing = [
      !clientId && 'GOOGLE_CLIENT_ID',
      !clientSecret && 'GOOGLE_CLIENT_SECRET',
      !allowed.size && 'ALLOWED_EMAILS',
      secret.length < 32 && 'SESSION_SECRET (at least 32 characters)'
    ].filter(Boolean)
    if (missing.length) throw new Error(`Set ${missing.join(', ')}, or ALLOW_OPEN_BOARD=1 for local development`)
    if (agentToken && agentToken.length < 32) throw new Error('AGENT_TOKEN must be at least 32 characters')
  }
  if (env.GOOGLE_TOKEN_URL && (env.NODE_ENV === 'production' || kanbanOrigin.startsWith('https:') || editorOrigin.startsWith('https:'))) {
    throw new Error('GOOGLE_TOKEN_URL is for local testing only: unset it, or NODE_ENV=production / https origins')
  }
  const cookies = signer(secret || randomBytes(32).toString('hex'))
  const tokenUrl = hooks.tokenUrl || env.GOOGLE_TOKEN_URL || GOOGLE_TOKEN_URL

  let store, kv, sessionKv, payloadKv
  if (env.DEPLOYER_URL && env.DEPLOYER_API_KEY) {
    const api = deployerApi({ url: env.DEPLOYER_URL, key: env.DEPLOYER_API_KEY, projectId: env.DEPLOYER_PROJECT_ID, sourceId: env.DEPLOYER_SOURCE_ID })
    store = deployerStore(api)
    kv = deployerKv(api, 'editor_kv')
    sessionKv = deployerKv(api, 'kanban_sessions')
    payloadKv = deployerKv(api, 'print_payloads', 5)
  } else {
    const dataDir = env.DATA_DIR || (env.EVENTS_FILE ? dirname(env.EVENTS_FILE) : join(HERE, 'data'))
    store = fileStore(env.EVENTS_FILE || join(dataDir, 'events.jsonl'))
    kv = fileKv(env.EDITOR_DIR || join(dataDir, 'editor'))
    sessionKv = fileKv(join(dataDir, 'sessions'))
    payloadKv = fileKv(join(dataDir, 'payloads'), '.b64')
  }
  const warn = (what) => (error) => console.warn(`${what}: ${error.message}`)

  const state = emptyState()
  const seen = new Set()
  for (const event of await withRetry('Loading events', () => store.load())) {
    if (event.id) {
      if (seen.has(event.id)) continue
      seen.add(event.id)
    }
    apply(state, event)
    state.events += 1
  }
  seen.clear()
  const unfinished = (job) => job.status === 'queued' || job.status === 'sent'
  const payloadLocks = new Map()
  const putPayload = (jobId, value) => serial(payloadLocks, jobId, () => payloadKv.put(jobId, value))

  // Payloads of unfinished raw jobs come back into memory (at most MAX_RAW_JOBS of them while serving);
  // any other stored payload is dead weight.
  for (const [jobId, payload] of await withRetry('Loading print payloads', () => payloadKv.load())) {
    const job = state.jobs.get(jobId)
    if (job?.kind === 'raw' && unfinished(job)) {
      if (!state.payloads.has(jobId)) state.payloads.set(jobId, payload)
    } else {
      putPayload(jobId, null).catch(warn(`Deleting payload ${jobId}`))
    }
  }

  const broker = createBroker(state, store)
  broker.subscribe('print', ({ type, data }) => {
    if (type === 'print.finished') putPayload(data.jobId, null).catch(warn(`Deleting payload ${data.jobId}`))
  })

  // ponytail: every editor value is held in memory (one owner, at most MAX_EDITOR_TOTAL)
  const editorValues = new Map()
  for (const [key, value] of await withRetry('Loading editor storage', () => kv.load())) {
    try {
      JSON.parse(value)
      editorValues.set(key, value)
    } catch {
      console.warn(`Editor value ${key} is not JSON; ignoring it`)
    }
  }
  const kvLocks = new Map()
  const reserved = new Set() // { key, size } of writes still in flight, counted by the quota

  /** Writes to one key run one at a time; the in-memory copy follows the store's order. */
  function putValue(key, value) {
    return serial(kvLocks, key, async () => {
      await kv.put(key, value)
      if (value === null) editorValues.delete(key)
      else editorValues.set(key, value)
    })
  }

  /** At most MAX_KEYS keys and MAX_EDITOR_TOTAL characters, writes in flight included; no two keys
   * differing only in case (MariaDB tables made before the binary collation compare keys
   * case-insensitively). Checks and reserves in one step: the reply releases the reservation. */
  async function putChecked(key, value) {
    let slot = null
    if (value !== null) {
      // Per key, the larger of the stored value and any write in flight.
      const sizes = new Map([...editorValues].map(([k, v]) => [k, v.length]))
      for (const r of reserved) sizes.set(r.key, Math.max(sizes.get(r.key) ?? 0, r.size))
      if (!sizes.has(key)) {
        if (sizes.size >= MAX_KEYS) throw new HttpError(413, `Editor storage is limited to ${MAX_KEYS} keys`)
        const lower = key.toLowerCase()
        for (const other of sizes.keys()) if (other.toLowerCase() === lower) throw new HttpError(409, `Key clashes with ${other}`)
      }
      // ponytail: counts UTF-16 units, not bytes
      let total = value.length
      for (const [other, size] of sizes) if (other !== key) total += size
      if (total > MAX_EDITOR_TOTAL) throw new HttpError(413, 'Editor storage is full (64 MB)')
      slot = { key, size: value.length }
      reserved.add(slot)
    }
    try {
      await putValue(key, value)
    } finally {
      reserved.delete(slot)
    }
  }

  // ---- sessions: random id in the cookie, sha256(id) -> {email, exp} in memory and in the store ----
  // Writes to one session run in order, so a logout always lands after a renew that started first.
  const sessions = new Map()
  const sessionLocks = new Map()
  const putSession = (hash, value, options) => serial(sessionLocks, hash, () => sessionKv.put(hash, value, options))
  for (const [hash, value] of await withRetry('Loading sessions', () => sessionKv.load())) {
    let session = null
    try {
      session = JSON.parse(value)
    } catch {}
    if (session && typeof session.email === 'string' && session.exp > Date.now()) sessions.set(hash, session)
    else putSession(hash, null).catch(warn('Deleting session'))
  }
  const sidHash = (id) => createHash('sha256').update(id).digest('hex')

  // ---- printer + resources (ephemeral topics) ----
  let agent = null // { lastSeen, stats, printer }
  const history = { cpu: [], mem: [] }
  const clients = new Set()
  const streamsByEmail = new Map()
  const startedAt = Date.now()

  function printerStatus(now = Date.now()) {
    const base = { agent: agent && { host: agent.stats.host, lastSeen: agent.lastSeen }, target: agent?.printer.target || null }
    if (!agent) return { state: 'inactive', reason: 'Print agent offline', ...base }
    if (now - agent.lastSeen > AGENT_STALE_MS) return { state: 'inactive', reason: 'Print agent stopped reporting', ...base }
    if (!agent.printer.ready) return { state: 'inactive', reason: agent.printer.detail || 'Printer not ready', ...base }
    return { state: 'ready', reason: 'Ready', ...base }
  }

  function resources() {
    const fresh = agent && Date.now() - agent.lastSeen <= AGENT_STALE_MS
    return {
      agent: fresh ? agent.stats : null,
      history,
      server: {
        rssMb: Math.round(process.memoryUsage().rss / 1048576),
        uptimeS: Math.round((Date.now() - startedAt) / 1000),
        events: state.events,
        clients: clients.size
      }
    }
  }

  let lastPrinter = ''
  function publishStatus() {
    const printer = printerStatus()
    const key = JSON.stringify([printer.state, printer.reason, printer.target, printer.agent?.host])
    if (key !== lastPrinter) {
      lastPrinter = key
      broker.publish('printer', 'printer.status', printer, false)
    }
    broker.publish('resources', 'resources.sample', resources(), false)
  }
  const ticker = setInterval(publishStatus, 5_000)

  // ---- the print topic ----
  const finishing = new Set() // job ids whose print.finished is being published

  async function finish(result) {
    const job = state.jobs.get(result.jobId)
    // A label that printed after all replaces its expiry.
    const takes = job && (unfinished(job) || (result.ok && job.status === 'failed' && job.error === EXPIRED))
    if (!takes || finishing.has(result.jobId)) return
    finishing.add(result.jobId)
    try {
      await broker.publish('print', 'print.finished', result)
    } finally {
      finishing.delete(result.jobId)
    }
  }

  /** Raw labels still queued after an hour fail instead of printing long after anyone wanted them;
   * finished jobs older than a day leave memory. Task jobs never expire: the task is still on the board.
   * A sent job is in the agent's hands: past the hour it is resent marked `expired` so the agent fails it
   * unless it already printed it, and after a further day it expires here (a late ok still replaces that). */
  async function upkeep(now = Date.now()) {
    for (const job of [...state.jobs.values()]) {
      const age = now - job.requested
      if (job.kind === 'raw' && ((job.status === 'queued' && age > EXPIRE_RAW_MS) || (job.status === 'sent' && age > EXPIRE_RAW_MS + DAY_MS))) {
        await finish({ jobId: job.id, ok: false, error: EXPIRED })
      }
    }
    for (const [id, job] of state.jobs) {
      if (!unfinished(job) && now - job.ts > DAY_MS) {
        state.jobs.delete(id)
        state.payloads.delete(id)
      }
    }
  }
  await upkeep().catch(warn('Expiring print jobs'))
  const upkeepTimer = setInterval(() => upkeep().catch(warn('Expiring print jobs')), 60_000)

  // ---- the agent's pull subscription to the print topic ----
  async function agentPoll(body) {
    const report = cleanAgentReport(body)
    const now = Date.now()
    agent = { lastSeen: now, ...report }
    history.cpu = [...history.cpu, report.stats.cpu].slice(-HISTORY)
    history.mem = [...history.mem, report.stats.mem.pct].slice(-HISTORY)

    for (const result of report.results) await finish(result)

    const jobs = []
    let rawBytes = 0
    if (report.printer.ready) {
      // ponytail: linear scan of every job; upkeep keeps the map to about a day of jobs
      for (const job of state.jobs.values()) {
        const due = job.status === 'queued' || (job.status === 'sent' && now - job.ts > RESEND_AFTER_MS)
        if (!due || finishing.has(job.id)) continue
        if (job.kind === 'raw') {
          const raw = state.payloads.get(job.id)
          if (!raw) continue
          // ponytail: at most ~4 MB of raw labels per reply; the rest go out on the next polls
          if (rawBytes && rawBytes + raw.length > 4 * 1024 * 1024) continue
          rawBytes += raw.length
          // A sent job the agent keeps failing to send (nothing went out) must not print hours later:
          // past the hour the agent answers it failed instead of printing, unless it already printed it.
          jobs.push({ jobId: job.id, raw, ...(now - job.requested > EXPIRE_RAW_MS && { expired: true }) })
        } else {
          const task = state.tasks.get(job.taskId)
          if (!task) continue
          jobs.push({ jobId: job.id, task: { id: task.id, title: task.title, notes: task.notes, column: task.column, color: task.color, created: task.created } })
        }
        // Persisted so a restart keeps the job sent (and its resend grace) instead of handing it out again.
        // ponytail: up to 10 sequential appends here; a slow Deployer (15 s each) can outlast the agent's 30 s timeout
        await broker.publish('print', 'print.sent', { jobId: job.id })
        if (jobs.length === 10) break
      }
    }
    publishStatus()
    return { jobs }
  }

  // ---- auth: Google sign-in, server-side sessions ----
  // Separate counters: guessing at one never locks the other out.
  const signInFailures = limiter()
  const agentFailures = limiter()
  const clientIp = (req) => req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown'

  // __Host- cookies cannot be shadowed by a sibling subdomain, but browsers only take them with Secure.
  const cookieName = (site, name) => (site.secure ? `__Host-${name}` : name)
  function setCookie(site, name, value, path, maxAge) {
    return `${cookieName(site, name)}=${value}; HttpOnly;${site.secure ? ' Secure;' : ''} SameSite=Lax; Path=${path}; Max-Age=${maxAge}`
  }
  const oauthPath = (site) => (site.secure ? '/' : '/auth')

  /** The signed-in email, renewing the session when less than half its life is left. */
  function signedIn(req, res, site) {
    if (open) return 'dev@localhost'
    const now = Date.now()
    for (const id of cookieValues(req, cookieName(site, 'sid'))) {
      if (!SID_RE.test(id)) continue
      const hash = sidHash(id)
      const session = sessions.get(hash)
      if (!session) continue
      if (session.exp <= now) {
        sessions.delete(hash)
        putSession(hash, null).catch(warn('Deleting session'))
        continue
      }
      // Removing an address from ALLOWED_EMAILS signs it out at once.
      if (!allowed.has(session.email)) continue
      if (session.exp - now < SESSION_MS / 2) {
        session.exp = now + SESSION_MS
        // Update only, and only while the session is live: a renew never brings a logged-out session back.
        serial(sessionLocks, hash, async () => {
          if (sessions.get(hash) === session) await sessionKv.put(hash, JSON.stringify(session), { update: true })
        }).catch(warn('Renewing session'))
        res.setHeader('Set-Cookie', setCookie(site, 'sid', id, '/', SESSION_MS / 1000))
      }
      return session.email
    }
    return null
  }

  function login(req, res, site, query) {
    const back = safeReturn(query.get('return'))
    if (open) return res.writeHead(302, { Location: back, 'Cache-Control': 'no-store' }).end()
    const stateParam = b64url(randomBytes(24))
    const nonce = b64url(randomBytes(24))
    const verifier = b64url(randomBytes(48))
    const challenge = b64url(createHash('sha256').update(verifier).digest())
    const value = cookies.sign({ state: stateParam, verifier, nonce, back, exp: Date.now() + OAUTH_MS })
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${site.origin}/auth/callback`,
      response_type: 'code',
      scope: 'openid email',
      state: stateParam,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    })
    // The account chooser only on request ("Use a different Google account"); otherwise Google signs in
    // the current account, steered by the hint the other site passes along.
    if (query.get('switch') === '1') params.set('prompt', 'select_account')
    else {
      const hint = loginHint(query.get('hint'))
      if (hint) params.set('login_hint', hint)
    }
    res
      .writeHead(302, {
        Location: `${GOOGLE_AUTH_URL}?${params}`,
        'Set-Cookie': setCookie(site, 'oauth', value, oauthPath(site), OAUTH_MS / 1000),
        'Cache-Control': 'no-store'
      })
      .end()
  }

  async function callback(req, res, site, query) {
    if (open) return res.writeHead(302, { Location: '/' }).end()
    const ip = clientIp(req)
    const clearOauth = setCookie(site, 'oauth', '', oauthPath(site), 0)
    // Only a failed code exchange or bad claims count toward the lockout: a callback without our cookie
    // or state (any page can load the URL) or a Google error (a cancelled sign-in) is not a guess.
    const code = query.get('code')
    const returned = query.get('state') ?? ''
    const pending = cookieValues(req, cookieName(site, 'oauth'))
      .map((value) => cookies.verify(value))
      .find((p) => p && typeof p.state === 'string' && sameSecret(returned, p.state))
    // "Try again" goes back to the same page the sign-in started from.
    const again = loginPath(pending?.back)
    const fail = (why, counts = true) => {
      if (counts) signInFailures.fail(ip)
      // Quoted: parts of `why` come from the request or from Google.
      if (why) console.warn(`Sign-in failed: ${JSON.stringify(why)}`)
      res.setHeader('Set-Cookie', clearOauth)
      sendPage(res, 400, 'Sign-in failed', 'Google sign-in did not complete. It may have been cancelled or taken too long.', again, 'Try again')
    }
    if (signInFailures.limited(ip)) return sendPage(res, 429, 'Too many attempts', 'Too many failed sign-ins. Wait 15 minutes, then try again.', again, 'Try again')

    if (!pending) return fail('bad state', false)
    if (!code) return fail(query.get('error') && `Google said ${str(query.get('error'), 64)}`, false)

    let claims
    try {
      const reply = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: `${site.origin}/auth/callback`,
          code_verifier: pending.verifier
        }),
        signal: AbortSignal.timeout(10_000)
      })
      if (!reply.ok) return fail(`token endpoint ${reply.status}`)
      claims = jwtPayload((await reply.json())?.id_token)
    } catch (error) {
      return fail(`token exchange: ${error.message}`)
    }
    if (
      !claims ||
      !GOOGLE_ISSUERS.includes(claims.iss) ||
      claims.aud !== clientId ||
      typeof claims.exp !== 'number' ||
      claims.exp * 1000 <= Date.now() ||
      typeof claims.nonce !== 'string' ||
      !sameSecret(claims.nonce, pending.nonce) ||
      typeof claims.email !== 'string'
    ) {
      return fail('id_token claims')
    }
    const email = claims.email.toLowerCase()
    if (claims.email_verified !== true || !allowed.has(email)) {
      signInFailures.fail(ip)
      res.setHeader('Set-Cookie', clearOauth)
      return sendPage(
        res,
        403,
        'Not allowed',
        `The Google account <strong>${escapeHtml(email)}</strong> is not allowed here.`,
        loginPath(pending.back, { switch: '1' }),
        'Use a different Google account'
      )
    }
    signInFailures.clear(ip)
    // ponytail: one session per sign-in, kept until logout or expiry; expired ones are dropped on boot or use
    const id = b64url(randomBytes(32))
    const session = { email, exp: Date.now() + SESSION_MS }
    await putSession(sidHash(id), JSON.stringify(session))
    sessions.set(sidHash(id), session)
    res
      .writeHead(302, {
        Location: safeReturn(pending.back),
        'Set-Cookie': [clearOauth, setCookie(site, 'sid', id, '/', SESSION_MS / 1000)],
        'Cache-Control': 'no-store'
      })
      .end()
  }

  async function logout(req, res, site) {
    for (const id of cookieValues(req, cookieName(site, 'sid'))) {
      if (!SID_RE.test(id)) continue
      const hash = sidHash(id)
      if (!sessions.delete(hash)) continue
      await putSession(hash, null)
    }
    res.setHeader('Set-Cookie', setCookie(site, 'sid', '', '/', 0))
    return sendJson(res, 204)
  }

  // ---- routes ----
  /** The board needs the latest job per task and the last day of editor labels. */
  function snapshot() {
    const now = Date.now()
    const latest = new Map()
    const jobs = []
    for (const job of state.jobs.values()) {
      if (job.kind === 'raw') {
        if (now - job.requested <= DAY_MS) jobs.push(job)
      } else if (!latest.has(job.taskId) || latest.get(job.taskId).requested <= job.requested) {
        latest.set(job.taskId, job)
      }
    }
    return {
      type: 'snapshot',
      tasks: [...state.tasks.values()],
      jobs: [...latest.values(), ...jobs],
      printer: printerStatus(),
      resources: resources()
    }
  }

  function stream(req, res, email) {
    if (clients.size >= MAX_CLIENTS) throw new HttpError(503, 'Too many open boards')
    const mine = streamsByEmail.get(email) ?? 0
    if (mine >= MAX_STREAMS_PER_EMAIL) throw new HttpError(429, 'Too many open boards for this account')
    streamsByEmail.set(email, mine + 1)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    // A reader that stops reading gets STALL_MS to drain its buffer, then the socket is dropped.
    let stall = null
    const write = (chunk) => {
      if (res.write(chunk) || stall) return
      stall = setTimeout(() => res.destroy(), STALL_MS)
      res.once('drain', () => {
        clearTimeout(stall)
        stall = null
      })
    }
    const send = (message) => write(`data: ${JSON.stringify(message)}\n\n`)
    const offs = [
      broker.subscribe('tasks', ({ type, data }) => {
        if (type === 'task.deleted') return send({ type, id: data.id })
        const task = state.tasks.get(data.id)
        if (task) send({ type, task })
      }),
      broker.subscribe('print', ({ data }) => {
        const job = state.jobs.get(data.jobId)
        if (job) send({ type: 'job', job })
      }),
      broker.subscribe('printer', ({ data }) => send({ type: 'printer', printer: data })),
      broker.subscribe('resources', ({ data }) => send({ type: 'resources', resources: data }))
    ]
    clients.add(res)
    send(snapshot())
    const ping = setInterval(() => write(': ping\n\n'), 20_000)
    res.on('close', () => {
      offs.forEach((off) => off())
      clearInterval(ping)
      clearTimeout(stall)
      clients.delete(res)
      const left = (streamsByEmail.get(email) ?? 1) - 1
      if (left > 0) streamsByEmail.set(email, left)
      else streamsByEmail.delete(email)
    })
  }

  async function editorFile(res, pathname) {
    try {
      if (!(await stat(webDist)).isDirectory()) throw new Error()
    } catch {
      return res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Editor not built: run npm run build:web')
    }
    let path
    try {
      path = decodeURIComponent(pathname)
    } catch {
      throw new HttpError(400, 'Bad path')
    }
    let file = resolve(webDist, `.${path}`)
    if (path.includes('\0') || (file !== webDist && !file.startsWith(webDist + sep))) throw new HttpError(404, 'Not found')
    const isFile = await stat(file).then((s) => s.isFile(), () => false)
    if (!isFile) {
      // A missing hashed asset must not turn into index.html under an immutable cache header.
      if (pathname.startsWith('/assets/')) throw new HttpError(404, 'Not found')
      file = join(webDist, 'index.html')
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
    const body = await readFile(file)
    res
      .writeHead(200, {
        'Content-Type': type,
        'Content-Security-Policy': EDITOR_CSP,
        // private: the editor sits behind sign-in, so shared caches must not keep it.
        'Cache-Control': pathname.startsWith('/assets/') ? 'private, max-age=31536000, immutable' : 'no-cache'
      })
      .end(body)
  }

  const requesting = new Map() // client jobId -> publish in progress

  /** Payload first, then the event; a failed publish takes the payload back out before a retry of
   * the same jobId can start (it waits on `requesting`). */
  async function queueRaw(jobId, input) {
    state.payloads.set(jobId, input.payload)
    try {
      await putPayload(jobId, input.payload)
      await broker.publish('print', 'print.requested', { jobId, kind: 'raw', description: input.description })
    } catch (error) {
      state.payloads.delete(jobId)
      await putPayload(jobId, null).catch(warn(`Deleting payload ${jobId}`))
      throw error
    }
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost')
    const { pathname } = url
    const method = req.method
    const editor = hostname(req.headers.host ?? '').toLowerCase() === editorHost
    const site = editor ? { origin: editorOrigin } : { origin: kanbanOrigin }
    site.secure = site.origin.startsWith('https:')
    if (site.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000')

    if (method === 'GET' && pathname === '/healthz') return sendJson(res, 200, { ok: true })

    if (pathname === '/api/agent/poll' && method === 'POST') {
      if (!agentToken) throw new HttpError(503, 'AGENT_TOKEN is not set on the server')
      const ip = clientIp(req)
      const header = req.headers.authorization ?? ''
      // A page in the user's browser can post here header-less (no preflight) from the agent's own
      // IP; that is not a guess, so it never counts. Pages cannot add Authorization cross-site.
      if (!header.startsWith('Bearer ')) throw new HttpError(401, 'Bad agent token')
      // ponytail: keyed by client IP (own counter, not sign-in's)
      if (agentFailures.limited(ip)) throw new HttpError(429, 'Too many failed attempts; wait 15 minutes')
      if (!sameSecret(header.slice(7), agentToken)) {
        agentFailures.fail(ip)
        throw new HttpError(401, 'Bad agent token')
      }
      return sendJson(res, 200, await agentPoll(await readJson(req)))
    }

    // Lax cookie plus a custom header: a cross-site form or fetch cannot send both.
    const api = pathname.startsWith('/api/')
    if ((api && method !== 'GET') || pathname === '/auth/logout') {
      if (req.headers['x-requested-with'] !== 'kanban') throw new HttpError(403, 'Missing X-Requested-With header')
    }

    if (pathname === '/auth/login' && method === 'GET') return login(req, res, site, url.searchParams)
    if (pathname === '/auth/callback' && method === 'GET') return callback(req, res, site, url.searchParams)
    if (pathname === '/auth/logout' && method === 'POST') return logout(req, res, site)

    if (!api) {
      if (method !== 'GET' || pathname.startsWith('/auth/')) throw new HttpError(404, 'Not found')
      if (editor) {
        if (!signedIn(req, res, site)) {
          return res.writeHead(302, { Location: `/auth/login?return=${encodeURIComponent(pathname + url.search)}`, 'Cache-Control': 'no-store' }).end()
        }
        return editorFile(res, pathname)
      }
      if (pathname === '/' || pathname === '/index.html') {
        const html = await readFile(join(HERE, 'public', 'index.html'), 'utf8')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': pageCsp(html), 'Cache-Control': 'no-cache' })
        return res.end(html)
      }
      throw new HttpError(404, 'Not found')
    }

    const email = signedIn(req, res, site)
    if (!email) throw new HttpError(401, 'Sign in first')

    if (pathname === '/api/me' && method === 'GET') return sendJson(res, 200, { email, kanbanUrl: kanbanOrigin, editorUrl: editorOrigin })
    if (pathname === '/api/stream' && method === 'GET') {
      // Lax cookies reach here from sibling subdomains; only the board itself may hold streams.
      const fetchSite = req.headers['sec-fetch-site']
      if (fetchSite && fetchSite !== 'same-origin') throw new HttpError(403, 'Open the board on its own site')
      return stream(req, res, email)
    }
    if (pathname === '/api/printer' && method === 'GET') return sendJson(res, 200, printerStatus())

    // ---- editor storage ----
    if (pathname === '/api/editor/cache' && method === 'GET') {
      const entries = [...editorValues].filter(([key]) => key !== 'templates')
      return sendJson(res, 200, `{"values":{${entries.map(([key, value]) => `${JSON.stringify(key)}:${value}`).join(',')}}}`)
    }
    const cacheKey = pathname.match(/^\/api\/editor\/cache\/([^/]+)$/)?.[1]
    if (cacheKey !== undefined && method === 'PUT') {
      if (!KEY_RE.test(cacheKey) || cacheKey === 'templates') throw new HttpError(400, 'Bad key')
      const body = await readJson(req, MAX_EDITOR_BODY)
      if (!body || typeof body !== 'object' || !('value' in body)) throw new HttpError(400, 'Expected {"value": ...}')
      const value = body.value === null ? null : JSON.stringify(body.value)
      await putChecked(cacheKey, value)
      return sendJson(res, 204)
    }
    if (pathname === '/api/editor/templates' && method === 'GET') {
      return sendJson(res, 200, `{"templates":${editorValues.get('templates') ?? '[]'}}`)
    }
    if (pathname === '/api/editor/templates' && method === 'PUT') {
      const body = await readJson(req, MAX_EDITOR_BODY)
      if (!Array.isArray(body?.templates)) throw new HttpError(400, 'templates must be an array')
      const value = JSON.stringify(body.templates)
      await putChecked('templates', value)
      return sendJson(res, 204)
    }

    // ---- printing ----
    if (pathname === '/api/editor/print' && method === 'POST') {
      const body = await readJson(req, MAX_EDITOR_BODY)
      const input = validRawPrint(body)
      // An optional client-made jobId makes a retried request idempotent.
      let jobId = randomUUID()
      if (body.jobId !== undefined) {
        if (typeof body.jobId !== 'string' || !UUID4_RE.test(body.jobId)) throw new HttpError(400, 'jobId must be a lowercase UUID v4')
        jobId = body.jobId
        while (requesting.has(jobId)) await requesting.get(jobId).catch(() => {})
        // ponytail: a jobId is remembered only while its job is (about a day after it finishes)
        const existing = state.jobs.get(jobId)
        if (existing) return sendJson(res, 200, { job: existing })
      }
      const printer = printerStatus()
      if (printer.state !== 'ready') return sendJson(res, 409, { error: printer.reason })
      // Caps the payloads held in memory too. No await between this count and `requesting.set`.
      let waiting = 0
      for (const job of state.jobs.values()) if (job.kind === 'raw' && unfinished(job)) waiting += 1
      for (const id of requesting.keys()) if (!state.jobs.has(id)) waiting += 1
      if (waiting >= MAX_RAW_JOBS) throw new HttpError(503, `${MAX_RAW_JOBS} labels are already waiting to print; try again once some have printed`)
      const run = queueRaw(jobId, input)
      requesting.set(jobId, run)
      try {
        await run
      } finally {
        requesting.delete(jobId)
      }
      return sendJson(res, 202, { job: state.jobs.get(jobId) })
    }
    const jobId = pathname.match(/^\/api\/jobs\/([^/]+)$/)?.[1]
    if (jobId !== undefined && method === 'GET') {
      const job = UUID_RE.test(jobId) && state.jobs.get(jobId)
      if (!job) throw new HttpError(404, 'No such job')
      return sendJson(res, 200, { job })
    }

    // ---- kanban ----
    if (pathname === '/api/tasks' && method === 'POST') {
      const input = validTask(await readJson(req))
      const column = input.column ?? 'todo'
      const orders = [...state.tasks.values()].filter((t) => t.column === column).map((t) => t.order)
      const task = { id: randomUUID(), notes: '', color: 'red', ...input, column, order: Math.max(0, ...orders) + 1 }
      await broker.publish('tasks', 'task.created', task)
      return sendJson(res, 201, state.tasks.get(task.id))
    }

    const match = pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})(\/print)?$/)
    if (match) {
      const [, id, print] = match
      if (!state.tasks.has(id)) throw new HttpError(404, 'No such task')
      if (print && method === 'POST') {
        // One waiting label per task: pressing Print again while it waits returns that job.
        const waiting = [...state.jobs.values()].find((j) => j.taskId === id && j.status === 'queued')
        if (waiting) return sendJson(res, 200, waiting)
        const jobId = randomUUID()
        await broker.publish('print', 'print.requested', { jobId, kind: 'task', taskId: id })
        return sendJson(res, 202, state.jobs.get(jobId))
      }
      if (!print && method === 'PATCH') {
        const changes = validTask(await readJson(req), true)
        await broker.publish('tasks', 'task.updated', { id, ...changes })
        return sendJson(res, 200, state.tasks.get(id))
      }
      if (!print && method === 'DELETE') {
        await broker.publish('tasks', 'task.deleted', { id })
        return sendJson(res, 204)
      }
    }
    throw new HttpError(404, 'Not found')
  }

  const server = http.createServer(async (req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value)
    try {
      await route(req, res)
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(error)
      if (res.headersSent) return res.end()
      // An oversized body was not read to the end: close instead of reusing the connection.
      if (error.status === 413) res.setHeader('Connection', 'close')
      sendJson(res, error.status ?? 500, { error: error instanceof HttpError ? error.message : 'Server error' })
    }
  })
  server.on('close', () => {
    clearInterval(ticker)
    clearInterval(upkeepTimer)
  })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 4173
  start()
    .then((server) =>
      server.listen(port, () => console.log(`Kanban on ${process.env.KANBAN_ORIGIN || `http://kanban.localhost:${port}`}, editor on ${process.env.EDITOR_ORIGIN || `http://printer-editor.localhost:${port}`}`))
    )
    .catch((error) => {
      console.error(error.message)
      process.exit(1)
    })
}
