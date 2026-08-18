/** GP-3120TL print-head resolution, used as the app default. */
export const DEFAULT_DPI = 203

const MIN_DPI = 72
const MAX_DPI = 600

let activeDpi = DEFAULT_DPI

/** Widest the GP-3120TL can image, in millimetres. */
export const MAX_PRINT_WIDTH_MM = 76

export const DPI_PRESETS = [203, 300, 600] as const

/**
 * TSPL coordinates are in dots. Gprinter treats 203 DPI as 8 dots per mm rather
 * than 203 / 25.4, so that mapping is kept; other resolutions use dots per mm.
 */
export function dotsPerMmFromDpi(dpi: number): number {
  return dpi === DEFAULT_DPI ? 8 : dpi / 25.4
}

export function getDpi(): number {
  return activeDpi
}

export function applyDpi(dpi: number): number {
  activeDpi = clamp(Math.round(dpi), MIN_DPI, MAX_DPI)
  return activeDpi
}

export function getDotsPerMm(): number {
  return dotsPerMmFromDpi(activeDpi)
}

export function pointsToDots(points: number): number {
  return points * (getDpi() / 72)
}

export function dotsToPoints(dots: number): number {
  return dots / (getDpi() / 72)
}

/** Preview scale at 100% zoom: one screen pixel per printer dot. */
export function getBasePxPerMm(): number {
  return getDotsPerMm()
}

export function mmToDots(mm: number): number {
  return Math.round(mm * getDotsPerMm())
}

export function dotsToMm(dots: number): number {
  return dots / getDotsPerMm()
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Rounds to `decimals` places and drops trailing zeros, so 30.90 becomes "30.9". */
export function formatMm(mm: number, decimals = 2): string {
  return Number(mm.toFixed(decimals)).toString()
}

/** Keeps stored millimetre values tidy, since a drag produces long fractions. */
export function roundMm(mm: number, decimals = 2): number {
  return Number(mm.toFixed(decimals))
}

export function isOverPrintWidth(widthMm: number): boolean {
  return widthMm > MAX_PRINT_WIDTH_MM
}
