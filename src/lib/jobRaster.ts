import { ensureCustomFontLoaded } from './customFonts'
import { loadImage, monoBitmapFromCanvas, toMonoBitmap, type MonoBitmap } from './imageMono'
import { textTypography } from './preview'
import type { ImageElement, LabelJob, LabelElement, TextElement } from './types'
import { mmToDots, roundMm } from './units'

type BitmapLookup = Map<string, MonoBitmap>

async function drawText(ctx: CanvasRenderingContext2D, element: TextElement): Promise<void> {
  if (element.customFontDataUrl && element.customFontFamily) {
    await ensureCustomFontLoaded(element.customFontFamily, element.customFontDataUrl)
  }
  const typography = textTypography(element)
  ctx.save()
  ctx.translate(mmToDots(element.xMm), mmToDots(element.yMm))
  ctx.rotate((element.rotation * Math.PI) / 180)
  ctx.fillStyle = '#000000'
  ctx.textBaseline = 'top'
  ctx.font = `${typography.fontWeight} ${typography.fontSizeDots}px ${typography.fontFamily}`

  if (typography.scaleXRatio !== 1) ctx.scale(typography.scaleXRatio, 1)

  if (typography.letterSpacingDots !== 0) {
    let cursorX = 0
    for (const character of element.text || ' ') {
      ctx.fillText(character, cursorX, 0)
      cursorX += typography.fontSizeDots * 0.6 + typography.letterSpacingDots
    }
  } else {
    ctx.fillText(element.text || ' ', 0, 0)
  }
  ctx.restore()
}

function drawLine(ctx: CanvasRenderingContext2D, element: LabelElement): void {
  if (element.type !== 'line') return
  ctx.save()
  ctx.translate(mmToDots(element.xMm), mmToDots(element.yMm))
  ctx.rotate((element.rotation * Math.PI) / 180)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, Math.max(mmToDots(element.lengthMm), 1), Math.max(mmToDots(element.thicknessMm), 1))
  ctx.restore()
}

async function drawImage(ctx: CanvasRenderingContext2D, element: ImageElement): Promise<void> {
  const mono = await toMonoBitmap(element.sourceDataUrl, {
    widthDots: Math.max(mmToDots(element.widthMm), 1),
    heightDots: Math.max(mmToDots(element.heightMm), 1),
    rotation: 0,
    threshold: element.threshold,
    dither: element.dither,
    invert: element.invert
  })
  const image = await loadImage(mono.previewUrl)
  const destWidth = Math.max(mmToDots(element.widthMm), 1)
  const destHeight = Math.max(mmToDots(element.heightMm), 1)
  const scale = Math.max(destWidth / Math.max(image.naturalWidth, 1), destHeight / Math.max(image.naturalHeight, 1))
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  ctx.save()
  ctx.translate(mmToDots(element.xMm), mmToDots(element.yMm))
  ctx.rotate((element.rotation * Math.PI) / 180)
  ctx.drawImage(
    image,
    (destWidth - drawWidth) / 2,
    (destHeight - drawHeight) / 2,
    drawWidth,
    drawHeight
  )
  ctx.restore()
}

/**
 * Draws the whole label exactly as previewed, then converts that composed canvas to a one-bit
 * bitmap. This is the fallback for arbitrary rotations that TSPL's native primitives cannot
 * express.
 */
export async function rasterizeJob(job: LabelJob, _bitmaps: BitmapLookup): Promise<MonoBitmap> {
  const width = Math.max(mmToDots(job.media.widthMm), 1)
  const height = Math.max(mmToDots(job.media.heightMm), 1)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable in this environment')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  for (const element of job.elements) {
    if (element.type === 'text') {
      await drawText(ctx, element)
      continue
    }
    if (element.type === 'line') {
      drawLine(ctx, element)
      continue
    }
    await drawImage(ctx, element)
  }

  return monoBitmapFromCanvas(canvas, { threshold: 200 })
}

export function hasArbitraryRotation(elements: LabelElement[]): boolean {
  return elements.some((element) => roundMm(element.rotation % 90, 3) !== 0)
}
