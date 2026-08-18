import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, join, relative } from 'node:path'
import type { LabelTemplate } from '../src/lib/types'

export const TEMPLATE_KIND = 'receipt-printer-template'
export const TEMPLATE_VERSION = 1

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function extensionForMime(mime: string): string {
  const normalized = mime.toLowerCase()
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return '.jpg'
  if (normalized === 'image/png') return '.png'
  if (normalized === 'image/gif') return '.gif'
  if (normalized === 'image/webp') return '.webp'
  if (normalized === 'image/svg+xml') return '.svg'
  if (normalized.includes('ttf') || normalized.includes('sfnt')) return '.ttf'
  if (normalized.includes('otf') || normalized.includes('opentype')) return '.otf'
  if (normalized === 'font/woff') return '.woff'
  if (normalized === 'font/woff2') return '.woff2'
  return '.bin'
}

function mimeFromExt(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    case '.ttf':
      return 'font/ttf'
    case '.otf':
      return 'font/otf'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    default:
      return 'image/png'
  }
}

function parseDataUrl(value: string): { mime: string; buffer: Buffer } | null {
  if (!value.startsWith('data:')) return null
  const comma = value.indexOf(',')
  if (comma < 0) return null
  const header = value.slice('data:'.length, comma)
  const payload = value.slice(comma + 1)
  const parts = header.split(';')
  const mime = parts[0] || 'application/octet-stream'
  const buffer = parts.includes('base64')
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8')
  if (buffer.length === 0) return null
  return { mime, buffer }
}

function mapElements(elements: unknown, visit: (element: JsonRecord) => void): unknown[] {
  if (!Array.isArray(elements)) return []
  return elements.map((item) => {
    const element = asRecord(item)
    if (!element) return item
    const next = { ...element }
    if (next.type === 'group') {
      next.children = mapElements(next.children, visit)
    }
    visit(next)
    return next
  })
}

function writeAsset(
  assetsDir: string,
  used: Set<string>,
  dataUrl: unknown,
  basename: string
): string | undefined {
  if (typeof dataUrl !== 'string' || dataUrl === '') return undefined
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return undefined
  mkdirSync(assetsDir, { recursive: true })
  const filename = `${basename}${extensionForMime(parsed.mime)}`
  writeFileSync(join(assetsDir, filename), parsed.buffer)
  used.add(filename)
  return `assets/${filename}`
}

function resolveAssetPath(templateDir: string, relativePath: unknown): string | null {
  if (typeof relativePath !== 'string') return null
  const normalized = relativePath.replace(/\\/g, '/')
  if (!normalized.startsWith('assets/') || normalized.includes('..')) return null
  const absolute = join(templateDir, ...normalized.split('/'))
  const rel = relative(templateDir, absolute)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return absolute
}

function dataUrlFromAsset(templateDir: string, relativePath: unknown): string | undefined {
  const absolute = resolveAssetPath(templateDir, relativePath)
  if (!absolute) return undefined
  try {
    const buffer = readFileSync(absolute)
    return `data:${mimeFromExt(absolute)};base64,${buffer.toString('base64')}`
  } catch {
    return undefined
  }
}

