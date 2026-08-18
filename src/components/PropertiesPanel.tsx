import type { MonoBitmap } from '../lib/imageMono'
import { overflowsMedia } from '../lib/preview'
import type { AlignScope, Alignment } from '../lib/snapping'
import type {
  ElementPatch,
  FontLibraryItem,
  LabelElement,
  LabelMedia,
  TextAlign,
  TextStyle,
  VerticalAlign
} from '../lib/types'
import { collectImages, collectTextInputs } from '../lib/tree'
import GeometryFields from './properties/GeometryFields'
import GroupProperties from './properties/GroupProperties'
import InputProperties from './properties/InputProperties'
import ImageProperties from './properties/ImageProperties'
import LineProperties from './properties/LineProperties'
import TextProperties from './properties/TextProperties'
import FontControls from './FontControls'
import BoxAlignButtons from './BoxAlignButtons'
import { IconButton } from './Icon'
import { commonTextStyle, withTextFont, withTextSize, withTextSizeDelta } from '../lib/fontSize'
import { inputTextAlign, inputVerticalAlign } from '../lib/fields'

interface PropertiesPanelProps {
  element: LabelElement | null
  selectedElements: LabelElement[]
  selectedCount: number
  media: LabelMedia
  bitmap: MonoBitmap | undefined
  fontLibrary: FontLibraryItem[]
  onChange: (patch: ElementPatch) => void
  onPatchTextStyles: (mutate: (style: TextStyle) => TextStyle) => void
  onPatchInputAlign?: (patch: { textAlign?: TextAlign; verticalAlign?: VerticalAlign }) => void
  onAlign: (alignment: Alignment, scope?: AlignScope) => void
  onDuplicate: () => void
  onDelete: () => void
  onGroup: () => void
  onUngroup: () => void
  canGroup?: boolean
}

const TITLES: Record<LabelElement['type'], string> = {
  text: 'Text',
  line: 'Line',
  image: 'Image',
  input: 'Input Field',
  group: 'Group'
}

function extraAlignFor(elements: LabelElement[]): Array<{ label: string; scope: Exclude<AlignScope, 'label'> }> {
  const hasText = commonTextStyle(elements) !== null
  const hasImages = collectImages(elements).length > 0
  const rows: Array<{ label: string; scope: Exclude<AlignScope, 'label'> }> = []
  if (hasText) rows.push({ label: 'Align text', scope: 'text' })
  if (hasImages) rows.push({ label: 'Align images', scope: 'image' })
  return rows
}

