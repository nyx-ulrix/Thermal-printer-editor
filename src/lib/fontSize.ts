import { BASIC_BROWSER_FONTS, FONT_IDS, getFontSpec, TSPL_FONTS } from './fonts'
import { growBoxToFitStyledText } from './fields'
import type { ElementPatch, FontLibraryItem, LabelElement, TextStyle, TsplFontId } from './types'
import { clamp, dotsToPoints, pointsToDots } from './units'

const MIN_PT = 1
const MAX_PT = 400

export function isStyledText(element: LabelElement): boolean {
  return element.type === 'text' || (element.type === 'input' && element.contentType === 'text')
}

export function collectStyledText(elements: LabelElement[]): LabelElement[] {
  const out: LabelElement[] = []
  for (const element of elements) {
    if (isStyledText(element)) out.push(element)
    if (element.type === 'group') out.push(...collectStyledText(element.children))
  }
  return out
}

export function textStyleOf(element: LabelElement): TextStyle | null {
  if (element.type === 'text') return element
  if (element.type === 'input' && element.contentType === 'text') return element.textStyle
  return null
}

/** PowerPoint-style size in whole points. */
export function textSizePt(style: TextStyle): number {
  const spec = getFontSpec(style.font, style.customFontFamily)
  if (spec.kind === 'bitmap') {
    return clamp(Math.round(dotsToPoints(spec.heightDots * style.scaleY)), MIN_PT, MAX_PT)
  }
  return clamp(Math.round(style.scaleY), MIN_PT, MAX_PT)
}

export function sizeToScales(style: TextStyle, sizePt: number): Pick<TextStyle, 'scaleX' | 'scaleY'> {
  const spec = getFontSpec(style.font, style.customFontFamily)
  const pt = clamp(Math.round(sizePt), MIN_PT, MAX_PT)
  if (spec.kind === 'bitmap') {
    const scale = clamp(Math.round(pointsToDots(pt) / Math.max(spec.heightDots, 1)), 1, 10)
    return { scaleX: scale, scaleY: scale }
  }
  return { scaleX: pt, scaleY: pt }
}

export function withTextSize(style: TextStyle, sizePt: number): TextStyle {
  return { ...style, ...sizeToScales(style, sizePt) }
}

/** Adds `delta` points to this style's current size. Mixed selections keep relative sizes. */
export function withTextSizeDelta(style: TextStyle, delta: number): TextStyle {
  return withTextSize(style, textSizePt(style) + delta)
}

export function withTextFont(
  style: TextStyle,
  font: TsplFontId,
  libraryFont?: FontLibraryItem
): TextStyle {
  const sizePt = textSizePt(style)
  const next: TextStyle = {
    ...style,
    font,
    customFontFamily: libraryFont?.family,
    customFontDataUrl: libraryFont?.dataUrl
  }
  return withTextSize(next, sizePt)
}

export function textStylePatch(element: LabelElement, next: TextStyle): ElementPatch | null {
  if (element.type === 'text') {
    return {
      font: next.font,
      customFontFamily: next.customFontFamily,
      customFontDataUrl: next.customFontDataUrl,
      scaleX: next.scaleX,
      scaleY: next.scaleY
    }
  }
  if (element.type === 'input' && element.contentType === 'text') {
    return {
      textStyle: next,
      ...growBoxToFitStyledText(element, next, element.defaultText)
    }
  }
  return null
}

export function commonTextStyle(
  elements: LabelElement[]
): { font: TsplFontId | 'mixed'; sizePt: number | 'mixed' } | null {
  const styles = collectStyledText(elements)
    .map(textStyleOf)
    .filter((style): style is TextStyle => style !== null)
  if (styles.length === 0) return null
  const fonts = new Set(styles.map((style) => style.font))
  const sizes = new Set(styles.map((style) => textSizePt(style)))
  return {
    font: fonts.size === 1 ? styles[0].font : 'mixed',
    sizePt: sizes.size === 1 ? textSizePt(styles[0]) : 'mixed'
  }
}

export function fontSelectGroups(
  library: FontLibraryItem[]
): Array<{ label: string; options: Array<{ id: string; label: string }> }> {
  const groups = [
    {
      label: 'Printer',
      options: FONT_IDS.map((id) => ({ id, label: TSPL_FONTS[id].label }))
    },
    {
      label: 'System',
      options: BASIC_BROWSER_FONTS.map((font) => ({ id: font.id, label: font.name }))
    }
  ]
  if (library.length > 0) {
    groups.push({
      label: 'Uploaded',
      options: library.map((font) => ({ id: font.id, label: font.name }))
    })
  }
  return groups
}

export function fontSelectOptions(library: FontLibraryItem[]): Array<{ id: string; label: string }> {
  return fontSelectGroups(library).flatMap((group) => group.options)
}

export function findLibraryFont(
  font: TsplFontId,
  library: FontLibraryItem[]
): FontLibraryItem | undefined {
  return [...BASIC_BROWSER_FONTS, ...library].find((item) => item.id === font)
}

export function defaultTextStyle(
  font: TsplFontId,
  sizePt: number,
  library: FontLibraryItem[]
): TextStyle {
  const libraryFont = findLibraryFont(font, library)
  return withTextSize(
    {
      font,
      customFontFamily: libraryFont?.family,
      customFontDataUrl: libraryFont?.dataUrl,
      scaleX: 1,
      scaleY: 1
    },
    sizePt
  )
}
