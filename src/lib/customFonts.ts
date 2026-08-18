const loadedFonts = new Set<string>()

function formatFamily(name: string): string {
  return `LabelCustom-${name.replace(/[^A-Za-z0-9_-]+/g, '-')}`
}

/** Stable CSS family name for an uploaded font file. */
export function customFontFamilyFromName(name: string): string {
  return formatFamily(name.replace(/\.[^.]+$/, ''))
}

/** Registers a TTF/OTF data URL with the browser so preview, measure and raster share it. */
export async function ensureCustomFontLoaded(family: string, sourceDataUrl: string): Promise<void> {
  if (loadedFonts.has(family)) return
  const face = new FontFace(family, `url(${sourceDataUrl})`)
  await face.load()
  document.fonts.add(face)
  loadedFonts.add(family)
}
