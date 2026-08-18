import { getFontSpec } from './fonts'
import { mediaContentRect, normalizePadding, ZERO_PADDING } from './padding'
import { anchorForBounds, elementBoundsMm, elementSizeMm, offsetByLocal, type BoundsMm } from './preview'
import { alignedPositionInRect, clampBoundsToLabel, type Alignment } from './snapping'
import type {
  BoxPadding,
  GroupAlign,
  GroupDirection,
  GroupElement,
  GroupJustify,
  LabelElement,
  LabelMedia
} from './types'
import { clamp, roundMm } from './units'

const JUSTIFY: GroupJustify[] = ['start', 'center', 'end', 'space-between']
const ALIGN: GroupAlign[] = ['start', 'center', 'end']

export function normalizeGroup(element: GroupElement): GroupElement {
  return {
    ...element,
    rotation: element.rotation ?? 0,
    widthMm: Math.max(Number(element.widthMm) || 8, 4),
    heightMm: Math.max(Number(element.heightMm) || 8, 4),
    padding: normalizePadding(element.padding),
    gapMm: Math.max(Number(element.gapMm) || 0, 0),
    direction: element.direction === 'column' ? 'column' : 'row',
    justify: JUSTIFY.includes(element.justify) ? element.justify : 'start',
    align: ALIGN.includes(element.align) ? element.align : 'start',
    freeform: Boolean(element.freeform),
    children: Array.isArray(element.children) ? element.children : []
  }
}

export function groupContentRect(group: GroupElement): BoundsMm {
  const pad = normalizePadding(group.padding)
  return {
    xMm: pad.leftMm,
    yMm: pad.topMm,
    widthMm: Math.max(group.widthMm - pad.leftMm - pad.rightMm, 0.01),
    heightMm: Math.max(group.heightMm - pad.topMm - pad.bottomMm, 0.01)
  }
}

/** Moves matching children inside the group box without changing the others. */
export function alignGroupChildren(
  group: GroupElement,
  alignment: Alignment,
  scope: 'text' | 'image'
): GroupElement {
  const next = normalizeGroup(group)
  const inner = groupContentRect(next)
  let changed = false
  const children = next.children.map((child) => {
    if (child.type === 'group') {
      const nested = alignGroupChildren(child, alignment, scope)
      if (nested !== child) changed = true
      return nested
    }
    const match =
      scope === 'text'
        ? child.type === 'text' || (child.type === 'input' && child.contentType === 'text')
        : child.type === 'image' || (child.type === 'input' && child.contentType === 'image')
    if (!match) return child
    changed = true
    const bounds = elementBoundsMm(child)
    const target = alignedPositionInRect(bounds, inner, alignment)
    return { ...child, ...anchorForBounds(child, target.xMm, target.yMm) } as LabelElement
  })
  if (!changed) return group
  return { ...next, freeform: true, children }
}

/**
 * Packs children like a CSS flex box: gap along the main axis, alignment on the cross
 * axis. The group grows if the children no longer fit, but it does not shrink. Optional
 * max bounds stop it growing off the label; leftover children are clipped by the box.
 */
