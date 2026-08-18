import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { inputBoxSize, layoutInputContent, resolveElements } from '../lib/fields'
import { textSizePt, withTextSize } from '../lib/fontSize'
import type { MonoBitmap } from '../lib/imageMono'
import { isContinuous } from '../lib/media'
import { mediaContentRect, mediaPadding } from '../lib/padding'
import {
  anchorForBounds,
  elementBoundsMm,
  elementSizeMm,
  overflowsMedia,
  rotationPatch,
  textExtentDots,
  textTypography,
  type BoundsMm
} from '../lib/preview'
import {
  clampBoundsToLabel,
  snapBounds,
  type Alignment,
  type AlignScope,
  type Guide
} from '../lib/snapping'
import type {
  ElementPatch,
  FieldValues,
  FontLibraryItem,
  GroupElement,
  ImageElement,
  InputElement,
  LabelElement,
  LabelMedia,
  LineElement,
  Rotation,
  TextAlign,
  TextElement,
  TextStyle,
  VerticalAlign
} from '../lib/types'
import { absoluteOf, findElement, moveRootOf } from '../lib/tree'
import { clamp, getBasePxPerMm, getDotsPerMm, roundMm } from '../lib/units'
import Ruler from './Ruler'
import SelectionToolbar from './SelectionToolbar'

export type CanvasMode = 'select' | 'line'

/** A line drawn on the canvas, described by the box the pointer swept out. */
export interface NewLine {
  xMm: number
  yMm: number
  lengthMm: number
  rotation: Rotation
}

interface LabelCanvasProps {
  media: LabelMedia
  elements: LabelElement[]
  fieldValues: FieldValues
  selectedId: string | null
  selectedIds?: string[]
  zoom: number
  mode: CanvasMode
  bitmaps: Map<string, MonoBitmap>
  /** Print-page preview: no rulers, handles, or editing. */
  readOnly?: boolean
  onSelect: (id: string | null, additive?: boolean) => void
  onSelectIds?: (ids: string[]) => void
  onChange: (id: string, patch: ElementPatch) => void
  onPatchTextStyles?: (mutate: (style: TextStyle) => TextStyle) => void
  onPatchInputAlign?: (patch: { textAlign?: TextAlign; verticalAlign?: VerticalAlign }) => void
  fontLibrary?: FontLibraryItem[]
  onGestureStart?: () => void
  onGestureEnd?: () => void
  onCreateLine: (line: NewLine) => void
  onDropImage: (file: File, xMm: number, yMm: number) => void
  onAlign: (id: string, alignment: Alignment, scope?: AlignScope) => void
  onRotate: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onLayer: (id: string, position: 'front' | 'back') => void
  onGroup?: () => void
  onUngroup?: () => void
  canGroup?: boolean
}

type ResizeHandle = 'corner' | 'line' | 'tl' | 'tr' | 'bl' | 'br'

type Interaction =
  | {
      kind: 'move'
      pointerId: number
      snapshot: LabelElement
      clientX: number
      clientY: number
      moved: boolean
    }
  | {
      kind: 'resize'
      pointerId: number
      snapshot: LabelElement
      clientX: number
      clientY: number
      handle: ResizeHandle
    }
  | {
      kind: 'rotate'
      pointerId: number
      snapshot: LabelElement
      centreX: number
      centreY: number
      angleOffset: number
    }

interface Draft {
  pointerId: number
  startXMm: number
  startYMm: number
  endXMm: number
  endYMm: number
}

interface Marquee {
  pointerId: number
  startXMm: number
  startYMm: number
  endXMm: number
  endYMm: number
  additive: boolean
  baseIds: string[]
  moved: boolean
}

const CLICK_SLOP_PX = 3

/** Snapping strength in screen pixels, converted to millimetres at the current zoom. */
const SNAP_PX = 6

function draftToLine(draft: Draft): NewLine {
  const deltaX = draft.endXMm - draft.startXMm
  const deltaY = draft.endYMm - draft.startYMm

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return {
      rotation: 0,
      xMm: roundMm(Math.min(draft.startXMm, draft.endXMm)),
      yMm: roundMm(draft.startYMm),
      lengthMm: roundMm(Math.abs(deltaX))
    }
  }

  return {
    rotation: 90,
    xMm: roundMm(draft.startXMm),
    yMm: roundMm(Math.min(draft.startYMm, draft.endYMm)),
    lengthMm: roundMm(Math.abs(deltaY))
  }
}

