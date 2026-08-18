import type { Rotation } from './types'

export interface MonoBitmap {
  /** Padded to a whole number of bytes, which is what TSPL BITMAP requires. */
  widthDots: number
  widthBytes: number
  heightDots: number
  /** Packed rows, most significant bit first, where a set bit means a dark dot. */
  bytes: Uint8Array
  /** Black-and-white PNG of the same pixels, for the on-screen preview. */
  previewUrl: string
}

export interface CanvasMonoOptions {
  threshold?: number
  invert?: boolean
}

export interface MonoOptions {
  /** Printed size before rotation, in dots. */
  widthDots: number
  heightDots: number
  /** Baked into the raster, since TSPL BITMAP has no rotation parameter of its own. */
  rotation: Rotation
  /** Luminance cut-off, 0 to 255. Also the pivot when dithering. */
  threshold: number
  dither: boolean
  invert: boolean
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

export function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not decode that image file'))
    image.src = source
  })
}

export function monoBitmapFromCanvas(
  canvas: HTMLCanvasElement,
  options: CanvasMonoOptions = {}
): MonoBitmap {
  const threshold = options.threshold ?? 128
  const invert = options.invert ?? false
  const visibleWidth = canvas.width
  const height = canvas.height
  const widthBytes = Math.ceil(visibleWidth / 8)
  const width = widthBytes * 8

  const source = document.createElement('canvas')
  source.width = width
  source.height = height
  const sourceCtx = source.getContext('2d')
  if (!sourceCtx) throw new Error('Canvas is unavailable in this environment')
  sourceCtx.fillStyle = '#ffffff'
  sourceCtx.fillRect(0, 0, width, height)
  sourceCtx.drawImage(canvas, 0, 0)

  const { data } = sourceCtx.getImageData(0, 0, width, height)
  const dark = new Uint8Array(width * height)
  for (let i = 0; i < dark.length; i += 1) {
    const value = luminance(data, i * 4) < threshold ? 1 : 0
    dark[i] = invert ? (value === 1 ? 0 : 1) : value
  }

  if (width > visibleWidth) {
    for (let y = 0; y < height; y += 1) {
      for (let x = visibleWidth; x < width; x += 1) {
        dark[y * width + x] = 0
      }
    }
  }

  return {
    widthDots: width,
    widthBytes,
    heightDots: height,
    bytes: packRows(dark, width, height, widthBytes),
    previewUrl: toPreviewUrl(dark, width, height, visibleWidth)
  }
}

function luminance(data: Uint8ClampedArray, index: number): number {
  return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
}

export interface ImageContentBounds {
  x: number
  y: number
  width: number
  height: number
  aspectRatio: number
}

/**
 * Finds the ink bounding box of an image, ignoring white and transparent padding
 * on every side. Bounds use the same threshold/invert as conversion so the crop
 * matches what will actually print.
 */
export function detectImageContentFromImage(
  image: HTMLImageElement,
  threshold: number,
  invert: boolean
): ImageContentBounds {
  const naturalWidth = Math.max(1, image.naturalWidth)
  const naturalHeight = Math.max(1, image.naturalHeight)
  const maxScan = 1024
  const scale = Math.min(1, maxScan / naturalWidth, maxScan / naturalHeight)
  const scanWidth = Math.max(1, Math.round(naturalWidth * scale))
  const scanHeight = Math.max(1, Math.round(naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = scanWidth
  canvas.height = scanHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return { x: 0, y: 0, width: naturalWidth, height: naturalHeight, aspectRatio: naturalWidth / naturalHeight }
  }

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, scanWidth, scanHeight)
  ctx.drawImage(image, 0, 0, scanWidth, scanHeight)

  const { data } = ctx.getImageData(0, 0, scanWidth, scanHeight)
  let minX = scanWidth
  let minY = scanHeight
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < scanHeight; y += 1) {
    for (let x = 0; x < scanWidth; x += 1) {
      const lum = luminance(data, (y * scanWidth + x) * 4)
      const isDark = invert ? lum >= threshold : lum < threshold
      if (!isDark) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0) {
    return { x: 0, y: 0, width: naturalWidth, height: naturalHeight, aspectRatio: naturalWidth / naturalHeight }
  }

  const pad = 1
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(scanWidth - 1, maxX + pad)
  maxY = Math.min(scanHeight - 1, maxY + pad)

  const x = Math.floor(minX / scale)
  const y = Math.floor(minY / scale)
  const width = Math.max(1, Math.min(naturalWidth - x, Math.ceil((maxX - minX + 1) / scale)))
  const height = Math.max(1, Math.min(naturalHeight - y, Math.ceil((maxY - minY + 1) / scale)))
  return { x, y, width, height, aspectRatio: width / height }
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  crop: ImageContentBounds,
  destWidth: number,
  destHeight: number
): void {
  const scale = Math.max(destWidth / crop.width, destHeight / crop.height)
  const drawWidth = crop.width * scale
  const drawHeight = crop.height * scale
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    (destWidth - drawWidth) / 2,
    (destHeight - drawHeight) / 2,
    drawWidth,
    drawHeight
  )
}

/**
 * Floyd-Steinberg error diffusion. Using the user's threshold as the pivot keeps the
 * brightness control meaningful while dithering.
 */
function ditherToDark(gray: Float32Array, width: number, height: number, threshold: number): Uint8Array {
  const dark = new Uint8Array(width * height)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const old = gray[index]
      const isDark = old < threshold
      dark[index] = isDark ? 1 : 0

      const error = old - (isDark ? 0 : 255)
      if (x + 1 < width) gray[index + 1] += (error * 7) / 16
      if (y + 1 < height) {
        if (x > 0) gray[index + width - 1] += (error * 3) / 16
        gray[index + width] += (error * 5) / 16
        if (x + 1 < width) gray[index + width + 1] += error / 16
      }
    }
  }

  return dark
}