export function layoutGroup(
  group: GroupElement,
  limits?: { maxWidthMm?: number; maxHeightMm?: number }
): GroupElement {
  const next = normalizeGroup(group)
  const pad = next.padding
  const children = next.children
  if (children.length === 0) return next
  if (next.freeform) {
    const boxes = children.map((child) => elementBoundsMm(child))
    const minX = Math.min(...boxes.map((box) => box.xMm))
    const minY = Math.min(...boxes.map((box) => box.yMm))
    const maxX = Math.max(...boxes.map((box) => box.xMm + box.widthMm))
    const maxY = Math.max(...boxes.map((box) => box.yMm + box.heightMm))
    const shiftX = minX - pad.leftMm
    const shiftY = minY - pad.topMm
    const shifted =
      shiftX === 0 && shiftY === 0
        ? children
        : children.map((child) => ({
            ...child,
            xMm: roundMm(child.xMm - shiftX),
            yMm: roundMm(child.yMm - shiftY)
          }))
    return {
      ...next,
      xMm: roundMm(next.xMm + shiftX),
      yMm: roundMm(next.yMm + shiftY),
      widthMm: roundMm(Math.max(maxX - minX + pad.leftMm + pad.rightMm, 4)),
      heightMm: roundMm(Math.max(maxY - minY + pad.topMm + pad.bottomMm, 4)),
      children: shifted
    }
  }

  const sizes = children.map((child) => elementSizeMm(child))
  const isRow = next.direction !== 'column'
  const gap = next.gapMm
  const count = children.length
  const mainSizes = sizes.map((size) => (isRow ? size.widthMm : size.heightMm))
  const crossSizes = sizes.map((size) => (isRow ? size.heightMm : size.widthMm))
  const mainTotal = mainSizes.reduce((sum, size) => sum + size, 0)
  const minMain = mainTotal + gap * Math.max(count - 1, 0)
  const minCross = Math.max(...crossSizes, 0)

  let widthMm = next.widthMm
  let heightMm = next.heightMm
  if (isRow) {
    widthMm = Math.max(widthMm, minMain + pad.leftMm + pad.rightMm)
    heightMm = Math.max(heightMm, minCross + pad.topMm + pad.bottomMm)
  } else {
    heightMm = Math.max(heightMm, minMain + pad.topMm + pad.bottomMm)
    widthMm = Math.max(widthMm, minCross + pad.leftMm + pad.rightMm)
  }
  if (limits?.maxWidthMm != null) widthMm = Math.min(widthMm, Math.max(limits.maxWidthMm, 1))
  if (limits?.maxHeightMm != null) heightMm = Math.min(heightMm, Math.max(limits.maxHeightMm, 1))

  const contentMain =
    (isRow ? widthMm : heightMm) - (isRow ? pad.leftMm + pad.rightMm : pad.topMm + pad.bottomMm)
  const contentCross =
    (isRow ? heightMm : widthMm) - (isRow ? pad.topMm + pad.bottomMm : pad.leftMm + pad.rightMm)
  const extra = contentMain - mainTotal - gap * Math.max(count - 1, 0)
  const between =
    next.justify === 'space-between' && count > 1
      ? Math.max(gap, (contentMain - mainTotal) / (count - 1))
      : gap

  let cursor = isRow ? pad.leftMm : pad.topMm
  if (next.justify === 'center') cursor += extra / 2
  if (next.justify === 'end') cursor += extra

  const placed = children.map((child, index) => {
    const crossSize = crossSizes[index]
    let cross = isRow ? pad.topMm : pad.leftMm
    if (next.align === 'center') cross += (contentCross - crossSize) / 2
    if (next.align === 'end') cross += contentCross - crossSize
    const xMm = roundMm(isRow ? cursor : cross)
    const yMm = roundMm(isRow ? cross : cursor)
    cursor += mainSizes[index] + (index < count - 1 ? between : 0)
    return { ...child, xMm, yMm } as LabelElement
  })

  return { ...next, widthMm: roundMm(widthMm), heightMm: roundMm(heightMm), children: placed }
}

function inferDirection(elements: LabelElement[]): GroupDirection {
  if (elements.length < 2) return 'row'
  const bounds = elements.map((element) => elementBoundsMm(element))
  const minX = Math.min(...bounds.map((box) => box.xMm))
  const maxX = Math.max(...bounds.map((box) => box.xMm + box.widthMm))
  const minY = Math.min(...bounds.map((box) => box.yMm))
  const maxY = Math.max(...bounds.map((box) => box.yMm + box.heightMm))
  return maxX - minX >= maxY - minY ? 'row' : 'column'
}