export default function PropertiesPanel({
  element,
  selectedElements,
  selectedCount,
  media,
  bitmap,
  fontLibrary,
  onChange,
  onPatchTextStyles,
  onPatchInputAlign,
  onAlign,
  onDuplicate,
  onDelete,
  onGroup,
  onUngroup,
  canGroup = false
}: PropertiesPanelProps) {
  if (selectedCount > 1) {
    const textCommon = commonTextStyle(selectedElements)
    const canUngroup = selectedElements.some((item) => item.type === 'group')
    const inputs = collectTextInputs(selectedElements)
    const horizontals = new Set(inputs.map(inputTextAlign))
    const verticals = new Set(inputs.map(inputVerticalAlign))
    return (
      <section className="panel">
        <h2>Selection</h2>
        <p className="panel-hint">
          {selectedCount} items selected.
          {textCommon
            ? ' Font, size, and alignment apply to every selected text box.'
            : ' Group them to lay out spacing and alignment together.'}
        </p>
        {textCommon && (
          <FontControls
            font={textCommon.font}
            sizePt={textCommon.sizePt}
            fontLibrary={fontLibrary}
            onFontChange={(font, libraryFont) =>
              onPatchTextStyles((style) => withTextFont(style, font, libraryFont))
            }
            onSizeChange={(sizePt) => onPatchTextStyles((style) => withTextSize(style, sizePt))}
            onSizeNudge={(delta) => onPatchTextStyles((style) => withTextSizeDelta(style, delta))}
          />
        )}
        {inputs.length > 0 && onPatchInputAlign && (
          <BoxAlignButtons
            textAlign={horizontals.size === 1 ? [...horizontals][0] : 'mixed'}
            verticalAlign={verticals.size === 1 ? [...verticals][0] : 'mixed'}
            onChange={onPatchInputAlign}
          />
        )}
        <div className="presets">
          <span className="presets-label">Align on label</span>
          <div className="preset-buttons">
            {(['left', 'centre', 'right', 'top', 'middle', 'bottom'] as Alignment[]).map((alignment) => (
              <IconButton
                key={alignment}
                name={
                  alignment === 'left'
                    ? 'alignLeft'
                    : alignment === 'centre'
                      ? 'alignHCenter'
                      : alignment === 'right'
                        ? 'alignRight'
                        : alignment === 'top'
                          ? 'alignTop'
                          : alignment === 'middle'
                            ? 'alignVCenter'
                            : 'alignBottom'
                }
                label={alignment[0].toUpperCase() + alignment.slice(1)}
                className="chip"
                onClick={() => onAlign(alignment, 'label')}
              />
            ))}
          </div>
        </div>
        <div className="field-row">
          <IconButton
            name={canGroup ? 'group' : 'ungroup'}
            label={canGroup ? 'Group selected' : 'Ungroup'}
            className="button"
            onClick={canGroup ? onGroup : onUngroup}
            disabled={!canGroup && !canUngroup}
          />
        </div>
      </section>
    )
  }

  if (!element) {
    return (
      <section className="panel">
        <h2>Properties</h2>
        <p className="panel-hint">
          Select something on the label to edit it. Click straight into a text element to
          retype it, drag a handle to resize, and use the bar above the selection for the
          quick controls.
        </p>
      </section>
    )
  }

  const groupedText = element.type === 'group' ? commonTextStyle([element]) : null
  const groupedInputs = element.type === 'group' ? collectTextInputs([element]) : []
  const extraAlign = element.type === 'group' ? extraAlignFor([element]) : []

  return (
    <section className="panel">
      <h2>{TITLES[element.type]}</h2>

      {element.type === 'text' && (
        <TextProperties element={element} fontLibrary={fontLibrary} onChange={onChange} />
      )}
      {element.type === 'line' && (
        <LineProperties element={element} media={media} onChange={onChange} />
      )}
      {element.type === 'image' && (
        <ImageProperties element={element} bitmap={bitmap} onChange={onChange} />
      )}
      {element.type === 'input' && (
        <InputProperties element={element} bitmap={bitmap} fontLibrary={fontLibrary} onChange={onChange} />
      )}
      {element.type === 'group' && (
        <>
          <GroupProperties element={element} onChange={onChange} />
          {groupedText && (
            <FontControls
              font={groupedText.font}
              sizePt={groupedText.sizePt}
              fontLibrary={fontLibrary}
              onFontChange={(font, libraryFont) =>
                onPatchTextStyles((style) => withTextFont(style, font, libraryFont))
              }
              onSizeChange={(sizePt) => onPatchTextStyles((style) => withTextSize(style, sizePt))}
              onSizeNudge={(delta) => onPatchTextStyles((style) => withTextSizeDelta(style, delta))}
            />
          )}
          {groupedInputs.length > 0 && onPatchInputAlign && (
            <BoxAlignButtons
              textAlign={
                new Set(groupedInputs.map(inputTextAlign)).size === 1
                  ? inputTextAlign(groupedInputs[0])
                  : 'mixed'
              }
              verticalAlign={
                new Set(groupedInputs.map(inputVerticalAlign)).size === 1
                  ? inputVerticalAlign(groupedInputs[0])
                  : 'mixed'
              }
              onChange={onPatchInputAlign}
            />
          )}
        </>
      )}

      <GeometryFields
        element={element}
        media={media}
        onChange={onChange}
        onAlign={onAlign}
        extraAlign={extraAlign}
      />

      {overflowsMedia(element, media) && (
        <p className="warning">This element runs past the padded label area and will be cut off.</p>
      )}

      <div className="field-row">
        {element.type === 'group' && (
          <IconButton name="ungroup" label="Ungroup" className="button ghost" onClick={onUngroup} />
        )}
        <IconButton name="duplicate" label="Duplicate" className="button ghost" onClick={onDuplicate} />
        <IconButton name="trash" label="Delete" className="button danger" onClick={onDelete} />
      </div>
    </section>
  )
}