function packRows(dark: Uint8Array, width: number, height: number, widthBytes: number): Uint8Array {
  const bytes = new Uint8Array(widthBytes * height)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (dark[y * width + x] === 0) continue
      const byteIndex = y * widthBytes + (x >> 3)
      bytes[byteIndex] |= 0x80 >> (x & 7)
    }
  }

  return bytes
}

function toPreviewUrl(dark: Uint8Array, width: number, height: number, visibleWidth: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = visibleWidth
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const output = ctx.createImageData(visibleWidth, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < visibleWidth; x += 1) {
      const value = dark[y * width + x] === 1 ? 0 : 255
      const target = (y * visibleWidth + x) * 4
      output.data[target] = value
      output.data[target + 1] = value
      output.data[target + 2] = value
      output.data[target + 3] = 255
    }
  }

  ctx.putImageData(output, 0, 0)
  return canvas.toDataURL('image/png')
}

/** Turns the drawing space so the image lands rotated inside `visibleWidth` x `height`. */
function applyRotation(
  ctx: CanvasRenderingContext2D,
  rotation: Rotation,
  drawWidth: number,
  drawHeight: number,
  visibleWidth: number,
  height: number
): void {
  switch (rotation) {
    case 0:
      break
    case 90:
      ctx.translate(visibleWidth, 0)
      ctx.rotate(Math.PI / 2)
      break
    case 180:
      ctx.translate(drawWidth, drawHeight)
      ctx.rotate(Math.PI)
      break
    case 270:
      ctx.translate(0, height)
      ctx.rotate(-Math.PI / 2)
      break
  }
}

function trimDarkMargins(
  dark: Uint8Array,
  width: number,
  height: number,
  visibleWidth: number
): { dark: Uint8Array; width: number; height: number; visibleWidth: number; widthBytes: number } {
  let minX = visibleWidth
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < visibleWidth; x += 1) {
      if (dark[y * width + x] !== 1) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0) {
    return { dark, width, height, visibleWidth, widthBytes: Math.ceil(visibleWidth / 8) }
  }

  const cropWidth = maxX - minX + 1
  const cropHeight = maxY - minY + 1
  if (cropWidth === visibleWidth && cropHeight === height && minX === 0 && minY === 0) {
    return { dark, width, height, visibleWidth, widthBytes: Math.ceil(visibleWidth / 8) }
  }

  const nextVisibleWidth = cropWidth
  const nextWidthBytes = Math.ceil(nextVisibleWidth / 8)
  const nextWidth = nextWidthBytes * 8
  const nextDark = new Uint8Array(nextWidth * cropHeight)

  for (let y = 0; y < cropHeight; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      nextDark[y * nextWidth + x] = dark[(minY + y) * width + (minX + x)]
    }
  }

  return {
    dark: nextDark,
    width: nextWidth,
    height: cropHeight,
    visibleWidth: nextVisibleWidth,
    widthBytes: nextWidthBytes
  }
}

/**
 * Rasterises an image to one bit per dot at the exact size it will print, rotation
 * included. Rows are padded to a byte boundary with white, since BITMAP measures width
 * in bytes.
 */
export async function toMonoBitmap(source: string, options: MonoOptions): Promise<MonoBitmap> {
  const image = await loadImage(source)

  const drawWidth = Math.max(1, Math.round(options.widthDots))
  const drawHeight = Math.max(1, Math.round(options.heightDots))
  const quarterTurn = options.rotation === 90 || options.rotation === 270
  const visibleWidth = quarterTurn ? drawHeight : drawWidth
  const height = quarterTurn ? drawWidth : drawHeight
  const widthBytes = Math.ceil(visibleWidth / 8)
  const width = widthBytes * 8

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable in this environment')

  // White backdrop so transparent areas do not print as black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const crop = detectImageContentFromImage(image, options.threshold, options.invert)

  ctx.save()
  applyRotation(ctx, options.rotation, drawWidth, drawHeight, visibleWidth, height)
  drawCover(ctx, image, crop, drawWidth, drawHeight)
  ctx.restore()

  const { data } = ctx.getImageData(0, 0, width, height)
  const gray = new Float32Array(width * height)
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = luminance(data, i * 4)
  }

  let dark: Uint8Array
  if (options.dither) {
    dark = ditherToDark(gray, width, height, options.threshold)
  } else {
    dark = new Uint8Array(width * height)
    for (let i = 0; i < gray.length; i += 1) {
      dark[i] = gray[i] < options.threshold ? 1 : 0
    }
  }

  if (options.invert) {
    for (let i = 0; i < dark.length; i += 1) {
      dark[i] = dark[i] === 1 ? 0 : 1
    }
  }

  // Keep the byte padding white, otherwise inverting would print a stripe down the edge.
  if (width > visibleWidth) {
    for (let y = 0; y < height; y += 1) {
      for (let x = visibleWidth; x < width; x += 1) {
        dark[y * width + x] = 0
      }
    }
  }

  const trimmed = trimDarkMargins(dark, width, height, visibleWidth)

  return {
    widthDots: trimmed.width,
    widthBytes: trimmed.widthBytes,
    heightDots: trimmed.height,
    bytes: packRows(trimmed.dark, trimmed.width, trimmed.height, trimmed.widthBytes),
    previewUrl: toPreviewUrl(trimmed.dark, trimmed.width, trimmed.height, trimmed.visibleWidth)
  }
}