/** Wraps sibling items in `elements` (one list, not a nested search) into a freeform group. */
export function wrapSiblingsAsGroup(
  elements: LabelElement[],
  ids: string[],
  newId: string
): { elements: LabelElement[]; groupId: string } | null {
  const unique = [...new Set(ids)]
  if (unique.length < 2) return null
  const selected = elements.filter((element) => unique.includes(element.id))
  if (selected.length !== unique.length) return null

  const boxes = selected.map((element) => elementBoundsMm(element))
  const xMm = Math.min(...boxes.map((box) => box.xMm))
  const yMm = Math.min(...boxes.map((box) => box.yMm))
  const widthMm = Math.max(...boxes.map((box) => box.xMm + box.widthMm)) - xMm
  const heightMm = Math.max(...boxes.map((box) => box.yMm + box.heightMm)) - yMm

  const children = selected.map((element) => ({
    ...element,
    xMm: roundMm(element.xMm - xMm),
    yMm: roundMm(element.yMm - yMm)
  }))

  const group = layoutGroup({
    id: newId,
    type: 'group',
    xMm: roundMm(xMm),
    yMm: roundMm(yMm),
    rotation: 0,
    widthMm: roundMm(Math.max(widthMm, 4)),
    heightMm: roundMm(Math.max(heightMm, 4)),
    padding: { ...ZERO_PADDING },
    gapMm: 0,
    direction: inferDirection(selected),
    justify: 'start',
    align: 'start',
    freeform: true,
    children
  })

  const rest = elements.filter((element) => !unique.includes(element.id))
  const insertAt = Math.max(...unique.map((id) => elements.findIndex((element) => element.id === id)))
  const next = [...rest]
  const index = Math.min(Math.max(insertAt - (unique.length - 1), 0), next.length)
  next.splice(index, 0, group)
  return { elements: next, groupId: group.id }
}

export function ungroupById(elements: LabelElement[], id: string): LabelElement[] {
  return elements.flatMap((element) => {
    if (element.id === id && element.type === 'group') {
      return element.children.map((child) => {
        const origin = offsetByLocal(element.xMm, element.yMm, element.rotation, child.xMm, child.yMm)
        return {
          ...child,
          ...origin,
          rotation: element.rotation + child.rotation
        } as LabelElement
      })
    }
    if (element.type === 'group') {
      return [{ ...element, children: ungroupById(element.children, id) }]
    }
    return [element]
  })
}

const FIT_SLACK_MM = 0.05
const MIN_SCALE = 0.12

function scalePadding(padding: BoxPadding, factor: number): BoxPadding {
  return {
    topMm: roundMm(padding.topMm * factor),
    rightMm: roundMm(padding.rightMm * factor),
    bottomMm: roundMm(padding.bottomMm * factor),
    leftMm: roundMm(padding.leftMm * factor)
  }
}

function scaleTextAxes(element: Extract<LabelElement, { type: 'text' }>, factor: number) {
  const bitmap = getFontSpec(element.font, element.customFontFamily).kind === 'bitmap'
  if (bitmap) {
    return {
      scaleX: clamp(Math.max(1, Math.round(element.scaleX * factor)), 1, 10),
      scaleY: clamp(Math.max(1, Math.round(element.scaleY * factor)), 1, 10)
    }
  }
  return {
    scaleX: roundMm(clamp(element.scaleX * factor, 0.5, 300), 1),
    scaleY: roundMm(clamp(element.scaleY * factor, 0.5, 300), 1)
  }
}

/** Shrinks an element uniformly so a group can stay on the label. */
export function scaleElement(element: LabelElement, factor: number): LabelElement {
  const f = clamp(factor, MIN_SCALE, 1)
  if (f >= 0.999) return element

  switch (element.type) {
    case 'text':
      return { ...element, ...scaleTextAxes(element, f) }
    case 'line':
      return {
        ...element,
        lengthMm: roundMm(Math.max(element.lengthMm * f, 0.5)),
        thicknessMm: roundMm(Math.max(element.thicknessMm * f, 0.2))
      }
    case 'image':
      return {
        ...element,
        widthMm: roundMm(Math.max(element.widthMm * f, 1)),
        heightMm: roundMm(Math.max(element.heightMm * f, 1))
      }
    case 'input':
      return {
        ...element,
        widthMm: roundMm(Math.max(element.widthMm * f, 2)),
        heightMm: roundMm(Math.max(element.heightMm * f, 2)),
        textStyle: {
          ...element.textStyle,
          ...scaleTextAxes(
            {
              id: element.id,
              type: 'text',
              xMm: 0,
              yMm: 0,
              rotation: 0,
              text: ' ',
              ...element.textStyle
            },
            f
          )
        }
      }
    case 'group':
      return {
        ...element,
        widthMm: roundMm(Math.max(element.widthMm * f, 2)),
        heightMm: roundMm(Math.max(element.heightMm * f, 2)),
        gapMm: roundMm(element.gapMm * f),
        padding: scalePadding(element.padding, f),
        children: element.children.map((child) => scaleElement(child, f))
      }
  }
}

