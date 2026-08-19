import { layoutGroup, normalizeGroup } from './groupLayout'
import { migrateTextStyle } from './fonts'
import { offsetByLocal, textExtentDots } from './preview'
import { wrapLinesAtSpaces } from './textWrap'
import { flattenGroups, inputsIn } from './tree'
import type {
  FieldValue,
  FieldValues,
  ImageElement,
  InputElement,
  LabelElement,
  ResolvedLabelElement,
  SavedPrintFill,
  TextAlign,
  TextElement,
  VerticalAlign
} from './types'
import { getDotsPerMm, roundMm } from './units'

const FIT_SLACK_DOTS = 0.5

function styledTextElement(textStyle: InputElement['textStyle'], text: string): TextElement {
  return {
    id: 'measure',
    type: 'text',
    xMm: 0,
    yMm: 0,
    rotation: 0,
    text: text || ' ',
    ...textStyle
  }
}

export function measureStyledTextMm(
  textStyle: InputElement['textStyle'],
  text: string
): { widthMm: number; heightMm: number } {
  const extent = textExtentDots(styledTextElement(textStyle, text))
  return {
    widthMm: extent.widthDots / getDotsPerMm(),
    heightMm: extent.heightDots / getDotsPerMm()
  }
}

/** Grows a box so the given text can use the provided font size without shrinking. */
export function growBoxToFitStyledText(
  box: { widthMm: number; heightMm: number },
  textStyle: InputElement['textStyle'],
  text: string
): { widthMm: number; heightMm: number } {
  const line = measureStyledTextMm(textStyle, ' ')
  const longestWordMm = text
    .replace(/\t/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .reduce((widest, word) => Math.max(widest, measureStyledTextMm(textStyle, word).widthMm), 0)
  return {
    widthMm: roundMm(Math.max(box.widthMm, longestWordMm, 2)),
    heightMm: roundMm(Math.max(box.heightMm, line.heightMm, 2))
  }
}

export function inputTextAlign(input: InputElement): TextAlign {
  return input.textAlign === 'center' || input.textAlign === 'right' ? input.textAlign : 'left'
}

export function inputVerticalAlign(input: InputElement): VerticalAlign {
  return input.verticalAlign === 'middle' || input.verticalAlign === 'bottom' ? input.verticalAlign : 'top'
}

export interface InputTextLine {
  text: string
  offsetXMm: number
  offsetYMm: number
}

function measureWidthDots(style: TextElement, text: string): number {
  if (text === '') return 0
  return textExtentDots({ ...style, text }).widthDots
}

function lineHeightDots(style: TextElement): number {
  return textExtentDots({ ...style, text: ' ' }).heightDots
}

function alignLineX(align: TextAlign, lineWidthMm: number, boxWidthMm: number): number {
  if (align === 'center') return (boxWidthMm - lineWidthMm) / 2
  if (align === 'right') return boxWidthMm - lineWidthMm
  return 0
}

function alignBlockY(align: VerticalAlign, blockHeightMm: number, boxHeightMm: number): number {
  if (align === 'middle') return (boxHeightMm - blockHeightMm) / 2
  if (align === 'bottom') return boxHeightMm - blockHeightMm
  return 0
}

export function inputsOf(elements: LabelElement[]): InputElement[] {
  const inputs = inputsIn(elements)
  return [...inputs].sort((left, right) => {
    const leftOrder = left.printOrder
    const rightOrder = right.printOrder
    if (leftOrder == null && rightOrder == null) return 0
    if (leftOrder == null) return 1
    if (rightOrder == null) return -1
    return leftOrder - rightOrder
  })
}

export function normalizeLabelElement(element: LabelElement): LabelElement {
  if (element.type === 'group') {
    return layoutGroup({
      ...normalizeGroup(element),
      children: element.children.map(normalizeLabelElement)
    })
  }
  if (element.type === 'text') {
    return { ...element, ...migrateTextStyle(element), rotation: element.rotation ?? 0 }
  }
  if (element.type !== 'input') return { ...element, rotation: element.rotation ?? 0 }
  const stored = element as InputElement & { widthMm?: number; heightMm?: number }
  return {
    ...stored,
    rotation: stored.rotation ?? 0,
    widthMm: Number.isFinite(stored.widthMm)
      ? Number(stored.widthMm)
      : stored.contentType === 'image'
        ? stored.imageStyle.widthMm || 16
        : 24,
    heightMm: Number.isFinite(stored.heightMm)
      ? Number(stored.heightMm)
      : stored.contentType === 'image'
        ? stored.imageStyle.heightMm || 16
        : 8,
    textStyle: migrateTextStyle(stored.textStyle),
    textAlign: inputTextAlign(stored),
    verticalAlign: inputVerticalAlign(stored),
    printOrder: Number.isFinite(stored.printOrder) ? Number(stored.printOrder) : undefined
  }
}

export function inputBoxSize(input: InputElement): { widthMm: number; heightMm: number } {
  return {
    widthMm: Math.max(input.widthMm || input.imageStyle.widthMm || 24, 2),
    heightMm: Math.max(input.heightMm || input.imageStyle.heightMm || 8, 2)
  }
}

/** Fits a rectangle inside a box without cropping, shrinking only. */
export function containInBox(
  boxWidthMm: number,
  boxHeightMm: number,
  aspectRatio: number
): { widthMm: number; heightMm: number; offsetXMm: number; offsetYMm: number } {
  const aspect = aspectRatio > 0 ? aspectRatio : 1
  let widthMm = boxWidthMm
  let heightMm = widthMm / aspect
  if (heightMm > boxHeightMm) {
    heightMm = boxHeightMm
    widthMm = heightMm * aspect
  }
  return {
    widthMm: roundMm(widthMm),
    heightMm: roundMm(heightMm),
    offsetXMm: roundMm((boxWidthMm - widthMm) / 2),
    offsetYMm: roundMm((boxHeightMm - heightMm) / 2)
  }
}

function positionLines(
  input: InputElement,
  style: TextElement,
  lines: string[],
  box: { widthMm: number; heightMm: number }
): InputTextLine[] {
  const heightDots = lineHeightDots(style)
  const lineHeightMm = heightDots / getDotsPerMm()
  const blockHeightMm = lines.length * lineHeightMm
  const originY = alignBlockY(inputVerticalAlign(input), blockHeightMm, box.heightMm)
  const align = inputTextAlign(input)

  return lines.map((line, index) => {
    const widthMm = measureWidthDots(style, line) / getDotsPerMm()
    return {
      text: line,
      offsetXMm: roundMm(alignLineX(align, widthMm, box.widthMm)),
      offsetYMm: roundMm(originY + index * lineHeightMm)
    }
  })
}

function tryWrappedLayout(
  input: InputElement,
  text: string,
  box: { widthMm: number; heightMm: number },
  scaleX: number,
  scaleY: number
): { element: TextElement; lines: string[]; fits: boolean } {
  const element: TextElement = {
    id: input.id,
    type: 'text',
    xMm: input.xMm,
    yMm: input.yMm,
    rotation: input.rotation,
    text: text || ' ',
    ...input.textStyle,
    scaleX,
    scaleY
  }
  const boxWidthDots = Math.max(box.widthMm * getDotsPerMm(), 1)
  const boxHeightDots = Math.max(box.heightMm * getDotsPerMm(), 1)
  const wrapped = wrapLinesAtSpaces(
    text,
    boxWidthDots,
    (value) => measureWidthDots(element, value),
    FIT_SLACK_DOTS
  )
  const blockHeightDots = wrapped.lines.length * lineHeightDots(element)
  const fits =
    !wrapped.wordOverflow && blockHeightDots <= boxHeightDots + FIT_SLACK_DOTS
  return { element, lines: wrapped.lines, fits }
}

function fitTextInBox(input: InputElement, text: string): {
  element: TextElement
  lines: InputTextLine[]
} {
  const box = inputBoxSize(input)
  const full = tryWrappedLayout(input, text, box, input.textStyle.scaleX, input.textStyle.scaleY)
  let chosen = full

  if (!full.fits) {
    let low = 0.05
    let high = 1
    chosen = tryWrappedLayout(
      input,
      text,
      box,
      roundMm(Math.max(input.textStyle.scaleX * low, 0.05), 3),
      roundMm(Math.max(input.textStyle.scaleY * low, 0.05), 3)
    )
    for (let step = 0; step < 18; step += 1) {
      const mid = (low + high) / 2
      const next = tryWrappedLayout(
        input,
        text,
        box,
        roundMm(Math.max(input.textStyle.scaleX * mid, 0.05), 3),
        roundMm(Math.max(input.textStyle.scaleY * mid, 0.05), 3)
      )
      if (next.fits) {
        chosen = next
        low = mid
      } else {
        high = mid
      }
    }
  }

  return {
    element: chosen.element,
    lines: positionLines(input, chosen.element, chosen.lines, box)
  }
}

function fitImageInBox(input: InputElement, value: FieldValue | undefined): {
  element: ImageElement
  offsetXMm: number
  offsetYMm: number
} {
  const box = inputBoxSize(input)
  const source = value?.contentType === 'image' ? value : undefined
  const aspect = source?.aspectRatio || input.imageStyle.aspectRatio || 1
  return {
    element: {
      id: input.id,
      type: 'image',
      xMm: input.xMm,
      yMm: input.yMm,
      rotation: input.rotation,
      name: source?.name || input.imageStyle.name || input.label || input.key,
      sourceDataUrl: source?.sourceDataUrl || input.imageStyle.sourceDataUrl,
      widthMm: box.widthMm,
      heightMm: box.heightMm,
      aspectRatio: aspect,
      threshold: input.imageStyle.threshold,
      dither: input.imageStyle.dither,
      invert: input.imageStyle.invert
    },
    offsetXMm: 0,
    offsetYMm: 0
  }
}

export function layoutInputContent(input: InputElement, values: FieldValues) {
  if (input.contentType === 'image') {
    return { kind: 'image' as const, ...fitImageInBox(input, values[input.key]) }
  }
  const value = values[input.key]
  const text = value?.contentType === 'text' ? value.text : input.defaultText
  return { kind: 'text' as const, ...fitTextInBox(input, text) }
}

export function resolveElements(elements: LabelElement[], values: FieldValues): ResolvedLabelElement[] {
  return flattenGroups(elements).flatMap((element) => {
    if (element.type !== 'input') return [element]
    const value = values[element.key]
    if (element.contentType === 'image') {
      const fitted = fitImageInBox(element, value)
      const origin = offsetByLocal(
        element.xMm,
        element.yMm,
        element.rotation,
        fitted.offsetXMm,
        fitted.offsetYMm
      )
      return [{ ...fitted.element, ...origin }]
    }
    const text = value?.contentType === 'text' ? value.text : element.defaultText
    const fitted = fitTextInBox(element, text)
    return fitted.lines.map((line, index) => {
      const origin = offsetByLocal(
        element.xMm,
        element.yMm,
        element.rotation,
        line.offsetXMm,
        line.offsetYMm
      )
      return {
        ...fitted.element,
        id: `${element.id}__${index}`,
        text: line.text === '' ? ' ' : line.text,
        ...origin
      }
    })
  })
}

export function mergeValues(elements: LabelElement[], entered: FieldValues): FieldValues {
  const values: FieldValues = {}
  for (const input of inputsOf(elements)) {
    const typed = entered[input.key]
    if (typed) {
      values[input.key] = typed
      continue
    }
    values[input.key] =
      input.contentType === 'image'
        ? {
            contentType: 'image',
            sourceDataUrl: input.imageStyle.sourceDataUrl,
            name: input.imageStyle.name || input.label || input.key,
            aspectRatio: input.imageStyle.aspectRatio || 1
          }
        : { contentType: 'text', text: input.defaultText }
  }
  return values
}

/**
 * Bumps the trailing number of a value, keeping any zero padding, so "SN-0009" becomes
 * "SN-0010". Values without a trailing number are returned unchanged.
 */
export function incrementValue(value: string): string {
  const match = /^(.*?)(\d+)(\D*)$/.exec(value)
  if (!match) return value

  const [, prefix, digits, suffix] = match
  const next = String(Number(digits) + 1)
  return `${prefix}${next.padStart(digits.length, '0')}${suffix}`
}

/** Applies the increment flag to each field after a job has been sent. */
export function incrementFields(elements: LabelElement[], values: FieldValues): FieldValues {
  const next: FieldValues = { ...values }
  for (const field of inputsOf(elements)) {
    if (!field.increment || field.contentType !== 'text') continue
    const current = values[field.key]
    const text =
      current?.contentType === 'text'
        ? current.text
        : field.defaultText
    next[field.key] = { contentType: 'text', text: incrementValue(text) }
  }
  return next
}

export function isValidKey(key: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(key)
}

export function normalizeFieldValue(raw: unknown): FieldValue | null {
  if (typeof raw === 'string') return { contentType: 'text', text: raw }
  if (!raw || typeof raw !== 'object') return null

  const value = raw as { contentType?: unknown; text?: unknown; sourceDataUrl?: unknown; name?: unknown; aspectRatio?: unknown }
  if (value.contentType === 'text' && typeof value.text === 'string') {
    return { contentType: 'text', text: value.text }
  }
  if (value.contentType === 'image' && typeof value.sourceDataUrl === 'string') {
    return {
      contentType: 'image',
      sourceDataUrl: value.sourceDataUrl,
      name: typeof value.name === 'string' && value.name !== '' ? value.name : 'Image',
      aspectRatio: Number(value.aspectRatio) > 0 ? Number(value.aspectRatio) : 1
    }
  }
  return null
}

export function normalizeFieldValues(raw: unknown): FieldValues {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const values: FieldValues = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalized = normalizeFieldValue(value)
    if (normalized) values[key] = normalized
  }
  return values
}

