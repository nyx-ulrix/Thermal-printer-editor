/**
 * Renderer-side persistence. In Electron, values live in the application cache
 * under userData/app-cache so packaged builds keep templates (including images)
 * without hitting localStorage's quota. Browser-only previews still use localStorage.
 */

import type { LabelTemplate } from './types'

const MIGRATED_KEY = 'gp3120tl.migrated.v1'
const TEMPLATES_KEY = 'gp3120tl.templates.v1'

const LEGACY_KEYS = [
  'gp3120tl.session.v1',
  TEMPLATES_KEY,
  'gp3120tl.fieldvalues.v1',
  'gp3120tl.printfills.v1',
  'gp3120tl.panels.v1',
  'gp3120tl.fonts.v1',
  'gp3120tl.settings.v1',
  'gp3120tl.theme.v1'
]

function cache(): Window['appCache'] | undefined {
  return window.appCache
}

function readLocal(key: string): unknown | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw == null) return null
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return raw
    }
  } catch {
    return null
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    if (typeof value === 'string') {
      window.localStorage.setItem(key, value)
      return
    }
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // A full or blocked localStorage should never stop someone from printing.
  }
}

let migrated = false

function migrateLegacyIfNeeded(): void {
  if (migrated) return
  const bridge = cache()
  if (!bridge) {
    migrated = true
    return
  }
  migrated = true
  if (bridge.read(MIGRATED_KEY) === true) return

  for (const key of LEGACY_KEYS) {
    const legacy = readLocal(key)
    if (legacy == null) continue
    if (key === TEMPLATES_KEY) {
      if (Array.isArray(legacy) && bridge.readTemplates().length === 0) {
        void bridge.writeTemplates(legacy as LabelTemplate[])
      }
      continue
    }
    if (bridge.read(key) != null) continue
    void bridge.write(key, legacy)
  }
  void bridge.write(MIGRATED_KEY, true)
}

function isPlain(value: unknown): value is object {
  return value !== null && typeof value === 'object'
}

export function readPersisted<T>(key: string, fallback: T): T {
  migrateLegacyIfNeeded()
  const bridge = cache()
  if (bridge) {
    const stored = bridge.read(key)
    if (stored !== null && stored !== undefined) {
      return stored as T
    }
  }
  const local = readLocal(key)
  if (local === null || local === undefined) return fallback
  if (fallback !== null && typeof fallback === 'object' && !isPlain(local)) return fallback
  return local as T
}

export function writePersisted(key: string, value: unknown): void {
  migrateLegacyIfNeeded()
  const bridge = cache()
  if (bridge) {
    void bridge.write(key, value)
    return
  }
  writeLocal(key, value)
}

export function readPersistedString(key: string): string | null {
  migrateLegacyIfNeeded()
  const bridge = cache()
  if (bridge) {
    const stored = bridge.read(key)
    return typeof stored === 'string' ? stored : null
  }
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function ensurePersistence(): void {
  migrateLegacyIfNeeded()
}

export function writePersistedString(key: string, value: string): void {
  migrateLegacyIfNeeded()
  const bridge = cache()
  if (bridge) {
    void bridge.write(key, value)
    return
  }
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // A blocked localStorage should not stop the theme from changing.
  }
}
