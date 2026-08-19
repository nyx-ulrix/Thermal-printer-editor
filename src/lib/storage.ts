import { normalizeFieldValues, normalizeLabelElement } from './fields'
import { withMediaDefaults } from './media'
import { ensurePersistence, readPersisted, writePersisted } from './persist'
import type { FieldValues, FontLibraryItem, LabelMedia, LabelTemplate, SavedPrintFill, TemplateGroup } from './types'

const SESSION_KEY = 'gp3120tl.session.v1'
const TEMPLATES_KEY = 'gp3120tl.templates.v1'
const VALUES_KEY = 'gp3120tl.fieldvalues.v1'
const HISTORY_KEY = 'gp3120tl.printfills.v1'
const PANELS_KEY = 'gp3120tl.panels.v1'
const FONTS_KEY = 'gp3120tl.fonts.v1'
const GROUPS_KEY = 'gp3120tl.templateGroups.v1'

export interface PersistedSession {
  media: LabelMedia
  lastPreset?: { widthMm: number; heightMm: number }
  copies: number
  printerName: string
}

function readJson<T>(key: string, fallback: T): T {
  const parsed = readPersisted<T>(key, fallback)
  return parsed === null || typeof parsed !== 'object' ? fallback : parsed
}

function writeJson(key: string, value: unknown): void {
  writePersisted(key, value)
}

export function loadSession(): Partial<PersistedSession> {
  return readJson<Partial<PersistedSession>>(SESSION_KEY, {})
}

export function saveSession(session: PersistedSession): void {
  writeJson(SESSION_KEY, session)
}

function normalizeTemplates(stored: LabelTemplate[]): LabelTemplate[] {
  return stored
    .filter((template) => Boolean(template?.id))
    .map((template) => {
      const updatedAt = Number(template.updatedAt) || Date.now()
      const createdAt = Number(template.createdAt) || updatedAt
      return {
        ...template,
        createdAt,
        updatedAt,
        media: withMediaDefaults(template.media),
        elements: Array.isArray(template.elements)
          ? template.elements.map(normalizeLabelElement)
          : [],
        groupId: typeof template.groupId === 'string' && template.groupId ? template.groupId : undefined
      }
    })
}

export function loadTemplates(): LabelTemplate[] {
  ensurePersistence()
  const stored = readJson<LabelTemplate[]>(TEMPLATES_KEY, [])
  return Array.isArray(stored) ? normalizeTemplates(stored) : []
}

export async function loadTemplatesAsync(): Promise<LabelTemplate[]> {
  ensurePersistence()
  if (window.appCache) {
    try {
      const cached = await window.appCache.readTemplates()
      if (Array.isArray(cached) && cached.length > 0) return normalizeTemplates(cached)
    } catch {
      // Fall through to localStorage.
    }
  }
  const stored = loadTemplates()
  if (stored.length > 0) {
    void window.appCache?.writeTemplates(stored)
  }
  return stored
}

export function saveTemplates(templates: LabelTemplate[]): void {
  if (window.appCache) {
    void window.appCache.writeTemplates(templates)
    return
  }
  writeJson(TEMPLATES_KEY, templates)
}

export function loadTemplateGroups(): TemplateGroup[] {
  const stored = readJson<TemplateGroup[]>(GROUPS_KEY, [])
  return Array.isArray(stored)
    ? stored.filter((group) => Boolean(group?.id && group?.name))
    : []
}

export function saveTemplateGroups(groups: TemplateGroup[]): void {
  writeJson(GROUPS_KEY, groups)
}

const HOME_SORT_KEY = 'gp3120tl.homeSort.v1'

export type HomeSortKey = 'created' | 'edited' | 'name'
export type HomeSortDirection = 'asc' | 'desc'

export interface HomeSortPreference {
  key: HomeSortKey
  direction: HomeSortDirection
}

export function loadHomeSort(): HomeSortPreference {
  const stored = readJson<Partial<HomeSortPreference>>(HOME_SORT_KEY, {})
  const key: HomeSortKey =
    stored.key === 'created' || stored.key === 'name' || stored.key === 'edited' ? stored.key : 'edited'
  const direction: HomeSortDirection = stored.direction === 'asc' ? 'asc' : 'desc'
  return { key, direction }
}

export function saveHomeSort(sort: HomeSortPreference): void {
  writeJson(HOME_SORT_KEY, sort)
}

/** Last values typed on the print page, per template, so a rerun starts prefilled. */
export function loadFieldValues(): Record<string, FieldValues> {
  const stored = readJson<Record<string, unknown>>(VALUES_KEY, {})
  const next: Record<string, FieldValues> = {}
  for (const [key, value] of Object.entries(stored)) {
    next[key] = normalizeFieldValues(value)
  }
  return next
}

export function saveFieldValues(values: Record<string, FieldValues>): void {
  writeJson(VALUES_KEY, values)
}

const MAX_FILLS_PER_TEMPLATE = 15

export function loadPrintHistory(): Record<string, SavedPrintFill[]> {
  const stored = readJson<Record<string, SavedPrintFill[]>>(HISTORY_KEY, {})
  const next: Record<string, SavedPrintFill[]> = {}
  for (const [key, fills] of Object.entries(stored)) {
    if (!Array.isArray(fills)) continue
    next[key] = fills
      .filter((fill) => Boolean(fill?.id && fill.values))
      .map((fill) => ({
        ...fill,
        values: normalizeFieldValues(fill.values)
      }))
  }
  return next
}

export function savePrintHistory(history: Record<string, SavedPrintFill[]>): void {
  writeJson(HISTORY_KEY, history)
}

export function rememberPrintFill(
  history: Record<string, SavedPrintFill[]>,
  templateKey: string,
  fill: SavedPrintFill
): Record<string, SavedPrintFill[]> {
  const previous = history[templateKey] ?? []
  const duplicate = previous.find((item) => JSON.stringify(item.values) === JSON.stringify(fill.values))
  const rest = duplicate ? previous.filter((item) => item.id !== duplicate.id) : previous
  return {
    ...history,
    [templateKey]: [fill, ...rest].slice(0, MAX_FILLS_PER_TEMPLATE)
  }
}

export function loadPanelState(): Record<string, boolean> {
  return readJson<Record<string, boolean>>(PANELS_KEY, {})
}

export function savePanelState(state: Record<string, boolean>): void {
  writeJson(PANELS_KEY, state)
}

export function loadFontLibrary(): FontLibraryItem[] {
  const stored = readJson<FontLibraryItem[]>(FONTS_KEY, [])
  return Array.isArray(stored) ? stored.filter((font) => Boolean(font?.id && font?.family)) : []
}

export function saveFontLibrary(fonts: FontLibraryItem[]): void {
  writeJson(FONTS_KEY, fonts)
}
