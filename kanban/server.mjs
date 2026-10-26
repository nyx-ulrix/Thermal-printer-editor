// Kanban board + resource monitor for the thermal printer.
// Tasks live in an append-only event log published on pub/sub topics; the board is the fold
// of that log. Node 20+ standard library only.
import http from 'node:http'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const COLUMNS = ['todo', 'doing', 'done']
export const COLORS = ['red', 'blue', 'yellow', 'pink']
const AGENT_STALE_MS = 15_000
const RESEND_AFTER_MS = 60_000
const HISTORY = 60
const MAX_BODY = 64 * 1024
const MAX_CLIENTS = 50

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// ---------- state: the fold of the event log ----------

export function emptyState() {
  return { tasks: new Map(), jobs: new Map(), events: 0 }
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
      state.jobs.set(data.jobId, { id: data.jobId, taskId: data.taskId, status: 'queued', error: null, ts })
      break
    case 'print.sent': {
      const job = state.jobs.get(data.jobId)
      if (job) Object.assign(job, { status: 'sent', ts })
      break
    }
    case 'print.finished': {
      const job = state.jobs.get(data.jobId)
      if (job) Object.assign(job, { status: data.ok ? 'printed' : 'failed', error: data.ok ? null : data.error, ts })
      break
    }
  }
  return state
}

/** Persisted events are written before fan-out, one at a time, so log order is apply order. */
export function createBroker(state, store) {
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
      const event = { topic, type, data, ts: Date.now() }
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

function fileStore(path) {
  return {
    async load() {
      try {
        return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line))
      } catch (error) {
        if (error.code === 'ENOENT') return []
        throw error
      }
    },
    async append(event) {
      await mkdir(dirname(path), { recursive: true })
      await appendFile(path, JSON.stringify(event) + '\n')
    }
  }
}

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS kanban_events (
  seq BIGINT AUTO_INCREMENT PRIMARY KEY,
  topic VARCHAR(32) NOT NULL,
  type VARCHAR(32) NOT NULL,
  data MEDIUMTEXT NOT NULL,
  ts BIGINT NOT NULL
)`

/** Writes the log to the Deployer project's MariaDB through its data API. */
function deployerStore({ url, key, projectId, sourceId }) {
  const base = `${url.replace(/\/$/, '')}/projects/${projectId}/data-sources`
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  let rowsUrl

  async function call(target, init = {}) {
    const res = await fetch(target, { ...init, headers, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`Deployer ${init.method ?? 'GET'} ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return res.json()
  }

  return {
    async load() {
      const sid = sourceId || (await call(base)).find((s) => s.kind === 'sql')?.id
      if (!sid) throw new Error('No SQL data source in this Deployer project')
      const created = await call(`${base}/${sid}/query`, { method: 'POST', body: JSON.stringify({ query: CREATE_TABLE }) })
      const failed = created.results?.find((r) => r.type === 'error')
      if (failed) throw new Error(`Creating kanban_events failed: ${JSON.stringify(failed).slice(0, 200)}`)

      rowsUrl = `${base}/${sid}/tables/kanban_events/rows`
      const events = []
      // ponytail: full replay on boot, add a snapshot row when the log reaches ~100k events
      for (let offset = 0; ; offset += 500) {
        const page = await call(`${rowsUrl}?limit=500&offset=${offset}&order_by=seq&order=asc`)
        for (const row of page.rows) events.push({ topic: row.topic, type: row.type, data: JSON.parse(row.data), ts: Number(row.ts) })
        if (page.rows.length < 500) return events
      }
    },
    async append(event) {
      const values = { topic: event.topic, type: event.type, data: JSON.stringify(event.data), ts: event.ts }
      await call(rowsUrl, { method: 'POST', body: JSON.stringify({ values }) })
    }
  }
}

// ---------- http helpers ----------

function sendJson(res, status, body) {
  if (body === undefined) {
    res.writeHead(status).end()
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body))
}

async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new HttpError(413, 'Request body too large')
    chunks.push(chunk)
  }
  if (!size) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'Body is not valid JSON')
  }
}

function cookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return ''
}

const digest = (value) => createHmac('sha256', 'kanban-compare').update(value).digest()
const sameSecret = (a, b) => timingSafeEqual(digest(a), digest(b))

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

// ---------- the app ----------