function inlineAssets(templateDir: string, elements: unknown): unknown[] {
  return mapElements(elements, (element) => {
    if (element.type === 'image') {
      const fromFile = dataUrlFromAsset(templateDir, element.sourceFile)
      if (typeof element.sourceDataUrl !== 'string' || element.sourceDataUrl === '') {
        if (fromFile) element.sourceDataUrl = fromFile
      }
      delete element.sourceFile
      return
    }
    if (element.type === 'text') {
      const fromFile = dataUrlFromAsset(templateDir, element.fontFile)
      if (typeof element.customFontDataUrl !== 'string' || element.customFontDataUrl === '') {
        if (fromFile) element.customFontDataUrl = fromFile
      }
      delete element.fontFile
      return
    }
    if (element.type !== 'input') return

    const imageStyle = asRecord(element.imageStyle)
    if (imageStyle) {
      const fromFile = dataUrlFromAsset(templateDir, imageStyle.sourceFile)
      if (typeof imageStyle.sourceDataUrl !== 'string' || imageStyle.sourceDataUrl === '') {
        if (fromFile) imageStyle.sourceDataUrl = fromFile
      }
      delete imageStyle.sourceFile
      element.imageStyle = imageStyle
    }

    const textStyle = asRecord(element.textStyle)
    if (textStyle) {
      const fromFile = dataUrlFromAsset(templateDir, textStyle.fontFile)
      if (typeof textStyle.customFontDataUrl !== 'string' || textStyle.customFontDataUrl === '') {
        if (fromFile) textStyle.customFontDataUrl = fromFile
      }
      delete textStyle.fontFile
      element.textStyle = textStyle
    }
  })
}

export function isTemplateRecord(value: unknown): value is JsonRecord {
  const record = asRecord(value)
  return Boolean(record && typeof record.id === 'string' && record.id)
}

export function unpackStoredTemplate(templateDir: string, stored: JsonRecord): LabelTemplate {
  const elements = inlineAssets(templateDir, stored.elements)
  return {
    id: String(stored.id),
    name: typeof stored.name === 'string' ? stored.name : 'Untitled label',
    updatedAt: Number(stored.updatedAt) || 0,
    media: stored.media as LabelTemplate['media'],
    elements: elements as LabelTemplate['elements'],
    copies: Number(stored.copies) || 1
  }
}

export function packTemplateToDir(templateDir: string, template: LabelTemplate): void {
  mkdirSync(templateDir, { recursive: true })
  const assetsDir = join(templateDir, 'assets')
  const used = new Set<string>()

  const elements = mapElements(template.elements, (element) => {
    const id = typeof element.id === 'string' ? element.id : 'element'
    if (element.type === 'image') {
      const sourceFile = writeAsset(assetsDir, used, element.sourceDataUrl, `image-${id}`)
      if (sourceFile) element.sourceFile = sourceFile
      delete element.sourceDataUrl
      return
    }
    if (element.type === 'text') {
      const fontFile = writeAsset(assetsDir, used, element.customFontDataUrl, `font-${id}`)
      if (fontFile) element.fontFile = fontFile
      delete element.customFontDataUrl
      return
    }
    if (element.type !== 'input') return

    const imageStyle = asRecord(element.imageStyle)
    if (imageStyle) {
      const sourceFile = writeAsset(assetsDir, used, imageStyle.sourceDataUrl, `input-${id}`)
      if (sourceFile) imageStyle.sourceFile = sourceFile
      delete imageStyle.sourceDataUrl
      element.imageStyle = imageStyle
    }

    const textStyle = asRecord(element.textStyle)
    if (textStyle) {
      const fontFile = writeAsset(assetsDir, used, textStyle.customFontDataUrl, `input-font-${id}`)
      if (fontFile) textStyle.fontFile = fontFile
      delete textStyle.customFontDataUrl
      element.textStyle = textStyle
    }
  })

  const document = {
    kind: TEMPLATE_KIND,
    version: TEMPLATE_VERSION,
    id: template.id,
    name: template.name,
    updatedAt: template.updatedAt,
    media: template.media,
    copies: template.copies,
    elements
  }

  writeFileSync(join(templateDir, 'template.json'), `${JSON.stringify(document, null, 2)}\n`, 'utf8')

  try {
    for (const file of readdirSync(assetsDir)) {
      if (used.has(file)) continue
      rmSync(join(assetsDir, file), { force: true })
    }
    if (used.size === 0) {
      rmSync(assetsDir, { recursive: true, force: true })
    }
  } catch {
    // A missing assets folder is normal when the label has no placed images or fonts.
  }
}
