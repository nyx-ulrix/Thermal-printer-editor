import type { FontLibraryItem, TextStyle, TsplFontId } from './types'
import { clamp, dotsToPoints } from './units'

export type FontKind = 'bitmap' | 'scalable' | 'truetype'

export interface FontSpec {
  id: TsplFontId
  kind: FontKind
  label: string
  /** Character cell size in dots at multiplier 1. Bitmap fonts only. */
  widthDots: number
  heightDots: number
  cssFamily: string
  cssWeight: number
}

const CONDENSED = "'Arial Narrow', 'Helvetica Neue', Arial, sans-serif"
const MONO = "'Cascadia Mono', Consolas, monospace"

export const BASIC_BROWSER_FONTS: FontLibraryItem[] = [
  { id: 'basic-arial', name: 'Arial', family: 'Arial, Helvetica, sans-serif' },
  { id: 'basic-times', name: 'Times New Roman', family: '"Times New Roman", Times, serif' },
  { id: 'basic-georgia', name: 'Georgia', family: 'Georgia, serif' },
  { id: 'basic-verdana', name: 'Verdana', family: 'Verdana, Geneva, sans-serif' },
  { id: 'basic-trebuchet', name: 'Trebuchet MS', family: '"Trebuchet MS", sans-serif' },
  { id: 'basic-courier', name: 'Courier New', family: '"Courier New", Courier, monospace' }
]

export const THERMAL_CLASSIC_ID = 'thermal-classic'
export const ROMAN_ID = 'ROMAN.TTF'

const LEGACY_THERMAL_IDS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8'])

/**
 * Built-in faces shown in the font menu. Thermal classic replaces the old numbered
 * TSPL bitmap/OCR IDs with one scalable thermal look. Roman is the printer TTF,
 * labelled without the file extension.
 */
export const TSPL_FONTS: Record<string, FontSpec> = {
  [THERMAL_CLASSIC_ID]: {
    id: THERMAL_CLASSIC_ID,
    kind: 'truetype',
    label: 'Thermal classic',
    widthDots: 0,
    heightDots: 0,
    cssFamily: MONO,
    cssWeight: 400
  },
  [ROMAN_ID]: {
    id: ROMAN_ID,
    kind: 'truetype',
    label: 'Roman',
    widthDots: 0,
    heightDots: 0,
    cssFamily: CONDENSED,
    cssWeight: 700
  },
  '0': {
    id: '0',
    kind: 'scalable',
    label: '0',
    widthDots: 0,
    heightDots: 0,
    cssFamily: CONDENSED,
    cssWeight: 700
  },
  '1': { id: '1', kind: 'bitmap', label: '1', widthDots: 8, heightDots: 12, cssFamily: MONO, cssWeight: 400 },
  '2': { id: '2', kind: 'bitmap', label: '2', widthDots: 12, heightDots: 20, cssFamily: MONO, cssWeight: 400 },
  '3': { id: '3', kind: 'bitmap', label: '3', widthDots: 16, heightDots: 24, cssFamily: MONO, cssWeight: 400 },
  '4': { id: '4', kind: 'bitmap', label: '4', widthDots: 24, heightDots: 32, cssFamily: MONO, cssWeight: 400 },
  '5': { id: '5', kind: 'bitmap', label: '5', widthDots: 32, heightDots: 48, cssFamily: MONO, cssWeight: 400 },
  '6': { id: '6', kind: 'bitmap', label: '6 OCR-B', widthDots: 14, heightDots: 19, cssFamily: MONO, cssWeight: 400 },
  '7': { id: '7', kind: 'bitmap', label: '7 OCR-B', widthDots: 21, heightDots: 27, cssFamily: MONO, cssWeight: 400 },
  '8': { id: '8', kind: 'bitmap', label: '8 OCR-A', widthDots: 14, heightDots: 25, cssFamily: MONO, cssWeight: 400 }
}

export const FONT_IDS: TsplFontId[] = [THERMAL_CLASSIC_ID, ROMAN_ID]

export function getFontSpec(font: TsplFontId, customFamily?: string): FontSpec {
  const builtin = TSPL_FONTS[font]
  if (builtin) return builtin

  return {
    id: font,
    kind: 'truetype',
    label: font,
    widthDots: 0,
    heightDots: 0,
    cssFamily: customFamily ? `"${customFamily}"` : 'sans-serif',
    cssWeight: 400
  }
}

/** Maps old numbered/OCR printer fonts onto Thermal classic, keeping visual size. */
export function migrateTextStyle<T extends TextStyle>(style: T): T {
  if (style.font === 'roman') {
    return { ...style, font: ROMAN_ID }
  }
  if (!LEGACY_THERMAL_IDS.has(style.font)) return style

  const spec = TSPL_FONTS[style.font]
  const sizePt =
    spec?.kind === 'bitmap'
      ? clamp(Math.round(dotsToPoints(spec.heightDots * (Number(style.scaleY) || 1))), 1, 400)
      : clamp(Math.round(Number(style.scaleY) || 12), 1, 400)

  return {
    ...style,
    font: THERMAL_CLASSIC_ID,
    customFontFamily: undefined,
    customFontDataUrl: undefined,
    scaleX: sizePt,
    scaleY: sizePt
  }
}

export function migrateFontId(font: string): TsplFontId {
  if (LEGACY_THERMAL_IDS.has(font)) return THERMAL_CLASSIC_ID
  if (font === 'roman') return ROMAN_ID
  return font
}

export interface ScaleFieldSpec {
  label: string
  min: number
  max: number
  step: number
  disabled: boolean
  hint: string
}

/** Describes what the two TSPL size parameters mean for the given font. */
export function scaleFieldSpecs(font: TsplFontId): { x: ScaleFieldSpec; y: ScaleFieldSpec } {
  const kind = getFontSpec(font).kind

  if (kind === 'bitmap') {
    const hint = 'Whole-number multiplier of the font cell, 1 to 10.'
    return {
      x: { label: 'Scale X', min: 1, max: 10, step: 1, disabled: false, hint },
      y: { label: 'Scale Y', min: 1, max: 10, step: 1, disabled: false, hint }
    }
  }

  const hint = 'Size in points, 1 point = 1/72 inch. Type any value.'
  if (kind === 'truetype') {
    return {
      x: { label: 'Width (ignored)', min: 1, max: 1000, step: 1, disabled: true, hint },
      y: { label: 'Height (pt)', min: 1, max: 1000, step: 1, disabled: false, hint }
    }
  }

  return {
    x: { label: 'Width (pt)', min: 1, max: 1000, step: 1, disabled: false, hint },
    y: { label: 'Height (pt)', min: 1, max: 1000, step: 1, disabled: false, hint }
  }
}
