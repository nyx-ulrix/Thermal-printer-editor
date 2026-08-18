import { getFontSpec } from './fonts'
import type { MonoBitmap } from './imageMono'
import { rasterizeJob } from './jobRaster'
import { mediaGapMm } from './media'
import { elementBoundsMm } from './preview'
import type { ImageElement, LabelJob, LabelMedia, LineElement, TextElement, TsplFontId } from './types'
import { clamp, formatMm, mmToDots } from './units'

const LF = '\r\n'

/** A job is text commands with raw bitmap bytes spliced in between. */
export type JobPart = string | Uint8Array

export type BitmapLookup = Map<string, MonoBitmap>

/**
 * The programming manual escapes a literal double quote inside content as \["].
 * A line break would terminate the command early, so breaks collapse to spaces.
 */
export function escapeTsplText(text: string): string {
  return text.replace(/"/g, '\\["]').replace(/[\r\n]+/g, ' ')
}

/** Bitmap fonts take whole-number multipliers; point-sized fonts take any number. */
function formatScale(font: TsplFontId, value: number): string {
  if (getFontSpec(font).kind === 'bitmap') {
    return String(clamp(Math.round(value), 1, 10))
  }
  return formatMm(clamp(value, 1, 1000), 1)
}

export function textCommand(element: TextElement): string {
  const x = mmToDots(element.xMm)
  const y = mmToDots(element.yMm)
  const scaleX = formatScale(element.font, element.scaleX)
  const scaleY = formatScale(element.font, element.scaleY)
  return `TEXT ${x},${y},"${element.font}",${element.rotation},${scaleX},${scaleY},"${escapeTsplText(element.text)}"`
}

/**
 * Lines are drawn as solid bars, the only straight-line primitive TSPL offers. A bar has
 * no rotation parameter, so the rotated bounding box is what gets sent.
 */
export function barCommand(element: LineElement): string {
  const bounds = elementBoundsMm(element)
  const x = Math.max(0, mmToDots(bounds.xMm))
  const y = Math.max(0, mmToDots(bounds.yMm))
  const width = Math.max(1, mmToDots(bounds.widthMm))
  const height = Math.max(1, mmToDots(bounds.heightMm))
  return `BAR ${x},${y},${width},${height}`
}

/** BITMAP has no rotation either, so the raster arrives pre-rotated at its box origin. */
export function bitmapCommandHeader(element: ImageElement, bitmap: MonoBitmap): string {
  const bounds = elementBoundsMm(element)
  const x = Math.max(0, mmToDots(bounds.xMm))
  const y = Math.max(0, mmToDots(bounds.yMm))
  return `BITMAP ${x},${y},${bitmap.widthBytes},${bitmap.heightDots},0,`
}

/**
 * TSPL BITMAP data uses bit 0 for a printed dot, the inverse of how the bitmap is
 * packed in memory, so every byte is complemented on the way out.
 */
function toWirePolarity(bytes: Uint8Array): Uint8Array {
  const wire = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i += 1) {
    wire[i] = ~bytes[i] & 0xff
  }
  return wire
}

/**
 * SIZE and GAP are sent every time, so the media size comes from this app rather
 * than the Windows driver's paper settings. Continuous rolls use GAP 0,0 so the
 * printer does not hunt for a label gap.
 */
export function tsplMediaHeader(media: LabelMedia): string[] {
  return [
    `SIZE ${formatMm(media.widthMm)} mm,${formatMm(media.heightMm)} mm`,
    `GAP ${formatMm(mediaGapMm(media))} mm,0`,
    `DENSITY ${clamp(Math.round(media.density), 0, 15)}`,
    `SPEED ${formatMm(media.speed, 1)}`,
    `DIRECTION ${media.direction}`,
    'REFERENCE 0,0',
    'CLS'
  ]
}

export function buildJobParts(job: LabelJob, bitmaps: BitmapLookup): JobPart[] {
  const { media, elements } = job
  const copies = clamp(Math.round(job.copies), 1, 999)

  const parts: JobPart[] = [tsplMediaHeader(media).join(LF) + LF]

  for (const element of elements) {
    switch (element.type) {
      case 'text':
        if (element.text.trim() === '') break
        parts.push(textCommand(element) + LF)
        break
      case 'line':
        parts.push(barCommand(element) + LF)
        break
      case 'image': {
        const bitmap = bitmaps.get(element.id)
        if (!bitmap) break
        parts.push(bitmapCommandHeader(element, bitmap))
        parts.push(toWirePolarity(bitmap.bytes))
        parts.push(LF)
        break
      }
    }
  }

  parts.push(`PRINT 1,${copies}` + LF)
  return parts
}

export function buildTsplBytes(job: LabelJob, bitmaps: BitmapLookup): Uint8Array {
  const encoder = new TextEncoder()
  const chunks = buildJobParts(job, bitmaps).map((part) =>
    typeof part === 'string' ? encoder.encode(part) : part
  )

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const payload = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    payload.set(chunk, offset)
    offset += chunk.length
  }

  return payload
}

/**
 * Renders the whole label to a single bitmap, used when arbitrary-angle rotation cannot be
 * expressed by TSPL's native TEXT and BAR commands.
 */
export async function buildRasterTsplBytes(job: LabelJob, bitmaps: BitmapLookup): Promise<Uint8Array> {
  const bitmap = await rasterizeJob(job, bitmaps)
  const header = [
    ...tsplMediaHeader(job.media),
    `BITMAP 0,0,${bitmap.widthBytes},${bitmap.heightDots},0,`
  ].join(LF)

  const encoder = new TextEncoder()
  const chunks = [
    encoder.encode(header + LF),
    toWirePolarity(bitmap.bytes),
    encoder.encode(LF + `PRINT 1,${clamp(Math.round(job.copies), 1, 999)}` + LF)
  ]

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const payload = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    payload.set(chunk, offset)
    offset += chunk.length
  }
  return payload
}

/** Same job rendered for humans, with bitmap payloads summarised rather than dumped. */
export function buildTsplPreview(job: LabelJob, bitmaps: BitmapLookup): string {
  return buildJobParts(job, bitmaps)
    .map((part) => (typeof part === 'string' ? part : `<${part.length} bytes of bitmap data>`))
    .join('')
}
