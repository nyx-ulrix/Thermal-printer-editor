// One-way sync of the board's due dates into a Google Calendar of their own.
//
// The board owner connects once (Settings -> Google Calendar). From then on every open task with a due date
// is an event in a calendar called "Kanban" that this app created: all-day, or 30 minutes at the due time.
// It follows the task as it changes and is removed when the task is done, loses its date or is deleted.
// Only events this app made (id "kb" + the task's UUID) are ever changed or removed; anything added to the
// calendar by hand is left alone. Changes made in Google Calendar are not read back.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'
export const GOOGLE_CALENDAR_URL = 'https://www.googleapis.com/calendar/v3'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const DEBOUNCE_MS = 1500
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

export function validZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

const nextDay = (day) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' + 'HH:MM' plus minutes, as a local date-time without offset (the zone travels beside it). */
const plusMinutes = (day, time, minutes) => {
  const [y, m, d] = day.split('-').map(Number), [hh, mm] = time.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, d, hh, mm + minutes)).toISOString().slice(0, 19)
}

/** The event a task becomes, or null when it has none: no due date, or done. */
export function eventFor(task, boardUrl) {
  if (!task || typeof task.due !== 'string' || !DAY_RE.test(task.due) || task.column === 'done') return null
  const urgency = COLOUR[task.urgency] ? task.urgency : 'medium'
  const timed = TIME_RE.test(task.dueTime ?? '') && validZone(task.dueTz)
  return {
    id: eventId(task.id),
    summary: task.title,
    description: [task.notes, `Urgency: ${URGENCY_NAME[urgency]} · ${COLUMN_NAME[task.column] ?? 'To do'}`, boardUrl].filter(Boolean).join('\n\n'),
    start: timed ? { dateTime: plusMinutes(task.due, task.dueTime, 0), timeZone: task.dueTz } : { date: task.due },
    end: timed ? { dateTime: plusMinutes(task.due, task.dueTime, EVENT_MINUTES), timeZone: task.dueTz } : { date: nextDay(task.due) },
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

/**
 * kv: { load(): [[key, value]], put(key, value | null) }. tasks(): the board's tasks.
 * urls: { token, api, revoke } (tests point them at stand-ins).
 */
export function calendarSync({ kv, tasks, clientId, clientSecret, secret, boardUrl, urls = {}, log = console.warn }) {
  const tokenUrl = urls.token, apiUrl = urls.api || GOOGLE_CALENDAR_URL, revokeUrl = urls.revoke || GOOGLE_REVOKE_URL
  const crypt = sealer(secret)
  let record = null // { email, refresh (sealed), calendarId, connectedAt }
  let access = null // { token, exp }
  let status = { lastSync: null, error: null }
  // task id -> change count: a change queued while that task's event is being sent must not be dropped
  // when the send finishes, so an id leaves only if nothing new came in meanwhile.
  const pending = new Map()
  let changes = 0
  const mark = (id) => pending.set(id, ++changes)
  let timer = null, running = null, backoff = 0, reconcileTimer = null, reconcileDue = false
  // A fatal error (refresh token revoked or unreadable) cannot heal by retrying: wait for connect / Sync now.
  let stalled = false

  const save = () => kv.put(KEY, record && JSON.stringify(record))
  const fail = (what, error) => {
    status.error = `${what}: ${error.message}`
    log(`Google Calendar ${status.error}`)
  }

  async function token() {
    if (access && access.exp > Date.now() + 60_000) return access.token
    const refresh = record && crypt.open(record.refresh)
    if (!refresh) throw Object.assign(new Error('not connected; connect Google Calendar again in Settings'), { fatal: true })
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId, client_secret: clientSecret }),
      signal: AbortSignal.timeout(10_000)
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.access_token) {
      // invalid_grant: the access was revoked in the Google account, or the token expired unused
      const revoked = body.error === 'invalid_grant'
      throw Object.assign(new Error(revoked ? 'Google access was removed; connect again in Settings' : `token refresh ${res.status}`), { fatal: revoked })
    }
    access = { token: body.access_token, exp: Date.now() + (Number(body.expires_in) || 3600) * 1000 }
    return access.token
  }

  async function google(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(apiUrl + path, {
        method,
        headers: { Authorization: `Bearer ${await token()}`, ...(body && { 'Content-Type': 'application/json' }) },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(15_000)
      })
      if (res.status === 401 && attempt === 0) { access = null; continue }
      const text = await res.text()
      if (!res.ok) throw Object.assign(new Error(`${method} ${path.split('?')[0]} ${res.status}`), { status: res.status, body: text.slice(0, 200) })
      return text ? JSON.parse(text) : null
    }
  }

  /** The app's own calendar; made again if it was deleted in Google Calendar. */
  async function calendarId() {
    if (record.calendarId) {
      try {
        await google('GET', `/calendars/${encodeURIComponent(record.calendarId)}`)
        return record.calendarId
      } catch (error) {
        if (error.status !== 404 && error.status !== 410) throw error
      }
    }
    const made = await google('POST', '/calendars', { summary: 'Kanban', description: `Due dates from ${boardUrl}` })
    record.calendarId = made.id
    await save()
    return made.id
  }

  async function syncTask(cal, taskId) {
    const base = `/calendars/${encodeURIComponent(cal)}/events`
    const event = eventFor(tasks().get(taskId), boardUrl)
    if (!event) {
      try { await google('DELETE', `${base}/${eventId(taskId)}`) } catch (error) {
        if (error.status !== 404 && error.status !== 410) throw error
      }
      return
    }
    try {
      // PUT also brings back an event deleted earlier (Google keeps it as cancelled under the same id)
      await google('PUT', `${base}/${event.id}`, event)
    } catch (error) {
      if (error.status !== 404) throw error
      await google('POST', base, event)
    }
  }

  /** Removes our events whose task is gone, done or undated, then queues every dated open task. */
  async function reconcile(cal) {
    const base = `/calendars/${encodeURIComponent(cal)}/events`
    const keep = new Set()
    for (const t of tasks().values()) if (eventFor(t, boardUrl)) { keep.add(eventId(t.id)); mark(t.id) }
    let page = ''
    do {
      const list = await google('GET', `${base}?maxResults=2500&showDeleted=false${page && `&pageToken=${encodeURIComponent(page)}`}`)
      for (const ev of list?.items ?? []) {
        if (OURS_RE.test(ev.id ?? '') && !keep.has(ev.id)) await google('DELETE', `${base}/${encodeURIComponent(ev.id)}`).catch((error) => {
          if (error.status !== 404 && error.status !== 410) throw error
        })
      }
      page = list?.nextPageToken ?? ''
    } while (page)
  }

  async function run() {
    clearTimeout(timer) // a run started directly replaces any one still waiting
    timer = null
    if (!record || running) return
    running = (async () => {
      try {
        const cal = await calendarId()
        if (reconcileDue) { reconcileDue = false; await reconcile(cal) }
        for (const [id, seen] of [...pending]) {
          await syncTask(cal, id)
          if (pending.get(id) === seen) pending.delete(id)
        }
        status = { lastSync: Date.now(), error: null }
        backoff = 0
      } catch (error) {
        if (!record) return // disconnected while this run was in flight
        fail('sync failed', error)
        if (error.fatal) { stalled = true; return }
        backoff = Math.min(MAX_BACKOFF_MS, backoff ? backoff * 2 : 5000)
        schedule(backoff)
      } finally {
        running = null
        // Work that arrived during the run (a change, or a reconnect asking for a reconcile) goes next.
        if ((pending.size || reconcileDue) && !timer && !backoff && !stalled) schedule(DEBOUNCE_MS)
      }
    })()
    return running
  }
  function schedule(ms = DEBOUNCE_MS) {
    if (!record) return
    clearTimeout(timer)
    timer = setTimeout(run, ms)
    timer.unref?.()
  }

  return {
    async load() {
      for (const [key, value] of await kv.load()) {
        if (key !== KEY) continue
        try { record = JSON.parse(value) } catch { record = null }
      }
      if (record) { reconcileDue = true; schedule(0) }
      reconcileTimer = setInterval(() => { if (record) { reconcileDue = true; schedule(0) } }, RECONCILE_MS)
      reconcileTimer.unref?.()
    },
    /** A task changed: its event follows shortly (changes in quick succession are sent once). */
    queue(taskId) {
      if (!record) return
      mark(taskId)
      if (!running && !backoff && !stalled) schedule()
    },
    /** Resolves once the account is stored; the first sync runs in the background (the sign-in
     * redirect must not wait on Google Calendar). */
    async connect({ refreshToken, email }) {
      // Another Google account cannot see the old account's calendar: make a new one there.
      const calendarId = record && record.email === email ? record.calendarId : null
      record = { email, refresh: crypt.seal(refreshToken), calendarId, connectedAt: Date.now() }
      access = null
      status = { lastSync: null, error: null }
      backoff = 0
      stalled = false
      await save()
      reconcileDue = true
      clearTimeout(timer)
      if (running) running.then(run)
      else run()
    },
    async disconnect() {
      const refresh = record && crypt.open(record.refresh)
      record = null
      access = null
      pending.clear()
      stalled = false
      backoff = 0
      clearTimeout(timer)
      status = { lastSync: null, error: null }
      await save()
      if (refresh) {
        await fetch(revokeUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refresh }), signal: AbortSignal.timeout(10_000) })
          .catch((error) => log(`Google Calendar revoke: ${error.message}`))
      }
    },
    /** Sync everything now (Settings -> Sync now). */
    syncNow() {
      if (!record) return Promise.resolve()
      reconcileDue = true
      backoff = 0
      stalled = false
      clearTimeout(timer)
      return running ? running.then(run) : run()
    },
    status() {
      return {
        connected: !!record,
        email: record?.email ?? null,
        calendarId: record?.calendarId ?? null,
        lastSync: status.lastSync,
        error: status.error,
        pending: pending.size
      }
    },
    stop() { clearTimeout(timer); clearInterval(reconcileTimer) }
  }
}
