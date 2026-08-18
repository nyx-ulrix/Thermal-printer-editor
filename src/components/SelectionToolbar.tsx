import { useEffect, useState } from 'react'
import BoxAlignButtons from './BoxAlignButtons'
import FontControls from './FontControls'
import { inputTextAlign, inputVerticalAlign } from '../lib/fields'
import { commonTextStyle, withTextFont, withTextSize, withTextSizeDelta } from '../lib/fontSize'
import { collectImages, collectTextInputs } from '../lib/tree'
import type { AlignScope, Alignment } from '../lib/snapping'
import type {
  ElementPatch,
  FontLibraryItem,
  GroupAlign,
  GroupDirection,
  GroupJustify,
  LabelElement,
  TextAlign,
  TextStyle,
  VerticalAlign
} from '../lib/types'
import { clamp, formatMm, roundMm } from '../lib/units'
import { IconButton, type IconName } from './Icon'

interface SelectionToolbarProps {
  element: LabelElement
  selectedElements: LabelElement[]
  selectedCount: number
  fontLibrary: FontLibraryItem[]
  onChange: (patch: ElementPatch) => void
  onPatchTextStyles: (mutate: (style: TextStyle) => TextStyle) => void
  onPatchInputAlign?: (patch: { textAlign?: TextAlign; verticalAlign?: VerticalAlign }) => void
  onAlign: (alignment: Alignment, scope?: AlignScope) => void
  onRotate: () => void
  onDuplicate: () => void
  onDelete: () => void
  onLayer: (position: 'front' | 'back') => void
  onGroup: () => void
  onUngroup: () => void
  canGroup?: boolean
}

const ALIGNMENTS: Array<{ id: Alignment; label: string; icon: IconName }> = [
  { id: 'left', label: 'Left', icon: 'alignLeft' },
  { id: 'centre', label: 'Centre', icon: 'alignHCenter' },
  { id: 'right', label: 'Right', icon: 'alignRight' },
  { id: 'top', label: 'Top', icon: 'alignTop' },
  { id: 'middle', label: 'Middle', icon: 'alignVCenter' },
  { id: 'bottom', label: 'Bottom', icon: 'alignBottom' }
]

function commonBoxAlign(elements: LabelElement[]): {
  textAlign: TextAlign | 'mixed'
  verticalAlign: VerticalAlign | 'mixed'
} | null {
  const inputs = collectTextInputs(elements)
  if (inputs.length === 0) return null
  const horizontals = new Set(inputs.map(inputTextAlign))
  const verticals = new Set(inputs.map(inputVerticalAlign))
  return {
    textAlign: horizontals.size === 1 ? [...horizontals][0] : 'mixed',
    verticalAlign: verticals.size === 1 ? [...verticals][0] : 'mixed'
  }
}

function AlignRow({
  alignments,
  onPick
}: {
  alignments: typeof ALIGNMENTS
  onPick: (alignment: Alignment) => void
}) {
  return (
    <div className="mini-popover-row">
      {alignments.map((alignment) => (
        <IconButton
          key={alignment.id}
          name={alignment.icon}
          label={alignment.label}
          className="mini-button"
          onClick={() => onPick(alignment.id)}
        />
      ))}
    </div>
  )
}

