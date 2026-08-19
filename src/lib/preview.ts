import { getFontSpec } from './fonts'
import { mediaContentRect } from './padding'
import { measureWidthAtReference, MEASURE_FONT_PX } from './textMetrics'
import type { LabelElement, LabelMedia, Rotation, TextElement } from './types'
import { getDotsPerMm, pointsToDots, roundMm } from './units'

export interface TextTypography {
  fontFamily: string
  fontWeight: number
  /** Glyph size in dots, converted to pixels by the caller. */
  fontSizeDots: number
  letterSpacingDots: number
  /** Horizontal squeeze applied on top of the font size, for font 0's width in points. */
  scaleXRatio: number
}

/**
 * Bitmap fonts print into fixed cells, so the preview sizes the glyph from the cell
 * height and pads each character out to the cell width. Monospace advance is about
 * 0.6em, which is what the padding assumes. Point-sized fonts are proportional, so
 * they are measured instead.
 */
export function textTypography(element: TextElement): TextTypography {
  const spec = getFontSpec(element.font, element.customFontFamily)

  if (spec.kind === 'bitmap') {
    const cellWidth = spec.widthDots * element.scaleX
    const cellHeight = spec.heightDots * element.scaleY
    const fontSizeDots = cellHeight * 0.8
    return {
      fontFamily: spec.cssFamily,
      fontWeight: spec.cssWeight,
      fontSizeDots,
      letterSpacingDots: cellWidth - fontSizeDots * 0.6,
      scaleXRatio: 1
    }
  }

  const heightDots = pointsToDots(element.scaleY)
  const scaleXRatio =
    spec.kind === 'scalable' && element.scaleY > 0 ? element.scaleX / element.scaleY : 1

  return {
    fontFamily: spec.cssFamily,
    fontWeight: spec.cssWeight,
    fontSizeDots: heightDots,
    letterSpacingDots: 0,
    scaleXRatio
  }
}

export interface ExtentDots {
  widthDots: number
  heightDots: number
}

export function textExtentDots(element: TextElement): ExtentDots {
  const spec = getFontSpec(element.font, element.customFontFamily)
  const typography = textTypography(element)
  const characters = Math.max(element.text.length, 1)

  if (spec.kind === 'bitmap') {
    return {
      widthDots: spec.widthDots * element.scaleX * characters,
      heightDots: spec.heightDots * element.scaleY
    }
  }

  const referenceWidth = measureWidthAtReference(
    element.text || ' ',
    spec.cssFamily,
    spec.cssWeight
  )
  const widthDots =
    (referenceWidth / MEASURE_FONT_PX) * typography.fontSizeDots * typography.scaleXRatio

  return { widthDots, heightDots: typography.fontSizeDots }
}

export interface SizeMm {
  widthMm: number
  heightMm: number
}

/** Footprint before rotation, measured from the element's anchor. */
export function elementSizeMm(element: LabelElement): SizeMm {
  switch (element.type) {
    case 'text': {
      const extent = textExtentDots(element)
      return {
        widthMm: extent.widthDots / getDotsPerMm(),
        heightMm: extent.heightDots / getDotsPerMm()
      }
    }
    case 'line':
      return { widthMm: element.lengthMm, heightMm: element.thicknessMm }
    case 'image':
      return { widthMm: element.widthMm, heightMm: element.heightMm }
    case 'input':
      return {
        widthMm: element.widthMm || element.imageStyle.widthMm || 24,
        heightMm: element.heightMm || element.imageStyle.heightMm || 8
      }
    case 'group':
      return { widthMm: element.widthMm, heightMm: element.heightMm }
  }
}

export interface BoundsMm extends SizeMm {
  xMm: number
  yMm: number
}

/**
 * Where the rotated box lands relative to the anchor. Rotation is clockwise about the
 * anchor, matching both CSS `rotate()` with a 0 0 origin and a TSPL TEXT coordinate,
 * so a quarter turn moves the box off to one side rather than pivoting in place.
 */
function normalizeRotation(rotation: Rotation): number {
  return (((rotation % 360) + 360) % 360)
}

function rotatePoint(xMm: number, yMm: number, rotation: Rotation): { xMm: number; yMm: number } {
  const radians = (normalizeRotation(rotation) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    xMm: xMm * cos - yMm * sin,
    yMm: xMm * sin + yMm * cos
  }
}

