/**
 * Web build only: stands in for electron/preload.ts. Installs window.printer and
 * window.appCache with the same interfaces, backed by the server's HTTP API
 * (see docs/WEB.md, "Web bridge in the editor").
 */

import type { AppCacheBridge, LabelTemplate, PrinterBridge, PrinterInfo, PrintResult } from '../lib/types'

const AGENT_PRINTER = 'agent'
const POLL_INTERVAL_MS = 1000
const POLL_TIMEOUT_MS = 60_000
/** Delays before re-sending the same print POST after a network error or 5xx. */
const SUBMIT_RETRY_DELAYS_MS = [500, 1500, 3000]
const TIMEOUT_MESSAGE =
  'Queued, but the print agent has not confirmed it yet. It will print when the printer is ready.'

export class SignInRequired extends Error {
  constructor() {
    super('Sign-in required')
    this.name = 'SignInRequired'
  }
}

function redirectToLogin(): never {
  const here = window.location.pathname + window.location.search
  window.location.href = '/auth/login?return=' + encodeURIComponent(here)
  throw new SignInRequired()
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('X-Requested-With', 'kanban')
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(path, { ...init, method, headers, credentials: 'same-origin' })
  if (response.status === 401) redirectToLogin()
  return response
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (body && typeof body.error === 'string' && body.error) return body.error
  } catch {
    // Not JSON; fall back to the status line.
  }
  return `Server answered ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
}

async function expectOk(response: Response): Promise<Response> {
  if (!response.ok) throw new Error(await errorText(response))
  return response
}

/** Base64 without spreading megabytes onto the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK))))
  }
  return btoa(parts.join(''))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

// --- appCache ---------------------------------------------------------------

const values = new Map<string, unknown>()
/** Writes to one key go out in order, so a slow early PUT can't overwrite a later one. */
const writeChains = new Map<string, Promise<void>>()
/** Bumped on every local write, so a failed PUT only rolls back if nothing newer was written. */
const writeVersions = new Map<string, number>()
/** What the server last confirmed per key, so a failed write never rolls back to another unsaved value. */
const confirmed = new Map<string, unknown>()
let templatesChain: Promise<void> = Promise.resolve()

function chain(previous: Promise<void>, next: () => Promise<void>): Promise<void> {
  return previous.catch(() => undefined).then(next)
}

const appCache: AppCacheBridge = {
  read(key: string): unknown | null {
    return values.has(key) ? (values.get(key) as unknown) : null
  },

  write(key: string, value: unknown): Promise<void> {
    const stored = value === undefined ? null : value
    const version = (writeVersions.get(key) ?? 0) + 1
    writeVersions.set(key, version)
    if (stored === null) values.delete(key)
    else values.set(key, stored)
    const body = JSON.stringify({ value: stored })
    const run = chain(writeChains.get(key) ?? Promise.resolve(), async () => {
      try {
        await expectOk(await api(`/api/editor/cache/${encodeURIComponent(key)}`, { method: 'PUT', body }))
        if (stored === null) confirmed.delete(key)
        else confirmed.set(key, stored)
      } catch (error) {
        if (error instanceof SignInRequired) throw error
        // Undo the optimistic update unless a newer write to this key superseded it.
        if (writeVersions.get(key) === version) {
          if (confirmed.has(key)) values.set(key, confirmed.get(key))
          else values.delete(key)
        }
        console.warn(`appCache: saving "${key}" failed; local value restored.`, error)
        throw error
      }
    })
    writeChains.set(key, run)
    return run
  },

  async readTemplates(): Promise<LabelTemplate[]> {
    await templatesChain.catch(() => undefined)
    const response = await expectOk(await api('/api/editor/templates'))
    const body = (await response.json()) as { templates?: unknown }
    return Array.isArray(body.templates) ? (body.templates as LabelTemplate[]) : []
  },

  writeTemplates(templates: LabelTemplate[]): Promise<void> {
    const body = JSON.stringify({ templates: Array.isArray(templates) ? templates : [] })
    templatesChain = chain(templatesChain, async () => {
      await expectOk(await api('/api/editor/templates', { method: 'PUT', body }))
    })
    return templatesChain
  }
}

// --- printer ----------------------------------------------------------------

interface JobReply {
  job?: { id?: string; status?: string; error?: string | null }
}

async function pollJob(jobId: string): Promise<PrintResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    let response: Response
    try {
      response = await api(`/api/jobs/${encodeURIComponent(jobId)}`)
    } catch (error) {
      if (error instanceof SignInRequired) throw error
      continue // A dropped request mid-poll is not a failed print.
    }
    if (!response.ok) continue
    const { job } = (await response.json().catch(() => ({}))) as JobReply
    if (job?.status === 'printed') return { ok: true }
    if (job?.status === 'failed') return { ok: false, error: job.error || 'The print agent reported a failure.' }
  }
  return { ok: false, queued: true, error: TIMEOUT_MESSAGE }
}

/** POSTs the print job, re-sending the same body (same jobId) on network errors and 5xx. */
async function submitPrint(body: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response | null = null
    let failure: unknown = null
    try {
      response = await api('/api/editor/print', { method: 'POST', body })
    } catch (error) {
      if (error instanceof SignInRequired) throw error
      failure = error
    }
    const retryable = response === null || response.status >= 500
    if (!retryable || attempt >= SUBMIT_RETRY_DELAYS_MS.length) {
      if (response) return response
      throw failure
    }
    await sleep(SUBMIT_RETRY_DELAYS_MS[attempt])
  }
}

const printer: PrinterBridge = {
  async listPrinters(): Promise<PrinterInfo[]> {
    let ready = false
    try {
      const response = await api('/api/printer')
      if (response.ok) {
        const status = (await response.json()) as { state?: string }
        ready = status?.state === 'ready'
      }
    } catch (error) {
      if (error instanceof SignInRequired) throw error
    }
    return [
      { name: AGENT_PRINTER, displayName: 'GP-3120TL via print agent', isDefault: true, status: ready ? 0 : 1 }
    ]
  },

  async printRaw(_printerName: string, payload: Uint8Array): Promise<PrintResult> {
    try {
      // A client-chosen id makes the POST idempotent: if the reply is lost after the
      // server queued the job, re-sending the same id returns that job instead of a copy.
      const jobId = crypto.randomUUID()
      const body = JSON.stringify({
        jobId,
        payload: bytesToBase64(payload),
        description: 'Label from the web editor'
      })
      const response = await submitPrint(body)
      // 202 = newly queued, 200 = already queued under this jobId.
      if (!response.ok) return { ok: false, error: await errorText(response) }
      const { job } = (await response.json()) as JobReply
      if (!job?.id) return { ok: false, error: 'The server did not return a print job.' }
      if (job.status === 'printed') return { ok: true }
      if (job.status === 'failed') return { ok: false, error: job.error || 'The print agent reported a failure.' }
      return await pollJob(job.id)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

/**
 * Preloads the cache and installs both bridges. Resolves only when the editor may
 * render; on 401 it navigates to sign-in and never resolves.
 */
export async function installWebBridge(): Promise<void> {
  let response: Response
  try {
    response = await api('/api/editor/cache')
  } catch (error) {
    if (error instanceof SignInRequired) return new Promise<void>(() => undefined)
    throw error
  }
  await expectOk(response)
  const body = (await response.json()) as { values?: Record<string, unknown> }
  values.clear()
  for (const [key, value] of Object.entries(body.values ?? {})) {
    if (value !== null && value !== undefined) {
      values.set(key, value)
      confirmed.set(key, value)
    }
  }
  window.appCache = appCache
  window.printer = printer
}