export default function SelectionToolbar({
  element,
  selectedElements,
  selectedCount,
  fontLibrary,
  onChange,
  onPatchTextStyles,
  onPatchInputAlign,
  onAlign,
  onRotate,
  onDuplicate,
  onDelete,
  onLayer,
  onGroup,
  onUngroup,
  canGroup = false
}: SelectionToolbarProps) {
  const [alignOpen, setAlignOpen] = useState(false)

  useEffect(() => setAlignOpen(false), [element.id])

  const textCommon = commonTextStyle(selectedElements)
  const boxAlign = commonBoxAlign(selectedElements)
  const images = collectImages(selectedElements)
  const hasGroup = selectedElements.some((item) => item.type === 'group')
  const canUngroup = hasGroup
  const showInnerTextAlign = Boolean(textCommon) && (hasGroup || images.length > 0 || selectedCount > 1)
  const showInnerImageAlign = images.length > 0 && (hasGroup || Boolean(textCommon) || selectedCount > 1)

  return (
    <div className="selection-toolbar is-docked" onPointerDown={(event) => event.stopPropagation()}>
      <IconButton
        name={canGroup ? 'group' : 'ungroup'}
        label={
          canGroup
            ? `Group ${selectedCount} items`
            : canUngroup
              ? 'Ungroup'
              : 'Select two or more items to group'
        }
        className={`mini-button${canGroup || canUngroup ? ' is-active' : ''}`}
        disabled={!canGroup && !canUngroup}
        onClick={() => (canGroup ? onGroup() : onUngroup())}
      />

      {textCommon && (
        <FontControls
          compact
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

      {boxAlign && onPatchInputAlign && (
        <BoxAlignButtons
          compact
          textAlign={boxAlign.textAlign}
          verticalAlign={boxAlign.verticalAlign}
          onChange={onPatchInputAlign}
        />
      )}

      {element.type === 'group' && selectedCount === 1 && (
        <>
          <IconButton
            name="layoutRow"
            label="Row"
            className={`mini-button${element.direction === 'row' && !element.freeform ? ' is-active' : ''}`}
            onClick={() => onChange({ direction: 'row' as GroupDirection, freeform: false })}
          />
          <IconButton
            name="layoutColumn"
            label="Column"
            className={`mini-button${element.direction === 'column' && !element.freeform ? ' is-active' : ''}`}
            onClick={() => onChange({ direction: 'column' as GroupDirection, freeform: false })}
          />
          <div className="mini-stepper" title="Space between items">
            <IconButton
              name="minus"
              label="Decrease gap"
              onClick={() => onChange({ gapMm: clamp(element.gapMm - 0.5, 0, 40), freeform: false })}
            />
            <span>gap {formatMm(element.gapMm, 1)} mm</span>
            <IconButton
              name="plus"
              label="Increase gap"
              onClick={() => onChange({ gapMm: clamp(element.gapMm + 0.5, 0, 40), freeform: false })}
            />
          </div>
          <IconButton
            name="justifyStart"
            label="Start"
            className={`mini-button${element.justify === 'start' && !element.freeform ? ' is-active' : ''}`}
            onClick={() => onChange({ justify: 'start' as GroupJustify, freeform: false })}
          />
          <IconButton
            name="justifyCenter"
            label="Centre"
            className={`mini-button${element.justify === 'center' && !element.freeform ? ' is-active' : ''}`}
            onClick={() => onChange({ justify: 'center' as GroupJustify, freeform: false })}
          />
          <IconButton
            name="justifyEnd"
            label="End"
            className={`mini-button${element.justify === 'end' && !element.freeform ? ' is-active' : ''}`}
            onClick={() => onChange({ justify: 'end' as GroupJustify, freeform: false })}
          />
          <IconButton
            name="justifySpread"
            label="Spread"
            className={`mini-button${element.justify === 'space-between' && !element.freeform ? ' is-active' : ''}`}
            onClick={() => onChange({ justify: 'space-between' as GroupJustify, freeform: false })}
          />
          <IconButton
            name={element.align === 'center' ? 'alignCrossCenter' : 'alignCrossStart'}
            label={element.align === 'center' ? 'Cross centre' : 'Cross start'}
            className="mini-button"
            onClick={() =>
              onChange({
                align: (element.align === 'center' ? 'start' : 'center') as GroupAlign,
                freeform: false
              })
            }
          />
        </>
      )}

      {element.type === 'line' && (
        <div className="mini-stepper" title="Thickness in millimetres">
          <IconButton
            name="minus"
            label="Thinner"
            onClick={() =>
              onChange({ thicknessMm: roundMm(clamp(element.thicknessMm - 0.125, 0.125, 12), 3) })
            }
          />
          <span>{formatMm(element.thicknessMm, 3)} mm</span>
          <IconButton
            name="plus"
            label="Thicker"
            onClick={() =>
              onChange({ thicknessMm: roundMm(clamp(element.thicknessMm + 0.125, 0.125, 12), 3) })
            }
          />
        </div>
      )}

      {element.type === 'image' && (
        <>
          <div className="mini-stepper" title="Resize the image while keeping its aspect ratio">
            <IconButton
              name="minus"
              label="Smaller"
              onClick={() =>
                onChange({
                  widthMm: clamp(element.widthMm - 1, 2, 300),
                  heightMm: roundMm(clamp(element.widthMm - 1, 2, 300) / (element.aspectRatio || 1), 2)
                })
              }
            />
            <span>{formatMm(element.widthMm, 1)} mm</span>
            <IconButton
              name="plus"
              label="Larger"
              onClick={() =>
                onChange({
                  widthMm: clamp(element.widthMm + 1, 2, 300),
                  heightMm: roundMm(clamp(element.widthMm + 1, 2, 300) / (element.aspectRatio || 1), 2)
                })
              }
            />
          </div>
          <div className="mini-stepper" title="Black and white threshold">
            <IconButton
              name="minus"
              label="Lower threshold"
              onClick={() => onChange({ threshold: clamp(element.threshold - 8, 1, 254) })}
            />
            <span>{element.threshold}</span>
            <IconButton
              name="plus"
              label="Higher threshold"
              onClick={() => onChange({ threshold: clamp(element.threshold + 8, 1, 254) })}
            />
          </div>
          <IconButton
            name="dither"
            label="Dither, better for photos"
            className={`mini-button${element.dither ? ' is-active' : ''}`}
            onClick={() => onChange({ dither: !element.dither })}
          />
          <IconButton
            name="invert"
            label="Invert black and white"
            className={`mini-button${element.invert ? ' is-active' : ''}`}
            onClick={() => onChange({ invert: !element.invert })}
          />
        </>
      )}

      {element.type === 'input' && (
        <>
          <div className="mini-stepper" title="Resize the input box">
            <IconButton
              name="minus"
              label="Smaller"
              onClick={() =>
                onChange({
                  widthMm: clamp(element.widthMm - 1, 2, 300),
                  heightMm: clamp(element.heightMm - 1, 2, 300)
                })
              }
            />
            <span>
              {formatMm(element.widthMm, 1)} &times; {formatMm(element.heightMm, 1)} mm
            </span>
            <IconButton
              name="plus"
              label="Larger"
              onClick={() =>
                onChange({
                  widthMm: clamp(element.widthMm + 1, 2, 300),
                  heightMm: clamp(element.heightMm + 1, 2, 300)
                })
              }
            />
          </div>
        </>
      )}

      <span className="mini-divider" />

      <div className="mini-align">
        <IconButton
          name="alignHCenter"
          label="Align"
          className={`mini-button${alignOpen ? ' is-active' : ''}`}
          onClick={() => setAlignOpen((open) => !open)}
        />
        {alignOpen && (
          <div className="mini-popover">
            <span className="mini-popover-label">On label</span>
            <AlignRow alignments={ALIGNMENTS} onPick={(alignment) => {
              onAlign(alignment, 'label')
              setAlignOpen(false)
            }} />
            {showInnerTextAlign && (
              <>
                <span className="mini-popover-divider" />
                <span className="mini-popover-label">Text</span>
                <AlignRow alignments={ALIGNMENTS} onPick={(alignment) => {
                  onAlign(alignment, 'text')
                  setAlignOpen(false)
                }} />
              </>
            )}
            {showInnerImageAlign && (
              <>
                <span className="mini-popover-divider" />
                <span className="mini-popover-label">Images</span>
                <AlignRow alignments={ALIGNMENTS} onPick={(alignment) => {
                  onAlign(alignment, 'image')
                  setAlignOpen(false)
                }} />
              </>
            )}
            <span className="mini-popover-divider" />
            <IconButton
              name="bringFront"
              label="Bring to front"
              className="mini-button"
              onClick={() => onLayer('front')}
            />
            <IconButton
              name="sendBack"
              label="Send to back"
              className="mini-button"
              onClick={() => onLayer('back')}
            />
          </div>
        )}
      </div>

      <IconButton
        name="rotate"
        label={`Rotate by 15 degrees, now at ${formatMm(element.rotation, 0)} degrees`}
        className="mini-button"
        onClick={onRotate}
      />
      <IconButton name="duplicate" label="Duplicate" className="mini-button" onClick={onDuplicate} />
      <IconButton
        name="trash"
        label="Delete this element"
        className="mini-button is-danger"
        onClick={onDelete}
      />
    </div>
  )
}