/** Turns a screen-space drag into the element's own axes, so handles follow rotation. */
function toLocalDelta(
  dxMm: number,
  dyMm: number,
  rotation: Rotation
): { dxMm: number; dyMm: number } {
  const radians = (rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    dxMm: dxMm * cos + dyMm * sin,
    dyMm: -dxMm * sin + dyMm * cos
  }
}

function toWorldDelta(
  dxMm: number,
  dyMm: number,
  rotation: Rotation
): { dxMm: number; dyMm: number } {
  const radians = (rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    dxMm: dxMm * cos - dyMm * sin,
    dyMm: dxMm * sin + dyMm * cos
  }
}

function pointerAngle(centreX: number, centreY: number, clientX: number, clientY: number): number {
  return (((Math.atan2(clientY - centreY, clientX - centreX) * 180) / Math.PI) + 360) % 360
}

function marqueeBounds(marquee: Marquee): BoundsMm {
  return {
    xMm: Math.min(marquee.startXMm, marquee.endXMm),
    yMm: Math.min(marquee.startYMm, marquee.endYMm),
    widthMm: Math.abs(marquee.endXMm - marquee.startXMm),
    heightMm: Math.abs(marquee.endYMm - marquee.startYMm)
  }
}

function rectsOverlap(a: BoundsMm, b: BoundsMm): boolean {
  return (
    a.xMm < b.xMm + b.widthMm &&
    a.xMm + a.widthMm > b.xMm &&
    a.yMm < b.yMm + b.heightMm &&
    a.yMm + a.heightMm > b.yMm
  )
}