function fitsIn(widthMm: number, heightMm: number, maxWidthMm: number, maxHeightMm: number): boolean {
  return widthMm <= maxWidthMm + FIT_SLACK_MM && heightMm <= maxHeightMm + FIT_SLACK_MM
}

function fitGroupToMax(group: GroupElement, maxWidthMm: number, maxHeightMm: number): GroupElement {
  const nested = {
    ...group,
    children: group.children.map((child) =>
      child.type === 'group' ? fitGroupToMax(child, maxWidthMm, maxHeightMm) : child
    )
  }
  let laid = layoutGroup(nested)
  if (group.freeform) return laid
  if (fitsIn(laid.widthMm, laid.heightMm, maxWidthMm, maxHeightMm)) return laid

  if (laid.gapMm > 0 && laid.children.length > 1) {
    const tight = layoutGroup({ ...laid, gapMm: 0 })
    if (fitsIn(tight.widthMm, tight.heightMm, maxWidthMm, maxHeightMm)) {
      const leftover =
        laid.direction === 'column' ? maxHeightMm - tight.heightMm : maxWidthMm - tight.widthMm
      const gapMm = roundMm(clamp(leftover / (laid.children.length - 1), 0, laid.gapMm))
      return layoutGroup({ ...laid, gapMm }, { maxWidthMm, maxHeightMm })
    }
    laid = tight
  }

  const factor = Math.min(
    1,
    maxWidthMm / Math.max(laid.widthMm, 0.01),
    maxHeightMm / Math.max(laid.heightMm, 0.01)
  )
  if (factor < 0.999) {
    laid = layoutGroup(scaleElement(laid, factor) as GroupElement)
  }

  return layoutGroup(laid, { maxWidthMm, maxHeightMm })
}

function clampElementOnMedia(element: LabelElement, media: LabelMedia): LabelElement {
  const bounds = elementBoundsMm(element)
  const target = clampBoundsToLabel(bounds.xMm, bounds.yMm, bounds, media)
  if (target.xMm === bounds.xMm && target.yMm === bounds.yMm) return element
  return { ...element, ...anchorForBounds(element, target.xMm, target.yMm) }
}

/**
 * Keeps every top-level element inside the padded label. Oversized groups shrink their
 * children (gap first, then scale) rather than running off the edge.
 */
export function constrainElementsToMedia(elements: LabelElement[], media: LabelMedia): LabelElement[] {
  const content = mediaContentRect(media)
  const maxWidthMm = Math.max(content.widthMm, 1)
  const maxHeightMm = Math.max(content.heightMm, 1)
  let changed = false

  const next = elements.map((element) => {
    let fitted = element
    if (element.type === 'group') {
      fitted = fitGroupToMax(element, maxWidthMm, maxHeightMm)
    } else {
      const size = elementBoundsMm(element)
      if (!fitsIn(size.widthMm, size.heightMm, maxWidthMm, maxHeightMm)) {
        const factor = Math.min(
          1,
          maxWidthMm / Math.max(size.widthMm, 0.01),
          maxHeightMm / Math.max(size.heightMm, 0.01)
        )
        fitted = scaleElement(element, factor)
      }
    }

    const onLabel = clampElementOnMedia(fitted, media)
    if (JSON.stringify(onLabel) === JSON.stringify(element)) return element
    changed = true
    return onLabel
  })

  return changed ? next : elements
}
