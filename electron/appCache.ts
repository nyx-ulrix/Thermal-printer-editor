import { app, ipcMain } from 'electron'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LabelTemplate } from '../src/lib/types'
import {
  isTemplateRecord,
  packTemplateToDir,
  unpackStoredTemplate
} from './templateDocument'

const KEY_PATTERN = /^[a-zA-Z0-9._-]+$/
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/

function cacheRoot(): string {
  return join(app.getPath('userData'), 'app-cache')
}

function storeDir(): string {
  return join(cacheRoot(), 'store')
}

function templatesDir(): string {
  return join(cacheRoot(), 'templates')
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

function isSafeKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_PATTERN.test(key)
}

function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id)
}

function readJsonFile(filePath: string): unknown | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    return parsed === undefined ? null : parsed
  } catch {
    return null
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  ensureDir(dirname(filePath))
  writeFileSync(filePath, JSON.stringify(value), 'utf8')
}

export function readStore(key: string): unknown | null {
  if (!isSafeKey(key)) return null
  return readJsonFile(join(storeDir(), `${key}.json`))
}

export function writeStore(key: string, value: unknown): void {
  if (!isSafeKey(key)) {
    throw new Error('Invalid cache key')
  }
  writeJsonFile(join(storeDir(), `${key}.json`), value)
}

function readLegacyTemplateFile(filePath: string): LabelTemplate | null {
  const parsed = readJsonFile(filePath)
  if (!isTemplateRecord(parsed)) return null
  return unpackStoredTemplate(dirname(filePath), parsed)
}

export function readTemplates(): LabelTemplate[] {
  ensureDir(templatesDir())
  const templates: LabelTemplate[] = []

  for (const entry of readdirSync(templatesDir(), { withFileTypes: true })) {
    const fullPath = join(templatesDir(), entry.name)
    if (entry.isDirectory()) {
      const packed = readJsonFile(join(fullPath, 'template.json'))
      if (!isTemplateRecord(packed)) continue
      templates.push(unpackStoredTemplate(fullPath, packed))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      const template = readLegacyTemplateFile(fullPath)
      if (template) templates.push(template)
    }
  }

  return templates
}

export function writeTemplates(templates: unknown): void {
  if (!Array.isArray(templates)) {
    throw new Error('Templates must be an array')
  }

  ensureDir(templatesDir())
  const keep = new Set<string>()

  for (const item of templates) {
    if (!isTemplateRecord(item) || !isSafeId(item.id)) continue
    const template: LabelTemplate = {
      id: String(item.id),
      name: typeof item.name === 'string' ? item.name : 'Untitled label',
      updatedAt: Number(item.updatedAt) || Date.now(),
      media: item.media as LabelTemplate['media'],
      elements: Array.isArray(item.elements) ? (item.elements as LabelTemplate['elements']) : [],
      copies: Number(item.copies) || 1
    }
    keep.add(template.id)
    packTemplateToDir(join(templatesDir(), template.id), template)
  }

  for (const entry of readdirSync(templatesDir(), { withFileTypes: true })) {
    const fullPath = join(templatesDir(), entry.name)
    if (entry.isDirectory()) {
      if (keep.has(entry.name)) continue
      try {
        rmSync(fullPath, { recursive: true, force: true })
      } catch {
        // Ignoring a stale folder should not fail a save.
      }
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      try {
        rmSync(fullPath, { force: true })
      } catch {
        // Leftover flat JSON from an older cache format.
      }
    }
  }
}

export function registerCacheIpc(): void {
  ensureDir(storeDir())
  ensureDir(templatesDir())

  ipcMain.on('cache:read', (event, key: unknown) => {
    event.returnValue = isSafeKey(key) ? readStore(key) : null
  })

  ipcMain.handle('cache:write', (_event, key: unknown, value: unknown) => {
    try {
      if (!isSafeKey(key)) {
        return { ok: false as const, error: 'Invalid cache key' }
      }
      writeStore(key, value)
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.on('cache:readTemplates', (event) => {
    event.returnValue = readTemplates()
  })

  ipcMain.handle('cache:writeTemplates', (_event, templates: unknown) => {
    try {
      writeTemplates(templates)
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
