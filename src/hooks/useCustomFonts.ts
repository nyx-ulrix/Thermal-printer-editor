import { useEffect } from 'react'
import { ensureCustomFontLoaded } from '../lib/customFonts'
import { walkElements } from '../lib/tree'
import type { FontLibraryItem, LabelElement } from '../lib/types'

/** Makes uploaded TTF fonts available to both the DOM preview and the canvas measurer. */
export function useCustomFonts(elements: LabelElement[], library: FontLibraryItem[] = []): void {
  useEffect(() => {
    for (const font of library) {
      if (!font.dataUrl) continue
      void ensureCustomFontLoaded(font.family, font.dataUrl)
    }

    for (const element of walkElements(elements)) {
      if (element.type === 'text' && element.customFontFamily && element.customFontDataUrl) {
        void ensureCustomFontLoaded(element.customFontFamily, element.customFontDataUrl)
      }
      if (
        element.type === 'input' &&
        element.textStyle.customFontFamily &&
        element.textStyle.customFontDataUrl
      ) {
        void ensureCustomFontLoaded(element.textStyle.customFontFamily, element.textStyle.customFontDataUrl)
      }
    }
  }, [elements, library])
}
