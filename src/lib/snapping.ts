import { mediaContentRect } from './padding'
import { anchorForBounds, elementBoundsMm, type BoundsMm } from './preview'
import type { LabelElement, LabelMedia } from './types'
import { roundMm } from './units'

export type GuideAxis = 'x' | 'y'
export type GuideSource = 'label-edge' | 'label-centre' | 'element'

export interface Guide {
  axis: GuideAxis
  positionMm: number
  source: GuideSource
}

export interface SnapResult {
  xMm: number
  yMm: number
  guides: Guide[]
}

/** Left / centre / right, or top / middle / bottom, of a box. */
function edgesOf(bounds: BoundsMm, axis: GuideAxis): number[] {
  return axis === 'x'
    ? [bounds.xMm, bounds.xMm + bounds.widthMm / 2, bounds.xMm + bounds.widthMm]
    : [bounds.yMm, bounds.yMm + bounds.heightMm / 2, bounds.yMm + bounds.heightMm]
}

interface Candidate {
  positionMm: number
  source: GuideSource
}

function candidatesFor(
  axis: GuideAxis,
  media: LabelMedia,
  others: LabelElement[]
): Candidate[] {
  const content = mediaContentRect(media)
  const start = axis === 'x' ? content.xMm : content.yMm
  const span = axis === 'x' ? content.widthMm : content.heightMm
  const candidates: Candidate[] = [
    { positionMm: start, source: 'label-edge' },
    { positionMm: start + span / 2, source: 'label-centre' },
    { positionMm: start + span, source: 'label-edge' }
  ]

  for (const other of others) {
    for (const edge of edgesOf(elementBoundsMm(other), axis)) {
      candidates.push({ positionMm: edge, source: 'element' })
    }
  }

  return candidates
}

interface AxisSnap {
  deltaMm: number
  guides: Guide[]
}

/**
 * Picks the closest snap for one axis. Every edge of the moving box competes, and the
 * winning position is reported back as a guide so the canvas can draw it.
 */
function snapAxis(
  axis: GuideAxis,
  bounds: BoundsMm,
  media: LabelMedia,
  others: LabelElement[],
  toleranceMm: number
): AxisSnap {
  const moving = edgesOf(bounds, axis)
  const candidates = candidatesFor(axis, media, others)

  let best: { deltaMm: number; positionMm: number; source: GuideSource } | null = null

  for (const edge of moving) {
    for (const candidate of candidates) {
      const deltaMm = candidate.positionMm - edge
      if (Math.abs(deltaMm) > toleranceMm) continue
      if (best && Math.abs(deltaMm) >= Math.abs(best.deltaMm)) continue
      best = { deltaMm, positionMm: candidate.positionMm, source: candidate.source }
    }
  }

  if (!best) return { deltaMm: 0, guides: [] }
  return {
    deltaMm: best.deltaMm,
    guides: [{ axis, positionMm: best.positionMm, source: best.source }]
  }
}

/**
 * Nudges a dragged box onto the nearest label edge, label centre line, or neighbouring
 * element edge, and returns the guides that were hit so they can be shown.
 */
export function snapBounds(
  bounds: BoundsMm,
  media: LabelMedia,
  others: LabelElement[],
  toleranceMm: number
): SnapResult {
  const x = snapAxis('x', bounds, media, others, toleranceMm)
  const y = snapAxis('y', bounds, media, others, toleranceMm)

  return {
    xMm: roundMm(bounds.xMm + x.deltaMm),
    yMm: roundMm(bounds.yMm + y.deltaMm),
    guides: [...x.guides, ...y.guides]
  }
}

/**
 * Snaps a single coordinate, used while resizing when only one edge is moving.
 */
export function snapValue(
  valueMm: number,
  axis: GuideAxis,
  media: LabelMedia,
  others: LabelElement[],
  toleranceMm: number
): { valueMm: number; guide: Guide | null } {
  let best: Candidate | null = null

  for (const candidate of candidatesFor(axis, media, others)) {
    const deltaMm = Math.abs(candidate.positionMm - valueMm)
    if (deltaMm > toleranceMm) continue
    if (best && deltaMm >= Math.abs(best.positionMm - valueMm)) continue
    best = candidate
  }

  if (!best) return { valueMm, guide: null }
  return {
    valueMm: roundMm(best.positionMm),
    guide: { axis, positionMm: best.positionMm, source: best.source }
  }
}

export type Alignment = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom'
export type AlignScope = 'label' | 'text' | 'image'

/** Where a box's top-left must sit to align it against another rectangle. */
export function alignedPositionInRect(
  bounds: BoundsMm,
  rect: BoundsMm,
  alignment: Alignment
): { xMm: number; yMm: number } {
  switch (alignment) {
    case 'left':
      return { xMm: rect.xMm, yMm: bounds.yMm }
    case 'centre':
      return { xMm: roundMm(rect.xMm + (rect.widthMm - bounds.widthMm) / 2), yMm: bounds.yMm }
    case 'right':
      return { xMm: roundMm(rect.xMm + rect.widthMm - bounds.widthMm), yMm: bounds.yMm }
    case 'top':
      return { xMm: bounds.xMm, yMm: rect.yMm }
    case 'middle':
      return { xMm: bounds.xMm, yMm: roundMm(rect.yMm + (rect.heightMm - bounds.heightMm) / 2) }
    case 'bottom':
      return { xMm: bounds.xMm, yMm: roundMm(rect.yMm + rect.heightMm - bounds.heightMm) }
  }
}

/** Where a box's top-left must sit to align it against the label. */
export function alignedPosition(
  bounds: BoundsMm,
  media: LabelMedia,
  alignment: Alignment
): { xMm: number; yMm: number } {
  return alignedPositionInRect(bounds, mediaContentRect(media), alignment)
}

/**
 * Keeps a box on the label while dragging. Anything larger than the label is left where
 * it is rather than being forced to a corner.
 */
export function clampBoundsToLabel(
  xMm: number,
  yMm: number,
  bounds: BoundsMm,
  media: LabelMedia
): { xMm: number; yMm: number } {
  const content = mediaContentRect(media)
  const maxX = content.xMm + content.widthMm - bounds.widthMm
  const maxY = content.yMm + content.heightMm - bounds.heightMm
  return {
    xMm: maxX < content.xMm ? xMm : Math.min(Math.max(xMm, content.xMm), maxX),
    yMm: maxY < content.yMm ? yMm : Math.min(Math.max(yMm, content.yMm), maxY)
  }
}

/** Shifts an element on the label, keeping it in bounds and returning the new anchor. */
export function moveElementBy(
  element: LabelElement,
  dxMm: number,
  dyMm: number,
  media: LabelMedia
): { xMm: number; yMm: number } {
  const bounds = elementBoundsMm(element)
  const target = clampBoundsToLabel(bounds.xMm + dxMm, bounds.yMm + dyMm, bounds, media)
  return anchorForBounds(element, target.xMm, target.yMm)
}