/** True when the operator has given this input a usable print-time value. */
export function isInputFilled(input: InputElement, value: FieldValue | undefined): boolean {
  if (input.contentType === 'image') {
    if (value?.contentType === 'image' && value.sourceDataUrl !== '') return true
    return input.imageStyle.sourceDataUrl !== ''
  }
  return value?.contentType === 'text' && value.text.trim() !== ''
}

export function missingInputs(elements: LabelElement[], entered: FieldValues): InputElement[] {
  return inputsOf(elements).filter((input) => !isInputFilled(input, entered[input.key]))
}

export function describeFill(elements: LabelElement[], values: FieldValues): string {
  const parts = inputsOf(elements).map((input) => {
    const value = values[input.key]
    if (value?.contentType === 'text' && value.text.trim() !== '') return value.text.trim()
    if (value?.contentType === 'image' && value.name) return value.name
    if (input.contentType === 'image' && input.imageStyle.name) return input.imageStyle.name
    return input.label || input.key
  })
  return parts.join(' · ') || 'Saved values'
}

export function previousTextValues(history: SavedPrintFill[], key: string): string[] {
  const seen: string[] = []
  for (const fill of history) {
    const value = fill.values[key]
    if (value?.contentType !== 'text') continue
    const text = value.text.trim()
    if (text !== '' && !seen.includes(text)) seen.push(text)
  }
  return seen
}
