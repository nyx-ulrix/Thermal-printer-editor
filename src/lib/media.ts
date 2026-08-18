import { normalizePadding } from './padding'
import type { LabelMedia, MediaStock } from './types'

export interface MediaPreset {
  id: string
  label: string
  widthMm: number
  heightMm: number
}

export const DEFAULT_MEDIA: LabelMedia = {
  widthMm: 40,
  heightMm: 30,
  gapMm: 2,
  density: 8,
  speed: 4,
  direction: 1,
  stock: 'labels',
  dieCut: true,
  cornerRadiusMm: 2,
  padding: { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 }
}

export const DEFAULT_MEDIA_PRESETS: MediaPreset[] = [
  { id: '40x30', label: '40 x 30', widthMm: 40, heightMm: 30 },
  { id: '50x30', label: '50 x 30', widthMm: 50, heightMm: 30 },
  { id: '60x40', label: '60 x 40', widthMm: 60, heightMm: 40 }
]

export function presetLabel(widthMm: number, heightMm: number): string {
  return `${widthMm} x ${heightMm}`
}

export function isContinuous(media: Pick<LabelMedia, 'stock'>): boolean {
  return media.stock === 'continuous'
}

/** Gap the printer should look for. Continuous rolls send GAP 0,0. */
export function mediaGapMm(media: LabelMedia): number {
  return isContinuous(media) ? 0 : Math.max(media.gapMm, 0)
}

export function matchingMediaPreset(
  widthMm: number,
  heightMm: number,
  presets: MediaPreset[] = DEFAULT_MEDIA_PRESETS
): MediaPreset | undefined {
  return presets.find((preset) => preset.widthMm === widthMm && preset.heightMm === heightMm)
}

function normalizeStock(stored: Partial<LabelMedia> | undefined): MediaStock {
  if (stored?.stock === 'continuous' || stored?.stock === 'labels') return stored.stock
  return DEFAULT_MEDIA.stock
}

/** Fills in anything a stored document predates, so old sessions still open. */
export function withMediaDefaults(stored: Partial<LabelMedia> | undefined): LabelMedia {
  if (!stored) return DEFAULT_MEDIA
  const stock = normalizeStock(stored)
  return {
    widthMm: Number.isFinite(stored.widthMm) ? Number(stored.widthMm) : DEFAULT_MEDIA.widthMm,
    heightMm: Number.isFinite(stored.heightMm) ? Number(stored.heightMm) : DEFAULT_MEDIA.heightMm,
    gapMm: Number.isFinite(stored.gapMm) ? Number(stored.gapMm) : DEFAULT_MEDIA.gapMm,
    density: Number.isFinite(stored.density) ? Number(stored.density) : DEFAULT_MEDIA.density,
    speed: Number.isFinite(stored.speed) ? Number(stored.speed) : DEFAULT_MEDIA.speed,
    direction: stored.direction === 0 ? 0 : 1,
    stock,
    dieCut: stock === 'continuous' ? false : stored.dieCut ?? DEFAULT_MEDIA.dieCut,
    cornerRadiusMm: Number.isFinite(stored.cornerRadiusMm)
      ? Number(stored.cornerRadiusMm)
      : DEFAULT_MEDIA.cornerRadiusMm,
    padding: normalizePadding(stored.padding)
  }
}