export async function start(env = process.env) {
  const boardKey = env.BOARD_KEY ?? ''
  const agentToken = env.AGENT_TOKEN ?? ''
  const open = !boardKey && env.ALLOW_OPEN_BOARD === '1'
  if (!boardKey && !open) throw new Error('Set BOARD_KEY (the board passcode), or ALLOW_OPEN_BOARD=1 for local development')
  const session = boardKey && createHmac('sha256', boardKey).update('kanban-session-v1').digest('base64url')

  const store =
    env.DEPLOYER_URL && env.DEPLOYER_API_KEY
      ? deployerStore({ url: env.DEPLOYER_URL, key: env.DEPLOYER_API_KEY, projectId: env.DEPLOYER_PROJECT_ID, sourceId: env.DEPLOYER_SOURCE_ID })
      : fileStore(env.EVENTS_FILE || join(HERE, 'data', 'events.jsonl'))

  const state = emptyState()
  for (const event of await store.load()) {
    apply(state, event)
    state.events += 1
  }
  const broker = createBroker(state, store)

  // ---- printer + resources (ephemeral topics) ----
  let agent = null // { lastSeen, stats, printer }
  const history = { cpu: [], mem: [] }
  const clients = new Set()
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

  // ---- the agent's pull subscription to the print topic ----
  async function agentPoll(body) {
    const report = cleanAgentReport(body)
    const now = Date.now()
    agent = { lastSeen: now, ...report }
    history.cpu = [...history.cpu, report.stats.cpu].slice(-HISTORY)
    history.mem = [...history.mem, report.stats.mem.pct].slice(-HISTORY)

    for (const result of report.results) {
      const job = state.jobs.get(result.jobId)
      if (job && (job.status === 'queued' || job.status === 'sent')) {
        await broker.publish('print', 'print.finished', result)
      }
    }

    const jobs = []
    if (report.printer.ready) {
      // ponytail: linear scan of every job, prune finished jobs when the log grows large
      for (const job of state.jobs.values()) {
        const due = job.status === 'queued' || (job.status === 'sent' && now - job.ts > RESEND_AFTER_MS)
        const task = state.tasks.get(job.taskId)
        if (!due || !task) continue
        jobs.push({ jobId: job.id, task: { id: task.id, title: task.title, notes: task.notes, column: task.column, color: task.color, created: task.created } })
        await broker.publish('print', 'print.sent', { jobId: job.id }, false)
        if (jobs.length === 10) break
      }
    }
    publishStatus()
    return { jobs }
  }

  // ---- auth ----
  const failures = new Map() // ip -> { count, since }
  function clientIp(req) {
    return req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown'
  }
  function checkRateLimit(ip) {
    const entry = failures.get(ip)
    if (entry && Date.now() - entry.since > 15 * 60_000) failures.delete(ip)
    if ((failures.get(ip)?.count ?? 0) >= 8) throw new HttpError(429, 'Too many wrong passcodes. Try again in 15 minutes.')
  }
  function recordFailure(ip) {
    if (failures.size > 10_000) failures.clear()
    const entry = failures.get(ip) ?? { count: 0, since: Date.now() }
    entry.count += 1
    failures.set(ip, entry)
  }
  const authed = (req) => open || (cookie(req, 'kb') !== '' && sameSecret(cookie(req, 'kb'), session))

  // ---- routes ----
  function snapshot() {
    return {
      type: 'snapshot',
      tasks: [...state.tasks.values()],
      jobs: [...state.jobs.values()],
      printer: printerStatus(),
      resources: resources()
    }
  }

  function stream(req, res) {
    if (clients.size >= MAX_CLIENTS) throw new HttpError(503, 'Too many open boards')
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    const send = (message) => res.write(`data: ${JSON.stringify(message)}\n\n`)
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
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000)
    req.on('close', () => {
      offs.forEach((off) => off())
      clearInterval(ping)
      clients.delete(res)
    })
  }

  async function route(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost')
    const method = req.method

    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const html = await readFile(join(HERE, 'public', 'index.html'), 'utf8')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': pageCsp(html), 'Cache-Control': 'no-cache' })
      return res.end(html)
    }
    if (method === 'GET' && pathname === '/healthz') return sendJson(res, 200, { ok: true })

    if (pathname === '/api/agent/poll' && method === 'POST') {
      if (!agentToken) throw new HttpError(503, 'AGENT_TOKEN is not set on the server')
      const header = req.headers.authorization ?? ''
      if (!header.startsWith('Bearer ') || !sameSecret(header.slice(7), agentToken)) throw new HttpError(401, 'Bad agent token')
      return sendJson(res, 200, await agentPoll(await readJson(req)))
    }

    if (!pathname.startsWith('/api/')) throw new HttpError(404, 'Not found')

    // Same-site cookie plus a custom header: a cross-site form or fetch cannot send both.
    if (method !== 'GET' && req.headers['x-requested-with'] !== 'kanban') throw new HttpError(403, 'Missing X-Requested-With header')

    if (pathname === '/api/login' && method === 'POST') {
      if (open) return sendJson(res, 204)
      const ip = clientIp(req)
      checkRateLimit(ip)
      const { key } = await readJson(req)
      if (typeof key !== 'string' || !sameSecret(key, boardKey)) {
        recordFailure(ip)
        throw new HttpError(401, 'Wrong passcode')
      }
      failures.delete(ip)
      res.setHeader('Set-Cookie', `kb=${session}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`)
      return sendJson(res, 204)
    }
    if (pathname === '/api/logout' && method === 'POST') {
      res.setHeader('Set-Cookie', 'kb=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0')
      return sendJson(res, 204)
    }

    if (!authed(req)) throw new HttpError(401, 'Sign in first')

    if (pathname === '/api/me' && method === 'GET') return sendJson(res, 204)
    if (pathname === '/api/stream' && method === 'GET') return stream(req, res)

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
        const jobId = randomUUID()
        await broker.publish('print', 'print.requested', { jobId, taskId: id })
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
      sendJson(res, error.status ?? 500, { error: error instanceof HttpError ? error.message : 'Server error' })
    }
  })
  server.on('close', () => clearInterval(ticker))
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3000
  start()
    .then((server) => server.listen(port, () => console.log(`Kanban board on http://localhost:${port}`)))
    .catch((error) => {
      console.error(error.message)
      process.exit(1)
    })
}
