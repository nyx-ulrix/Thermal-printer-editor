import { handleSelectAllOnFocus, handleSelectAllOnMouseUp } from '../../lib/inputSelection'
import { textSizePt, withTextFont, withTextSize, withTextSizeDelta } from '../../lib/fontSize'
import type { FontLibraryItem, TextElement } from '../../lib/types'
import FontControls from '../FontControls'

interface TextPropertiesProps {
  element: TextElement
  fontLibrary: FontLibraryItem[]
  onChange: (patch: Partial<TextElement>) => void
}

export default function TextProperties({ element, fontLibrary, onChange }: TextPropertiesProps) {
  return (
    <>
      <label className="field">
        <span>Content</span>
        <textarea
          rows={2}
          value={element.text}
          onChange={(event) => onChange({ text: event.target.value })}
          onFocus={handleSelectAllOnFocus}
          onMouseUp={handleSelectAllOnMouseUp}
        />
      </label>

      <FontControls
        font={element.font}
        sizePt={textSizePt(element)}
        fontLibrary={fontLibrary}
        onFontChange={(font, libraryFont) => onChange(withTextFont(element, font, libraryFont))}
        onSizeChange={(sizePt) => onChange(withTextSize(element, sizePt))}
        onSizeNudge={(delta) => onChange(withTextSizeDelta(element, delta))}
      />
      <p className="panel-hint">
        Prints are rasterized, so built-in families and uploaded TTF fonts render from the app's
        font library instead of relying on printer-native fonts.
      </p>
    </>
  )
}
