import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const SIZE = 256
const CREAM = [244, 241, 232, 255]
const INK = [18, 18, 18, 255]
const PAPER = [255, 255, 255, 255]
const RULE = [32, 32, 32, 255]
const SLOT = [90, 90, 90, 255]

function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crcInput = Buffer.concat([typeBytes, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcInput))
  return Buffer.concat([length, typeBytes, data, crc])
}

function writePng(path, pixels, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1)
    raw[rowStart] = 0
    pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, png)
}

function setPixel(pixels, x, y, color) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  pixels[i] = color[0]
  pixels[i + 1] = color[1]
  pixels[i + 2] = color[2]
  pixels[i + 3] = color[3]
}

function fillRect(pixels, x0, y0, x1, y1, color) {
  const left = Math.max(0, Math.round(x0))
  const top = Math.max(0, Math.round(y0))
  const right = Math.min(SIZE - 1, Math.round(x1))
  const bottom = Math.min(SIZE - 1, Math.round(y1))
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) setPixel(pixels, x, y, color)
  }
}

function fillRoundedRect(pixels, x0, y0, x1, y1, radius, color) {
  const r = Math.max(0, radius)
  fillRect(pixels, x0 + r, y0, x1 - r, y1, color)
  fillRect(pixels, x0, y0 + r, x1, y1 - r, color)
  const corners = [
    [x0 + r, y0 + r],
    [x1 - r, y0 + r],
    [x0 + r, y1 - r],
    [x1 - r, y1 - r]
  ]
  for (const [cx, cy] of corners) {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r) setPixel(pixels, Math.round(cx + x), Math.round(cy + y), color)
      }
    }
  }
}

const pixels = Buffer.alloc(SIZE * SIZE * 4)
fillRect(pixels, 0, 0, SIZE, SIZE, CREAM)
fillRoundedRect(pixels, 18, 18, 237, 237, 36, INK)
fillRoundedRect(pixels, 28, 28, 227, 227, 30, CREAM)

fillRoundedRect(pixels, 78, 36, 177, 128, 8, PAPER)
fillRect(pixels, 90, 52, 165, 58, RULE)
fillRect(pixels, 90, 68, 158, 74, RULE)
fillRect(pixels, 90, 84, 150, 90, RULE)
fillRect(pixels, 90, 100, 140, 106, RULE)

fillRoundedRect(pixels, 48, 118, 207, 214, 18, INK)
fillRect(pixels, 70, 118, 185, 128, SLOT)
fillRoundedRect(pixels, 108, 168, 147, 188, 8, CREAM)
fillRect(pixels, 118, 198, 137, 208, CREAM)

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png')
writePng(out, pixels, SIZE, SIZE)
console.log(`Wrote ${out}`)
