import BoxAlignButtons from '../BoxAlignButtons'
import { growBoxToFitStyledText, inputTextAlign, inputVerticalAlign } from '../../lib/fields'
import { textSizePt, withTextFont, withTextSize, withTextSizeDelta } from '../../lib/fontSize'
import { detectImageContentFromImage, loadImage, readFileAsDataUrl, type MonoBitmap } from '../../lib/imageMono'
import { handleSelectAllOnFocus, handleSelectAllOnMouseUp } from '../../lib/inputSelection'
import type { FontLibraryItem, InputElement } from '../../lib/types'
import { roundMm } from '../../lib/units'
import FontControls from '../FontControls'
import NumberField from '../NumberField'

interface InputPropertiesProps {
  element: InputElement
  bitmap: MonoBitmap | undefined
  fontLibrary: FontLibraryItem[]
  onChange: (patch: Partial<InputElement>) => void
}

export default function InputProperties({
  element,
  bitmap,
  fontLibrary,
  onChange
}: InputPropertiesProps) {

  return (
    <>
      <label className="field">
        <span>Label</span>
        <input
          type="text"
          value={element.label}
          onChange={(event) => onChange({ label: event.target.value })}
          onFocus={handleSelectAllOnFocus}
          onMouseUp={handleSelectAllOnMouseUp}
        />
      </label>

      <label className="field">
        <span>Key</span>
        <input
          type="text"
          value={element.key}
          spellCheck={false}
          onChange={(event) => onChange({ key: event.target.value })}
          onFocus={handleSelectAllOnFocus}
          onMouseUp={handleSelectAllOnMouseUp}
        />
      </label>

      <label className="field">
        <span>Input type</span>
        <select
          value={element.contentType}
          onChange={(event) =>
            onChange({ contentType: event.target.value as InputElement['contentType'] })
          }
        >
          <option value="text">Text</option>
          <option value="image">Image</option>
        </select>
      </label>

      <p className="panel-hint">
        Text wraps to the next line at spaces when the box is tall enough. Your font size is kept
        when the wrapped text fits; only then does it scale down.
      </p>
      <div className="field-row">
        <NumberField
          label="Box width (mm)"
          value={element.widthMm}
          min={2}
          max={300}
          step={0.5}
          onCommit={(widthMm) => onChange({ widthMm })}
        />
        <NumberField
          label="Box height (mm)"
          value={element.heightMm}
          min={2}
          max={300}
          step={0.5}
          onCommit={(heightMm) => onChange({ heightMm })}
        />
      </div>

      {element.contentType === 'text' ? (
        <>
          <label className="field">
            <span>Default text</span>
            <textarea
              rows={2}
              value={element.defaultText}
              onChange={(event) => onChange({ defaultText: event.target.value })}
              onFocus={handleSelectAllOnFocus}
              onMouseUp={handleSelectAllOnMouseUp}
            />
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={element.increment}
              onChange={(event) => onChange({ increment: event.target.checked })}
            />
            <span>Count up after print</span>
          </label>

          <div className="presets">
            <span className="presets-label">Align in box</span>
            <BoxAlignButtons
              textAlign={inputTextAlign(element)}
              verticalAlign={inputVerticalAlign(element)}
              onChange={onChange}
            />
          </div>

          <FontControls
            font={element.textStyle.font}
            sizePt={textSizePt(element.textStyle)}
            fontLibrary={fontLibrary}
            onFontChange={(font, libraryFont) => {
              const textStyle = withTextFont(element.textStyle, font, libraryFont)
              onChange({
                textStyle,
                ...growBoxToFitStyledText(element, textStyle, element.defaultText)
              })
            }}
            onSizeChange={(sizePt) => {
              const textStyle = withTextSize(element.textStyle, sizePt)
              onChange({
                textStyle,
                ...growBoxToFitStyledText(element, textStyle, element.defaultText)
              })
            }}
            onSizeNudge={(delta) => {
              const textStyle = withTextSizeDelta(element.textStyle, delta)
              onChange({
                textStyle,
                ...growBoxToFitStyledText(element, textStyle, element.defaultText)
              })
            }}
          />
        </>
      ) : (
        <>
          <label className="field">
            <span>Default image</span>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file) return
                void (async () => {
                  const sourceDataUrl = await readFileAsDataUrl(file)
                  const image = await loadImage(sourceDataUrl)
                  const crop = detectImageContentFromImage(
                    image,
                    element.imageStyle.threshold,
                    element.imageStyle.invert
                  )
                  onChange({
                    imageStyle: {
                      ...element.imageStyle,
                      name: file.name,
                      sourceDataUrl,
                      aspectRatio: crop.aspectRatio || 1,
                      heightMm: roundMm(element.widthMm / (crop.aspectRatio || 1))
                    }
                  })
                })()
              }}
            />
          </label>

          <p className="panel-hint">
            White padding is trimmed, then the image fills the box.
          </p>

          <NumberField
            label="Threshold"
            value={element.imageStyle.threshold}
            min={1}
            max={254}
            step={1}
            onCommit={(threshold) =>
              onChange({ imageStyle: { ...element.imageStyle, threshold } })
            }
          />

          <label className="checkbox">
            <input
              type="checkbox"
              checked={element.imageStyle.dither}
              onChange={(event) =>
                onChange({ imageStyle: { ...element.imageStyle, dither: event.target.checked } })
              }
            />
            <span>Dither</span>
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={element.imageStyle.invert}
              onChange={(event) =>
                onChange({ imageStyle: { ...element.imageStyle, invert: event.target.checked } })
              }
            />
            <span>Invert black and white</span>
          </label>

          {bitmap && (
            <p className="panel-hint">
              Default image preview is ready at {bitmap.widthDots} x {bitmap.heightDots} dots.
            </p>
          )}
        </>
      )}
    </>
  )
}