export default function LabelCanvas({
  media,
  elements,
  fieldValues,
  selectedId,
  selectedIds = [],
  zoom,
  mode,
  bitmaps,
  readOnly = false,
  onSelect,
  onSelectIds,
  onChange,
  onPatchTextStyles,
  onPatchInputAlign,
  fontLibrary = [],
  onGestureStart,
  onGestureEnd,
  onCreateLine,
  onDropImage,
  onAlign,
  onRotate,
  onDuplicate,
  onDelete,
  onLayer,
  onGroup,
  onUngroup,
  canGroup = false
}: LabelCanvasProps) {
  const interaction = useRef<Interaction | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const editingInputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editSnapshot, setEditSnapshot] = useState('')
  const [dropping, setDropping] = useState(false)

  const pxPerMm = getBasePxPerMm() * zoom
  const pxPerDot = pxPerMm / getDotsPerMm()
  const snapToleranceMm = SNAP_PX / pxPerMm

  useEffect(() => {
    if (editingId && editingId !== selectedId) {
      setEditingId(null)
      onGestureEnd?.()
    }
  }, [editingId, selectedId, onGestureEnd])

  useLayoutEffect(() => {
    if (!editingId) return
    const input = editingInputRef.current
    if (!input) return

    // Focusing the inline editor should not yank the scroller to the top of the workspace.
    input.focus({ preventScroll: true })
  }, [editingId])

  /** What the element will actually print: placeholders swapped for field values. */
  function shown(element: LabelElement): LabelElement {
    if (element.type === 'input' || element.type === 'group') return element
    if (element.type === 'text' && editingId === element.id) return element
    return resolveElements([element], fieldValues)[0] ?? element
  }

  function othersOf(id: string): LabelElement[] {
    return elements.filter((element) => element.id !== id).map(shown)
  }

  function toLabelMm(clientX: number, clientY: number): { xMm: number; yMm: number } {
    const rect = sheetRef.current?.getBoundingClientRect()
    if (!rect) return { xMm: 0, yMm: 0 }
    return {
      xMm: clamp((clientX - rect.left) / pxPerMm, 0, media.widthMm),
      yMm: clamp((clientY - rect.top) / pxPerMm, 0, media.heightMm)
    }
  }

  function beginMove(event: ReactPointerEvent<HTMLElement>, element: LabelElement) {
    if (readOnly || mode === 'line') return
    event.stopPropagation()
    const additive = event.shiftKey || event.ctrlKey || event.metaKey
    onSelect(element.id, additive)
    if (additive || editingId === element.id) return

    const target = moveRootOf(elements, element.id) ?? element
    event.currentTarget.setPointerCapture(event.pointerId)
    onGestureStart?.()
    interaction.current = {
      kind: 'move',
      pointerId: event.pointerId,
      snapshot: shown(target),
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false
    }
  }

  function beginResize(
    event: ReactPointerEvent<HTMLElement>,
    element: LabelElement,
    handle: ResizeHandle = 'corner'
  ) {
    event.stopPropagation()
    onSelect(element.id)
    event.currentTarget.setPointerCapture(event.pointerId)
    onGestureStart?.()
    interaction.current = {
      kind: 'resize',
      pointerId: event.pointerId,
      snapshot: shown(element),
      clientX: event.clientX,
      clientY: event.clientY,
      handle
    }
  }

  function beginRotate(event: ReactPointerEvent<HTMLElement>, element: LabelElement) {
    event.stopPropagation()
    onSelect(element.id)
    event.currentTarget.setPointerCapture(event.pointerId)
    onGestureStart?.()

    const bounds = elementBoundsMm(shown(element))
    const centreX = (bounds.xMm + bounds.widthMm / 2) * pxPerMm
    const centreY = (bounds.yMm + bounds.heightMm / 2) * pxPerMm
    interaction.current = {
      kind: 'rotate',
      pointerId: event.pointerId,
      snapshot: shown(element),
      centreX,
      centreY,
      angleOffset: shown(element).rotation - pointerAngle(centreX, centreY, event.clientX, event.clientY)
    }
  }

  function applyMove(active: Extract<Interaction, { kind: 'move' }>, event: ReactPointerEvent) {
    const dxMm = (event.clientX - active.clientX) / pxPerMm
    const dyMm = (event.clientY - active.clientY) / pxPerMm

    if (
      !active.moved &&
      Math.hypot(event.clientX - active.clientX, event.clientY - active.clientY) > CLICK_SLOP_PX
    ) {
      active.moved = true
    }
    if (!active.moved) return

    const bounds = elementBoundsMm(active.snapshot)
    const snapped = snapBounds(
      { ...bounds, xMm: bounds.xMm + dxMm, yMm: bounds.yMm + dyMm },
      media,
      othersOf(active.snapshot.id),
      snapToleranceMm
    )
    const inside = clampBoundsToLabel(snapped.xMm, snapped.yMm, bounds, media)
    const anchor = anchorForBounds(active.snapshot, inside.xMm, inside.yMm)

    setGuides(snapped.guides)
    onChange(active.snapshot.id, anchor)
  }

  function applyResize(active: Extract<Interaction, { kind: 'resize' }>, event: ReactPointerEvent) {
    const { snapshot } = active
    const local = toLocalDelta(
      (event.clientX - active.clientX) / pxPerMm,
      (event.clientY - active.clientY) / pxPerMm,
      snapshot.rotation
    )

    if (snapshot.type === 'line') {
      const point = toLabelMm(event.clientX, event.clientY)
      const deltaX = point.xMm - snapshot.xMm
      const deltaY = point.yMm - snapshot.yMm
      const lengthMm = clamp(roundMm(Math.hypot(deltaX, deltaY)), 0.5, 400)
      const rotation = roundMm((((Math.atan2(deltaY, deltaX) * 180) / Math.PI) + 360) % 360, 0)

      setGuides([])
      onChange(snapshot.id, { lengthMm, rotation })
      return
    }

    if (snapshot.type === 'input' || snapshot.type === 'group') {
      const box =
        snapshot.type === 'group'
          ? { widthMm: snapshot.widthMm, heightMm: snapshot.heightMm }
          : inputBoxSize(snapshot)
      const point = toLabelMm(event.clientX, event.clientY)
      const pointerLocal = toLocalDelta(
        point.xMm - snapshot.xMm,
        point.yMm - snapshot.yMm,
        snapshot.rotation
      )
      const opposite =
        active.handle === 'tl'
          ? { xMm: box.widthMm, yMm: box.heightMm }
          : active.handle === 'tr'
            ? { xMm: 0, yMm: box.heightMm }
            : active.handle === 'bl'
              ? { xMm: box.widthMm, yMm: 0 }
              : { xMm: 0, yMm: 0 }
      const widthMm = clamp(roundMm(Math.abs(pointerLocal.dxMm - opposite.xMm)), 2, 300)
      const heightMm = clamp(roundMm(Math.abs(pointerLocal.dyMm - opposite.yMm)), 2, 300)
      const originLocal =
        active.handle === 'tl'
          ? { xMm: opposite.xMm - widthMm, yMm: opposite.yMm - heightMm }
          : active.handle === 'tr'
            ? { xMm: opposite.xMm, yMm: opposite.yMm - heightMm }
            : active.handle === 'bl'
              ? { xMm: opposite.xMm - widthMm, yMm: opposite.yMm }
              : { xMm: opposite.xMm, yMm: opposite.yMm }
      const anchorShift = toWorldDelta(originLocal.xMm, originLocal.yMm, snapshot.rotation)
      onChange(snapshot.id, {
        xMm: roundMm(snapshot.xMm + anchorShift.dxMm),
        yMm: roundMm(snapshot.yMm + anchorShift.dyMm),
        widthMm,
        heightMm
      })
      return
    }

    if (snapshot.type === 'image') {
      const aspectRatio = snapshot.aspectRatio || 1
      const point = toLabelMm(event.clientX, event.clientY)
      const pointerLocal = toLocalDelta(
        point.xMm - snapshot.xMm,
        point.yMm - snapshot.yMm,
        snapshot.rotation
      )
      const opposite =
        active.handle === 'tl'
          ? { xMm: snapshot.widthMm, yMm: snapshot.heightMm }
          : active.handle === 'tr'
            ? { xMm: 0, yMm: snapshot.heightMm }
            : active.handle === 'bl'
              ? { xMm: snapshot.widthMm, yMm: 0 }
              : { xMm: 0, yMm: 0 }
      const widthScale = Math.abs(pointerLocal.dxMm - opposite.xMm) / Math.max(snapshot.widthMm, 0.001)
      const heightScale =
        Math.abs(pointerLocal.dyMm - opposite.yMm) / Math.max(snapshot.heightMm, 0.001)
      const scale = clamp(Math.max(widthScale, heightScale), 2 / Math.max(snapshot.widthMm, 0.001), 100)
      const widthMm = clamp(roundMm(snapshot.widthMm * scale), 2, 300)
      const heightMm = roundMm(widthMm / aspectRatio)
      const originLocal =
        active.handle === 'tl'
          ? { xMm: opposite.xMm - widthMm, yMm: opposite.yMm - heightMm }
          : active.handle === 'tr'
            ? { xMm: opposite.xMm, yMm: opposite.yMm - heightMm }
            : active.handle === 'bl'
              ? { xMm: opposite.xMm - widthMm, yMm: opposite.yMm }
              : { xMm: opposite.xMm, yMm: opposite.yMm }
      const anchorShift = toWorldDelta(originLocal.xMm, originLocal.yMm, snapshot.rotation)
      onChange(snapshot.id, {
        xMm: roundMm(snapshot.xMm + anchorShift.dxMm),
        yMm: roundMm(snapshot.yMm + anchorShift.dyMm),
        widthMm,
        heightMm
      })
      return
    }

    if (snapshot.type !== 'text') return
    const size = elementSizeMm(snapshot)
    const ratioWidth = size.widthMm > 0 ? (size.widthMm + local.dxMm) / size.widthMm : 1
    const ratioHeight = size.heightMm > 0 ? (size.heightMm + local.dyMm) / size.heightMm : 1
    const ratio = clamp(
      Math.abs(local.dxMm) > Math.abs(local.dyMm) ? ratioWidth : ratioHeight,
      0.1,
      12
    )
    const next = withTextSize(snapshot, textSizePt(snapshot) * ratio)
    onChange(snapshot.id, { scaleX: next.scaleX, scaleY: next.scaleY })
  }

  function applyRotate(active: Extract<Interaction, { kind: 'rotate' }>, event: ReactPointerEvent) {
    const rotation = roundMm(
      (pointerAngle(active.centreX, active.centreY, event.clientX, event.clientY) + active.angleOffset + 360) % 360,
      1
    )
    if (rotation === active.snapshot.rotation) return

    setGuides([])
    onChange(active.snapshot.id, rotationPatch(active.snapshot, rotation))
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const active = interaction.current
    if (!active || active.pointerId !== event.pointerId) return

    if (active.kind === 'move') {
      applyMove(active, event)
      return
    }
    if (active.kind === 'resize') {
      applyResize(active, event)
      return
    }
    applyRotate(active, event)
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLElement>) {
    const active = interaction.current
    if (!active || active.pointerId !== event.pointerId) return

    event.currentTarget.releasePointerCapture(event.pointerId)
    interaction.current = null
    setGuides([])

    // A press that never really moved is a click, which opens text for editing.
    if (active.kind === 'move' && !active.moved && active.snapshot.type === 'text') {
      const element = findElement(elements, active.snapshot.id)
      if (element?.type === 'text') {
        setEditSnapshot(element.text)
        setEditingId(element.id)
        return
      }
    }
    onGestureEnd?.()
  }

  function idsInMarquee(box: BoundsMm): string[] {
    return elements
      .filter((element) => rectsOverlap(elementBoundsMm(shown(element)), box))
      .map((element) => element.id)
  }

  function applyMarqueeSelection(next: Marquee) {
    const box = marqueeBounds(next)
    if (box.widthMm < 0.2 && box.heightMm < 0.2) return
    const hits = idsInMarquee(box)
    const ids = next.additive ? [...new Set([...next.baseIds, ...hits])] : hits
    onSelectIds?.(ids)
  }

  function handleSheetPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (readOnly) return
    if (mode === 'line') {
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      const start = toLabelMm(event.clientX, event.clientY)
      setDraft({
        pointerId: event.pointerId,
        startXMm: start.xMm,
        startYMm: start.yMm,
        endXMm: start.xMm,
        endYMm: start.yMm
      })
      return
    }

    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const start = toLabelMm(event.clientX, event.clientY)
    setEditingId(null)
    setMarquee({
      pointerId: event.pointerId,
      startXMm: start.xMm,
      startYMm: start.yMm,
      endXMm: start.xMm,
      endYMm: start.yMm,
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
      baseIds: selectedIds,
      moved: false
    })
  }

  function handleSheetPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (marquee && marquee.pointerId === event.pointerId) {
      const point = toLabelMm(event.clientX, event.clientY)
      const next: Marquee = {
        ...marquee,
        endXMm: point.xMm,
        endYMm: point.yMm,
        moved:
          marquee.moved ||
          Math.hypot(point.xMm - marquee.startXMm, point.yMm - marquee.startYMm) * pxPerMm >
            CLICK_SLOP_PX
      }
      setMarquee(next)
      if (next.moved) applyMarqueeSelection(next)
      return
    }

    if (!draft || draft.pointerId !== event.pointerId) return
    const point = toLabelMm(event.clientX, event.clientY)
    setDraft({ ...draft, endXMm: point.xMm, endYMm: point.yMm })
  }

  function handleSheetPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (marquee && marquee.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId)
      const next = { ...marquee }
      setMarquee(null)
      if (!next.moved) {
        if (!next.additive) onSelect(null)
        return
      }
      applyMarqueeSelection(next)
      return
    }

    if (!draft || draft.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture(event.pointerId)

    const line = draftToLine(draft)
    setDraft(null)
    if (line.lengthMm >= 0.5) onCreateLine(line)
  }

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (readOnly || !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDropping(true)
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (readOnly) return
    event.preventDefault()
    setDropping(false)

    const file = [...event.dataTransfer.files].find((item) => item.type.startsWith('image/'))
    if (!file) return

    const point = toLabelMm(event.clientX, event.clientY)
    onDropImage(file, roundMm(point.xMm), roundMm(point.yMm))
  }

  function positionStyle(element: LabelElement, size: { widthMm: number; heightMm: number }) {
    const style: CSSProperties = {
      left: `${element.xMm * pxPerMm}px`,
      top: `${element.yMm * pxPerMm}px`,
      width: `${Math.max(size.widthMm * pxPerMm, 1)}px`,
      height: `${Math.max(size.heightMm * pxPerMm, 1)}px`
    }
    if (element.rotation !== 0) {
      // Origin 0 0 keeps the preview's pivot the same as the printer's.
      style.transform = `rotate(${element.rotation}deg)`
      style.transformOrigin = '0 0'
    }
    return style
  }

  function textBoxStyle(element: TextElement): CSSProperties {
    const typography = textTypography(element)
    const extent = textExtentDots(element)
    const transforms: string[] = []
    if (element.rotation !== 0) transforms.push(`rotate(${element.rotation}deg)`)
    if (typography.scaleXRatio !== 1) transforms.push(`scaleX(${typography.scaleXRatio})`)

    return {
      left: `${element.xMm * pxPerMm}px`,
      top: `${element.yMm * pxPerMm}px`,
      width: `${extent.widthDots * pxPerDot}px`,
      height: `${extent.heightDots * pxPerDot}px`,
      fontFamily: typography.fontFamily,
      fontWeight: typography.fontWeight,
      fontSize: `${typography.fontSizeDots * pxPerDot}px`,
      lineHeight: `${extent.heightDots * pxPerDot}px`,
      letterSpacing: `${typography.letterSpacingDots * pxPerDot}px`,
      transform: transforms.length > 0 ? transforms.join(' ') : undefined,
      transformOrigin: '0 0'
    }
  }

  function renderHandles(element: LabelElement, kind: 'corner' | 'line') {
    if (readOnly || element.id !== selectedId) return null
    return (
      <span
        className={`handle handle-${kind}`}
        title={kind === 'line' ? 'Drag to change length' : 'Drag to resize'}
        onPointerDown={(event) => beginResize(event, element, kind)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    )
  }

  function renderRotateHandle(element: LabelElement) {
    if (readOnly || element.id !== selectedId) return null
    return (
      <span
        className="handle handle-rotate"
        title="Drag to rotate"
        onPointerDown={(event) => beginRotate(event, element)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    )
  }

  function renderImageRotateHandle(element: ImageElement) {
    if (readOnly || element.id !== selectedId) return null
    return (
      <span
        className="handle handle-image-rotate"
        title="Drag to rotate"
        onPointerDown={(event) => beginRotate(event, element)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    )
  }

  function renderImageResizeHandles(element: ImageElement) {
    if (readOnly || element.id !== selectedId) return null
    return ['tl', 'tr', 'bl', 'br'].map((corner) => (
      <span
        key={corner}
        className={`handle handle-image-corner handle-image-corner-${corner}`}
        title="Drag to resize"
        onPointerDown={(event) => beginResize(event, element, corner as ResizeHandle)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    ))
  }

  function renderInput(source: InputElement) {
    const box = inputBoxSize(source)
    const layout = layoutInputContent(source, fieldValues)
    const bitmap = bitmaps.get(source.id)

    return (
      <div
        key={source.id}
        className={itemClass(source, source)}
        style={positionStyle(source, box)}
        title={readOnly ? undefined : 'Click to select, drag to move, drag a corner to resize the box'}
        onPointerDown={(event) => beginMove(event, source)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {layout.kind === 'image' ? (
          bitmap && layout.element.sourceDataUrl ? (
            <img
              className="label-image input-slot-content"
              src={bitmap.previewUrl}
              alt={layout.element.name}
              draggable={false}
              style={{
                left: 0,
                top: 0,
                width: '100%',
                height: '100%'
              }}
            />
          ) : (
            <span className="label-image-pending">
              {layout.element.sourceDataUrl ? 'converting...' : source.label}
            </span>
          )
        ) : (
          layout.lines.map((line, index) => (
            <span
              key={`${source.id}-line-${index}`}
              className="input-slot-text"
              style={{
                ...textBoxStyle({
                  ...layout.element,
                  text: line.text === '' ? ' ' : line.text,
                  xMm: 0,
                  yMm: 0,
                  rotation: 0
                }),
                left: `${line.offsetXMm * pxPerMm}px`,
                top: `${line.offsetYMm * pxPerMm}px`,
                position: 'absolute',
                width: line.text === '' ? 0 : undefined
              }}
            >
              {line.text === '' ? '\u00a0' : line.text}
            </span>
          ))
        )}
        {renderImageRotateHandle(source as unknown as ImageElement)}
        {renderImageResizeHandles(source as unknown as ImageElement)}
      </div>
    )
  }

  function renderText(source: TextElement) {
    const element = shown(source) as TextElement
    const style = textBoxStyle(element)

    if (editingId === source.id) {
      return (
        <input
          ref={editingInputRef}
          key={source.id}
          className="label-text is-editing"
          style={{
            ...style,
            // Extra room so the caret stays visible while typing at the end.
            width: `calc(${style.width} + 1.2em)`
          }}
          value={source.text}
          spellCheck={false}
          // Typing on the canvas is usually a fix to part of the wording, so keep the caret
          // where it was clicked instead of selecting the whole line.
          data-select-all="false"
          onChange={(event) => onChange(source.id, { text: event.target.value })}
          onPointerDown={(event) => event.stopPropagation()}
          onBlur={() => {
            setEditingId(null)
            onGestureEnd?.()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              setEditingId(null)
              onGestureEnd?.()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onChange(source.id, { text: editSnapshot })
              setEditingId(null)
              onGestureEnd?.()
            }
          }}
        />
      )
    }

    return (
      <div
        key={source.id}
        className={itemClass(element, source)}
        style={style}
        title={readOnly ? undefined : 'Click to edit, drag to move'}
        onPointerDown={(event) => beginMove(event, source)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {element.text === '' ? '\u00a0' : element.text}
        {renderRotateHandle(source)}
        {renderHandles(source, 'corner')}
      </div>
    )
  }

  function renderLine(element: LineElement) {
    return (
      <div
        key={element.id}
        className={itemClass(element, element)}
        style={positionStyle(element, {
          widthMm: element.lengthMm,
          heightMm: element.thicknessMm
        })}
        onPointerDown={(event) => beginMove(event, element)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {renderHandles(element, 'line')}
      </div>
    )
  }

  function renderGroup(source: GroupElement) {
    const box = { widthMm: source.widthMm, heightMm: source.heightMm }
    return (
      <div
        key={source.id}
        className={itemClass(source, source)}
        style={positionStyle(source, box)}
        title={readOnly ? undefined : 'Click to select the group, drag to move, drag a corner to resize'}
        onPointerDown={(event) => beginMove(event, source)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {source.children.map((child) => renderElement(child))}
        {renderImageRotateHandle(source as unknown as ImageElement)}
        {renderImageResizeHandles(source as unknown as ImageElement)}
      </div>
    )
  }

  function renderElement(element: LabelElement) {
    switch (element.type) {
      case 'text':
        return renderText(element)
      case 'line':
        return renderLine(element)
      case 'image':
        return renderImage(element)
      case 'input':
        return renderInput(element)
      case 'group':
        return renderGroup(element)
    }
  }

  function renderImage(element: ImageElement) {
    const bitmap = bitmaps.get(element.id)
    return (
      <div
        key={element.id}
        className={itemClass(element, element)}
        style={positionStyle(element, {
          widthMm: element.widthMm,
          heightMm: element.heightMm
        })}
        title={readOnly ? undefined : 'Click to select, drag to move, drag the corner to resize'}
        onPointerDown={(event) => beginMove(event, element)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {bitmap ? (
          <img
            className="label-image"
            src={bitmap.previewUrl}
            alt={element.name}
            draggable={false}
          />
        ) : (
          <span className="label-image-pending">converting...</span>
        )}
        {renderImageRotateHandle(element)}
        {renderImageResizeHandles(element)}
      </div>
    )
  }

  function itemClass(element: LabelElement, source: LabelElement): string {
    const classes = [`label-item label-${element.type}`]
    if (!readOnly && selectedIds.includes(source.id)) classes.push('is-selected')
    const placed = absoluteOf(elements, source.id) ?? element
    if (overflowsMedia(placed, media)) classes.push('is-overflow')
    if (source.type === 'input') {
      classes.push('is-field')
    } else if (source.type === 'text' && element.type === 'text' && source.text !== element.text) {
      classes.push('is-field')
    }
    return classes.join(' ')
  }

  const draftLine = draft ? draftToLine(draft) : null
  const marqueeBox = marquee?.moved ? marqueeBounds(marquee) : null
  const selected = readOnly || !selectedId ? null : findElement(elements, selectedId)
  const selectionSource = selectedId ? absoluteOf(elements, selectedId) : null
  const selectionBounds: BoundsMm | null = selectionSource
    ? elementBoundsMm(shown(selectionSource))
    : null
  const padding = mediaPadding(media)
  const content = mediaContentRect(media)
  const hasPadding =
    padding.topMm > 0 || padding.rightMm > 0 || padding.bottomMm > 0 || padding.leftMm > 0

  const sheetStyle: CSSProperties = {
    width: `${media.widthMm * pxPerMm}px`,
    height: `${media.heightMm * pxPerMm}px`,
    backgroundSize: `${5 * pxPerMm}px ${5 * pxPerMm}px`
  }
  const continuous = isContinuous(media)
  if (media.dieCut && !continuous) {
    sheetStyle.borderRadius = `${Math.max(media.cornerRadiusMm, 0) * pxPerMm}px`
  }

  return (
    <div
      className={`canvas-area${dropping ? ' is-dropping' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={() => setDropping(false)}
      onDrop={handleDrop}
    >
      <div className={`canvas-stack${readOnly ? ' is-readonly' : ''}`}>
        {selected && (
          <div className="editor-toolbar-slot">
            <SelectionToolbar
              element={selected}
              selectedElements={selectedIds
                .map((id) => findElement(elements, id))
                .filter((item): item is LabelElement => item !== null)}
              selectedCount={selectedIds.length}
              fontLibrary={fontLibrary}
              onChange={(patch) => onChange(selected.id, patch)}
              onPatchTextStyles={(mutate) => onPatchTextStyles?.(mutate)}
              onPatchInputAlign={onPatchInputAlign}
              onAlign={(alignment, scope) => onAlign(selected.id, alignment, scope)}
              onRotate={() => onRotate(selected.id)}
              onDuplicate={() => onDuplicate(selected.id)}
              onDelete={() => onDelete(selected.id)}
              onLayer={(position) => onLayer(selected.id, position)}
              onGroup={() => onGroup?.()}
              onUngroup={() => onUngroup?.()}
              canGroup={canGroup}
            />
          </div>
        )}
        <div className="canvas-frame">
          {!readOnly && (
            <>
              <span className="ruler-corner">mm</span>
              <Ruler
                orientation="horizontal"
                lengthMm={media.widthMm}
                pxPerMm={pxPerMm}
                highlight={
                  selectionBounds
                    ? {
                        startMm: selectionBounds.xMm,
                        endMm: selectionBounds.xMm + selectionBounds.widthMm
                      }
                    : null
                }
              />
              <Ruler
                orientation="vertical"
                lengthMm={media.heightMm}
                pxPerMm={pxPerMm}
                highlight={
                  selectionBounds
                    ? {
                        startMm: selectionBounds.yMm,
                        endMm: selectionBounds.yMm + selectionBounds.heightMm
                      }
                    : null
                }
              />
            </>
          )}

          <div className="sheet-cell">
            <div
              ref={sheetRef}
              className={`label-sheet${mode === 'line' && !readOnly ? ' is-drawing' : ''}${
                marquee ? ' is-marqueeing' : ''
              }${continuous ? ' is-continuous' : ''}`}
              style={sheetStyle}
              onPointerDown={handleSheetPointerDown}
              onPointerMove={handleSheetPointerMove}
              onPointerUp={handleSheetPointerUp}
              onPointerCancel={handleSheetPointerUp}
            >
              {hasPadding && (
                <div
                  className="label-padding-guide"
                  style={{
                    left: `${content.xMm * pxPerMm}px`,
                    top: `${content.yMm * pxPerMm}px`,
                    width: `${Math.max(content.widthMm * pxPerMm, 0)}px`,
                    height: `${Math.max(content.heightMm * pxPerMm, 0)}px`
                  }}
                />
              )}
              {elements.map((element) => renderElement(element))}

              {marqueeBox && (marqueeBox.widthMm > 0 || marqueeBox.heightMm > 0) && (
                <div
                  className="label-marquee"
                  style={{
                    left: `${marqueeBox.xMm * pxPerMm}px`,
                    top: `${marqueeBox.yMm * pxPerMm}px`,
                    width: `${Math.max(marqueeBox.widthMm * pxPerMm, 1)}px`,
                    height: `${Math.max(marqueeBox.heightMm * pxPerMm, 1)}px`
                  }}
                />
              )}

              {draftLine && draftLine.lengthMm > 0 && (
                <div
                  className="label-item label-line is-draft"
                  style={{
                    left: `${draftLine.xMm * pxPerMm}px`,
                    top: `${draftLine.yMm * pxPerMm}px`,
                    width: `${
                      draftLine.rotation === 0 ? Math.max(draftLine.lengthMm * pxPerMm, 1) : 2
                    }px`,
                    height: `${
                      draftLine.rotation === 0 ? 2 : Math.max(draftLine.lengthMm * pxPerMm, 1)
                    }px`
                  }}
                />
              )}

              {guides.map((guide) => (
                <span
                  key={`${guide.axis}-${guide.positionMm}-${guide.source}`}
                  className={`snap-guide snap-guide-${guide.axis} is-${guide.source}`}
                  style={
                    guide.axis === 'x'
                      ? { left: `${guide.positionMm * pxPerMm}px` }
                      : { top: `${guide.positionMm * pxPerMm}px` }
                  }
                />
              ))}
            </div>

          </div>

          {!continuous && media.gapMm > 0 && (
            <div className="canvas-gap" style={{ height: `${media.gapMm * pxPerMm}px` }} />
          )}
        </div>
      </div>
    </div>
  )
}