/** Moves a point by a local (unrotated) offset, then turns that offset with the element. */
export function offsetByLocal(
  xMm: number,
  yMm: number,
  rotation: Rotation,
  dxMm: number,
  dyMm: number
): { xMm: number; yMm: number } {
  const shifted = rotatePoint(dxMm, dyMm, rotation)
  return {
    xMm: roundMm(xMm + shifted.xMm),
    yMm: roundMm(yMm + shifted.yMm)
  }
}

/** Axis-aligned box the element actually occupies on the label, rotation included. */
export function elementBoundsMm(element: LabelElement): BoundsMm {
  const size = elementSizeMm(element)
  const corners = [
    rotatePoint(0, 0, element.rotation),
    rotatePoint(size.widthMm, 0, element.rotation),
    rotatePoint(0, size.heightMm, element.rotation),
    rotatePoint(size.widthMm, size.heightMm, element.rotation)
  ]
  const minX = Math.min(...corners.map((corner) => corner.xMm))
  const maxX = Math.max(...corners.map((corner) => corner.xMm))
  const minY = Math.min(...corners.map((corner) => corner.yMm))
  const maxY = Math.max(...corners.map((corner) => corner.yMm))

  return {
    xMm: roundMm(element.xMm + minX),
    yMm: roundMm(element.yMm + minY),
    widthMm: roundMm(maxX - minX),
    heightMm: roundMm(maxY - minY)
  }
}

/** Anchor that puts the element's rotated box at the given top-left corner. */
export function anchorForBounds(
  element: LabelElement,
  xMm: number,
  yMm: number
): { xMm: number; yMm: number } {
  const bounds = elementBoundsMm(element)
  return {
    xMm: roundMm(element.xMm + (xMm - bounds.xMm)),
    yMm: roundMm(element.yMm + (yMm - bounds.yMm))
  }
}

/**
 * Rotating in the editor should feel like turning an object in place, so the anchor is
 * moved to keep the box centred where it was.
 */
export function rotationPatch(
  element: LabelElement,
  rotation: Rotation
): { rotation: Rotation; xMm: number; yMm: number } {
  const before = elementBoundsMm(element)
  const after = elementBoundsMm({ ...element, rotation } as LabelElement)

  const centreShiftX = before.xMm + before.widthMm / 2 - (after.xMm + after.widthMm / 2)
  const centreShiftY = before.yMm + before.heightMm / 2 - (after.yMm + after.heightMm / 2)

  return {
    rotation,
    xMm: roundMm(element.xMm + centreShiftX),
    yMm: roundMm(element.yMm + centreShiftY)
  }
}

export function nextRotation(rotation: Rotation): Rotation {
  return roundMm(normalizeRotation(rotation + 15), 0)
}

/** True when any part of the element falls outside the padded label area. */
export function overflowsLabel(
  element: LabelElement,
  labelWidthMm: number,
  labelHeightMm: number
): boolean {
  const bounds = elementBoundsMm(element)
  const slack = 0.05
  return (
    bounds.xMm < -slack ||
    bounds.yMm < -slack ||
    bounds.xMm + bounds.widthMm > labelWidthMm + slack ||
    bounds.yMm + bounds.heightMm > labelHeightMm + slack
  )
}

export function overflowsMedia(element: LabelElement, media: LabelMedia): boolean {
  const content = mediaContentRect(media)
  const bounds = elementBoundsMm(element)
  const slack = 0.05
  return (
    bounds.xMm < content.xMm - slack ||
    bounds.yMm < content.yMm - slack ||
    bounds.xMm + bounds.widthMm > content.xMm + content.widthMm + slack ||
    bounds.yMm + bounds.heightMm > content.yMm + content.heightMm + slack
  )
}

export function describeElement(element: LabelElement): string {
  const custom = element.layerName?.trim()
  if (custom) return custom
  switch (element.type) {
    case 'text':
      return element.text.trim() || '(empty text)'
    case 'line':
      return 'Line'
    case 'image':
      return element.name
    case 'input':
      return `Input: ${element.label || element.key}`
    case 'group':
      return 'Group'
  }
}
