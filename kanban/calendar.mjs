// One-way sync of the board's due dates into a Google Calendar of their own.
//
// The board owner connects once (Settings -> Google Calendar). From then on every open task with a due date
// is an event in a calendar called "Kanban" that this app created: all-day, or 30 minutes at the due time.
// It follows the task as it changes and is removed when the task is done, loses its date or is deleted.
// Only events this app made (id "kb" + the task's UUID) are ever changed or removed; anything added to the
// calendar by hand is left alone. Changes made in Google Calendar are not read back.

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'
export const GOOGLE_CALENDAR_URL = 'https://www.googleapis.com/calendar/v3'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const DEBOUNCE_MS = 1500
const MAX_WAIT_MS = 10_000
const RECONCILE_MS = 6 * 3600_000
const MAX_BACKOFF_MS = 5 * 60_000
const KEY = 'google'
// Google event colours: Tomato, Banana, Peacock
const COLOUR = { high: '11', medium: '5', low: '7' }
const URGENCY_NAME = { high: 'High', medium: 'Medium', low: 'Low' }
const COLUMN_NAME = { todo: 'To do', doing: 'Doing' }
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const EVENT_MINUTES = 30

/** Event ids allow base32hex (a-v, 0-9): a task's UUID without dashes, behind a fixed prefix. */
export const eventId = (taskId) => 'kb' + taskId.replace(/-/g, '')
/** Ours: the prefix and 32 hex digits. Nothing else in the calendar is touched. */
const OURS_RE = /^kb[0-9a-f]{32}$/

/** The zone's canonical IANA name ('Area/City' or 'UTC'), or null: offsets like '+05:00' and abbreviations
 * like 'EST' are refused (Google Calendar takes only IANA names). */
export function canonicalZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return null
  try {
    const name = new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone
    return name === 'UTC' || /^[A-Za-z]+(\/[A-Za-z0-9_+-]+)+$/.test(name) ? name : null
  } catch {
    return null
  }
}
export const validZone = (zone) => canonicalZone(zone) !== null

const nextDay = (day) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

const formats = new Map()
/** The zone's offset from UTC (ms) at instant `ms`: its wall clock minus UTC. */
function offsetAt(zone, ms) {
  let format = formats.get(zone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    formats.set(zone, format)
  }
  const p = Object.fromEntries(format.formatToParts(ms).map(({ type, value }) => [type, Number(value)]))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

const DAY_MS = 86_400_000
/** The instant a wall-clock time in `zone` names. A repeated hour (clocks back) takes its first occurrence;
 * a skipped hour (clocks forward) moves on to the first instant that exists, the moment of the change. */
export function wallToInstant(day, time, zone) {
  const [y, m, d] = day.split('-').map(Number), [hh, mm] = time.split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, hh, mm)
  const tries = [wall - offsetAt(zone, wall - DAY_MS), wall - offsetAt(zone, wall + DAY_MS)].sort((a, b) => a - b)
  const hit = tries.find((t) => t + offsetAt(zone, t) === wall)
  if (hit !== undefined) return hit
  let [lo, hi] = tries
  const before = offsetAt(zone, lo)
  while (hi - lo > 1000) {
    const mid = lo + Math.floor((hi - lo) / 2000) * 1000
    if (offsetAt(zone, mid) === before) lo = mid
    else hi = mid
  }
  return hi
}
const utc = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z'

/** The event a task becomes, or null when it has none: no due date, or done. */
export function eventFor(task, boardUrl) {
  if (!task || typeof task.due !== 'string' || !DAY_RE.test(task.due) || task.column === 'done') return null
  const urgency = COLOUR[task.urgency] ? task.urgency : 'medium'
  const zone = TIME_RE.test(task.dueTime ?? '') && canonicalZone(task.dueTz)
  // Timed: real instants, so the event lasts 30 minutes even on a night the clocks change; the zone says
  // how Google shows it.
  const start = zone && wallToInstant(task.due, task.dueTime, zone)
  return {
    id: eventId(task.id),
    summary: task.title,
    description: [task.notes, `Urgency: ${URGENCY_NAME[urgency]} · ${COLUMN_NAME[task.column] ?? 'To do'}`, boardUrl].filter(Boolean).join('\n\n'),
    start: zone ? { dateTime: utc(start), timeZone: zone } : { date: task.due },
    end: zone ? { dateTime: utc(start + EVENT_MINUTES * 60_000), timeZone: zone } : { date: nextDay(task.due) },
    colorId: COLOUR[urgency],
    transparency: 'transparent', // a due date is not a meeting: it never shows the day as busy
    status: 'confirmed',
    source: { title: 'Kanban', url: boardUrl }
  }
}

