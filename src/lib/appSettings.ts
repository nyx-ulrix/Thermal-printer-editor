import { DEFAULT_MEDIA_PRESETS, type MediaPreset } from './media'
import { migrateFontId } from './fonts'
import { readPersisted, writePersisted } from './persist'
import { clamp, DEFAULT_DPI } from './units'
import type { TsplFontId } from './types'

const SETTINGS_KEY = 'gp3120tl.settings.v1'

export interface AppSettings {
  dpi: number
  defaultFont: TsplFontId
  defaultSizePt: number
  mediaPresets: MediaPreset[]
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  dpi: DEFAULT_DPI,
  defaultFont: 'thermal-classic',
  defaultSizePt: 12,
  mediaPresets: DEFAULT_MEDIA_PRESETS
}

function readJson<T>(key: string, fallback: T): T {
  const parsed = readPersisted<T>(key, fallback)
  return parsed === null || typeof parsed !== 'object' ? fallback : parsed
}

function normalizePreset(value: Partial<MediaPreset> | undefined, index: number): MediaPreset | null {
  const widthMm = Number(value?.widthMm)
  const heightMm = Number(value?.heightMm)
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm)) return null
  const id = typeof value?.id === 'string' && value.id ? value.id : `preset-${index}`
  const label =
    typeof value?.label === 'string' && value.label.trim()
      ? value.label.trim()
      : `${widthMm} x ${heightMm}`
  return {
    id,
    label,
    widthMm: clamp(widthMm, 5, 120),
    heightMm: clamp(heightMm, 5, 300)
  }
}

export function normalizeAppSettings(stored: Partial<AppSettings> | undefined): AppSettings {
  const presets = Array.isArray(stored?.mediaPresets)
    ? stored.mediaPresets
        .map(normalizePreset)
        .filter((preset): preset is MediaPreset => preset !== null)
    : DEFAULT_MEDIA_PRESETS

  return {
    dpi: clamp(Math.round(Number(stored?.dpi) || DEFAULT_DPI), 72, 600),
    defaultFont: migrateFontId(
      typeof stored?.defaultFont === 'string' && stored.defaultFont
        ? stored.defaultFont
        : DEFAULT_APP_SETTINGS.defaultFont
    ),
    defaultSizePt: clamp(Math.round(Number(stored?.defaultSizePt) || DEFAULT_APP_SETTINGS.defaultSizePt), 1, 400),
    mediaPresets: presets.length > 0 ? presets : DEFAULT_MEDIA_PRESETS
  }
}

export function loadAppSettings(): AppSettings {
  return normalizeAppSettings(readJson<Partial<AppSettings>>(SETTINGS_KEY, {}))
}

export function saveAppSettings(settings: AppSettings): void {
  writePersisted(SETTINGS_KEY, settings)
}