/** AES-256-GCM under a key derived from SESSION_SECRET: the refresh token is never stored in the clear. */
function sealer(secret) {
  const key = Buffer.from(hkdfSync('sha256', secret || randomBytes(32), 'kanban-calendar', 'google refresh token', 32))
  return {
    seal(text) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
      return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.')
    },
    open(sealed) {
      try {
        const [iv, tag, body] = String(sealed).split('.').map((p) => Buffer.from(p, 'base64url'))
        const decipher = createDecipheriv('aes-256-gcm', key, iv)
        decipher.setAuthTag(tag)
        return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
      } catch {
        return null // another SESSION_SECRET sealed it: connect again
      }
    }
  }
}

/** Errors Google will give again for the same event (a bad request, a conflict): retrying cannot help. */
const RATE_RE = /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/
const refused = (error) => [400, 404, 409, 410].includes(error.status) || (error.status === 403 && !error.rate)
// Thrown when the connection changed under a run: it stops without reporting an error.
const STOPPED = new Error('connection changed')

/**
 * kv: { load(): [[key, value]], put(key, value | null) }. tasks(): the board's tasks.
 * urls: { token, api, revoke } (tests point them at stand-ins). timing: { debounce, maxWait } (tests shorten them).
 */
export function calendarSync({ kv, tasks, clientId, clientSecret, secret, boardUrl, urls = {}, log = console.warn, timing = {} }) {
  const tokenUrl = urls.token, apiUrl = urls.api || GOOGLE_CALENDAR_URL, revokeUrl = urls.revoke || GOOGLE_REVOKE_URL
  const debounce = timing.debounce ?? DEBOUNCE_MS, maxWait = timing.maxWait ?? MAX_WAIT_MS
  const crypt = sealer(secret)
  // { email, refresh (sealed), calendarId, connectedAt }. After a disconnect only { email, calendarId } stays,
  // so connecting the same account again reuses its calendar.
  let record = null
  const connected = () => !!record?.refresh
  let access = null // { token, exp }
  let status = { lastSync: null, error: null }
  // task id -> change count: a change queued while that task's event is being sent must not be dropped
  // when the send finishes, so an id leaves only if nothing new came in meanwhile.
  const pending = new Map()
  let changes = 0
  const mark = (id) => pending.set(id, ++changes)
  // Tasks Google refused (task id -> short reason): parked until the task changes, so they block nothing.
  const failed = new Map()
  // What Google holds, as far as this process knows: task id -> hash of the event last sent, null for
  // "no event", '?' for "may have one". After a reconcile, an id missing here has no event either.
  const sent = new Map()
  let reconciled = false
  let calendarOk = false // the calendar was seen or made in this connection: no GET before every run
  let timer = null, running = null, backoff = 0, rateLimited = false, burstStart = 0, reconcileTimer = null, reconcileDue = false
  // A fatal error (refresh token revoked or unreadable) cannot heal by retrying: wait for connect / Sync now.
  let stalled = false
  // Bumped on connect and disconnect: a run started under an older connection stops at its next step.
  let generation = 0, runGeneration = 0
  const alive = () => { if (runGeneration !== generation) throw STOPPED }

  const save = () => kv.put(KEY, record && JSON.stringify(record))
  const fail = (what, error) => {
    status.error = `${what}: ${error.message}`
    log(`Google Calendar ${status.error}`)
  }
  const forget = () => { sent.clear(); reconciled = false }

  async function revoke(refresh) {
    try {
      const res = await fetch(revokeUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refresh }), signal: AbortSignal.timeout(10_000) })
      if (!res.ok) log(`Google Calendar revoke: ${res.status}`)
    } catch (error) {
      log(`Google Calendar revoke: ${error.message}`)
    }
  }

  async function token() {
    if (access && access.exp > Date.now() + 60_000) return access.token
    const refresh = connected() && crypt.open(record.refresh)
    if (!refresh) throw Object.assign(new Error('not connected; connect Google Calendar again in Settings'), { fatal: true })
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId, client_secret: clientSecret }),
      signal: AbortSignal.timeout(10_000)
    })
    const body = await res.json().catch(() => ({}))
    alive() // an old account's access token must never serve a newer connection
    if (!res.ok || !body.access_token) {
      // invalid_grant: the access was revoked in the Google account, or the token expired unused
      const revoked = body.error === 'invalid_grant'
      // (an app in Google's Testing mode also gets refresh tokens that lapse after 7 days)
      throw Object.assign(new Error(revoked ? 'Google access expired or was removed; reconnect to keep syncing' : `token refresh ${res.status}`), { fatal: revoked })
    }
    access = { token: body.access_token, exp: Date.now() + (Number(body.expires_in) || 3600) * 1000 }
    return access.token
  }

  async function google(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const auth = await token()
      const res = await fetch(apiUrl + path, {
        method,
        headers: { Authorization: `Bearer ${auth}`, ...(body && { 'Content-Type': 'application/json' }) },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(15_000)
      })
      const text = await res.text()
      alive()
      if (res.status === 401 && attempt === 0) { access = null; continue }
      if (!res.ok) {
        const rate = res.status === 429 || (res.status === 403 && RATE_RE.test(text))
        // Google's reason code (e.g. accessNotConfigured, insufficientPermissions) says what to fix; never the body itself
        let why = ''
        try { const e = JSON.parse(text).error; why = e.errors?.[0]?.reason || e.status || '' } catch {}
        why = /^[A-Za-z_]{1,48}$/.test(why) ? ` ${why}` : ''
        throw Object.assign(new Error(`${method} ${path.split('?')[0]} ${res.status}${why}`), { status: res.status, rate })
      }
      try {
        return text ? JSON.parse(text) : null
      } catch {
        throw new Error(`${method} ${path.split('?')[0]}: Google sent an unreadable reply`) // never the body itself
      }
    }
  }
  const gone = () => Object.assign(new Error('the Kanban calendar is gone'), { gone: true })

  /** The app's own calendar; made again if it was deleted in Google Calendar. */
  async function calendarId() {
    const previous = record.calendarId
    if (previous && calendarOk) return previous
    if (previous) {
      try {
        await google('GET', `/calendars/${encodeURIComponent(previous)}`)
        calendarOk = true
        return previous
      } catch (error) {
        if (error.status !== 404 && error.status !== 410) throw error
      }
    }
    const made = await google('POST', '/calendars', { summary: 'Kanban', description: `Due dates from ${boardUrl}` })
    if (typeof made?.id !== 'string') throw new Error('Google made no calendar')
    record.calendarId = made.id
    calendarOk = true
    // A new, empty calendar: every dated open task goes into it, not only the ones changed since.
    if (previous) { reconcileDue = true; forget() }
    await save()
    alive()
    return made.id
  }

  async function syncTask(cal, taskId) {
    const base = `/calendars/${encodeURIComponent(cal)}/events`
    const event = eventFor(tasks().get(taskId), boardUrl)
    if (!event) {
      // Never made, or already deleted: nothing to ask Google.
      if (sent.get(taskId) === null || (reconciled && !sent.has(taskId))) return
      try { await google('DELETE', `${base}/${eventId(taskId)}`) } catch (error) {
        if (error.status !== 404 && error.status !== 410) throw error
      }
      sent.set(taskId, null)
      return
    }
    const hash = createHash('sha256').update(JSON.stringify(event)).digest('base64url')
    if (sent.get(taskId) === hash) return
    try {
      // PUT also brings back an event deleted earlier (Google keeps it as cancelled under the same id)
      await google('PUT', `${base}/${event.id}`, event)
    } catch (error) {
      if (error.status !== 404) throw error
      try {
        await google('POST', base, event)
      } catch (again) {
        // Inserting into a calendar that is not there: the calendar itself was deleted.
        throw again.status === 404 || again.status === 410 ? gone() : again
      }
    }
    sent.set(taskId, hash)
  }

  /** Removes our events whose task is gone, done or undated, then queues every dated open task. */
  async function reconcile(cal) {
    forget()
    const base = `/calendars/${encodeURIComponent(cal)}/events`
    const keep = new Set()
    for (const t of tasks().values()) {
      if (!eventFor(t, boardUrl)) continue
      keep.add(eventId(t.id))
      mark(t.id)
      sent.set(t.id, '?')
    }
    for (const id of failed.keys()) if (!keep.has(eventId(id))) failed.delete(id) // gone or undated since
    let page = ''
    do {
      let list
      try {
        list = await google('GET', `${base}?maxResults=2500&showDeleted=false${page && `&pageToken=${encodeURIComponent(page)}`}`)
      } catch (error) {
        throw error.status === 404 || error.status === 410 ? gone() : error
      }
      for (const ev of list?.items ?? []) {
        if (OURS_RE.test(ev.id ?? '') && !keep.has(ev.id)) await google('DELETE', `${base}/${encodeURIComponent(ev.id)}`).catch((error) => {
          if (error.status !== 404 && error.status !== 410) throw error
        })
      }
      page = list?.nextPageToken ?? ''
    } while (page)
    reconciled = true // every event of ours left belongs to a task marked '?' above
  }

  async function pass() {
    // At most twice: a calendar found deleted mid-run is made again and filled in the same run.
    for (let attempt = 0; ; attempt++) {
      try {
        const cal = await calendarId()
        if (reconcileDue) { reconcileDue = false; await reconcile(cal) }
        for (const [id, seen] of [...pending]) {
          try {
            await syncTask(cal, id)
            failed.delete(id)
          } catch (error) {
            if (error === STOPPED || error.gone) throw error
            // Unknown outcome (timeout, 5xx, rate limit): the event may or may not be there now. Stop the run.
            if (!refused(error)) { sent.set(id, '?'); throw error }
            // Google refuses this one task: park it and carry on with the rest.
            failed.set(id, error.message)
            sent.set(id, '?')
            log(`Google Calendar refused task ${id}: ${error.message}`)
          }
          if (pending.get(id) === seen) pending.delete(id)
        }
        return
      } catch (error) {
        if (!error.gone || attempt) throw error
        calendarOk = false
        reconcileDue = true
      }
    }
  }

  async function run() {
    clearTimeout(timer) // a run started directly replaces any one still waiting
    timer = null
    burstStart = 0
    if (!connected() || running) return
    runGeneration = generation
    running = (async () => {
      try {
        await pass()
        const n = failed.size
        status = { lastSync: Date.now(), error: n ? `Google Calendar refused ${n} task${n === 1 ? '' : 's'}; edit ${n === 1 ? 'it' : 'them'} to try again` : null }
        backoff = 0
        rateLimited = false
      } catch (error) {
        if (error === STOPPED) return // disconnected or reconnected while this run was in flight
        fail('sync failed', error)
        if (error.fatal) { stalled = true; return }
        rateLimited = !!error.rate
        backoff = Math.min(MAX_BACKOFF_MS, backoff ? backoff * 2 : 5000)
        schedule(backoff)
      } finally {
        running = null
        // Work that arrived during the run (a change, or a reconnect asking for a reconcile) goes next.
        if ((pending.size || reconcileDue) && !timer && !backoff && !stalled) schedule(debounce)
      }
    })()
    return running
  }
  function schedule(ms = debounce) {
    if (!connected()) return
    clearTimeout(timer)
    timer = setTimeout(run, ms)
    timer.unref?.()
  }
  function reset() {
    generation++
    access = null
    pending.clear()
    failed.clear()
    forget()
    calendarOk = false
    stalled = false
    backoff = 0
    rateLimited = false
    burstStart = 0
    clearTimeout(timer)
    timer = null
    status = { lastSync: null, error: null }
  }

  return {
    async load() {
      for (const [key, value] of await kv.load()) {
        if (key !== KEY) continue
        try { record = JSON.parse(value) } catch { record = null }
      }
      if (connected()) { reconcileDue = true; schedule(0) }
      reconcileTimer = setInterval(() => { if (connected()) { reconcileDue = true; schedule(0) } }, RECONCILE_MS)
      reconcileTimer.unref?.()
    },
    /** A task changed: its event follows shortly. Changes in quick succession are sent once, but a steady
     * stream of them waits at most `maxWait` after the first. */
    queue(taskId) {
      if (!connected()) return
      failed.delete(taskId) // changed: worth offering to Google again
      mark(taskId)
      if (running || backoff || stalled) return
      const now = Date.now()
      burstStart ||= now
      schedule(Math.max(0, Math.min(debounce, burstStart + maxWait - now)))
    },
    /** Resolves once the account is stored; the first sync runs in the background (the sign-in
     * redirect must not wait on Google Calendar). */
    async connect({ refreshToken, email }) {
      // Another Google account cannot see the old account's calendar: make a new one there.
      const same = record?.email === email
      const old = connected() && crypt.open(record.refresh)
      reset()
      record = { email, refresh: crypt.seal(refreshToken), calendarId: same ? record.calendarId ?? null : null, connectedAt: Date.now() }
      await save()
      // The replaced account's grant would otherwise stay live at Google. Not for the same account: revoking
      // there would also end the grant just made.
      if (old && !same) await revoke(old)
      reconcileDue = true
      if (running) running.then(run)
      else run()
    },
    async disconnect() {
      const refresh = connected() && crypt.open(record.refresh)
      reset()
      record = record?.email ? { email: record.email, calendarId: record.calendarId ?? null } : null
      await save()
      if (refresh) await revoke(refresh)
    },
    /** Sync everything now (Settings -> Sync now). Google's own request to slow down is kept. */
    syncNow() {
      if (!connected()) return Promise.resolve()
      reconcileDue = true
      if (rateLimited && backoff) return running ?? Promise.resolve()
      backoff = 0
      stalled = false
      clearTimeout(timer)
      return running ? running.then(run) : run()
    },
    status() {
      const on = connected()
      return {
        connected: on,
        email: on ? record.email : null,
        calendarId: on ? record.calendarId ?? null : null,
        lastSync: status.lastSync,
        error: status.error,
        pending: pending.size,
        failed: failed.size,
        reconnect: on && stalled // the stored access no longer works: only connecting again heals it
      }
    },
    stop() { clearTimeout(timer); clearInterval(reconcileTimer) }
  }
}
