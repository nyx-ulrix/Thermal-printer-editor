import type { FontLibraryItem, TsplFontId } from '../lib/types'
import { findLibraryFont, fontSelectGroups } from '../lib/fontSize'
import { handleSelectAllOnFocus, handleSelectAllOnMouseUp } from '../lib/inputSelection'
import { IconButton } from './Icon'

interface FontControlsProps {
  font: TsplFontId | 'mixed'
  sizePt: number | 'mixed'
  fontLibrary: FontLibraryItem[]
  compact?: boolean
  onFontChange: (font: TsplFontId, libraryFont?: FontLibraryItem) => void
  onSizeChange: (sizePt: number) => void
  /** Plus/minus: change each selected item from its own size. */
  onSizeNudge: (delta: number) => void
}

export default function FontControls({
  font,
  sizePt,
  fontLibrary,
  compact = false,
  onFontChange,
  onSizeChange,
  onSizeNudge
}: FontControlsProps) {
  const groups = fontSelectGroups(fontLibrary)
  const options = groups.flatMap((group) => group.options)
  const hasCurrent = font === 'mixed' || options.some((option) => option.id === font)
  const sizeValue = sizePt === 'mixed' ? '' : String(sizePt)

  const fontSelect = (
    <select
      className={compact ? 'mini-select' : undefined}
      title="Font"
      aria-label="Font"
      value={font === 'mixed' ? '' : font}
      onChange={(event) => {
        const next = event.target.value as TsplFontId
        if (!next) return
        onFontChange(next, findLibraryFont(next, fontLibrary))
      }}
    >
      {font === 'mixed' && <option value="">Mixed</option>}
      {!hasCurrent && font !== 'mixed' && <option value={font}>{font}</option>}
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )

  const sizeStepper = (
    <div className={compact ? 'mini-stepper' : 'size-stepper'} title="Font size in points">
      <IconButton name="minus" label="Smaller" onClick={() => onSizeNudge(-1)} />
      <input
        className={compact ? 'mini-size' : 'size-stepper-input'}
        type="number"
        min={1}
        max={400}
        step={1}
        value={sizeValue}
        placeholder={sizePt === 'mixed' ? 'Mixed' : undefined}
        aria-label="Font size in points"
        onChange={(event) => {
          if (event.target.value === '') return
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onSizeChange(next)
        }}
        onFocus={handleSelectAllOnFocus}
        onMouseUp={handleSelectAllOnMouseUp}
      />
      <IconButton name="plus" label="Larger" onClick={() => onSizeNudge(1)} />
    </div>
  )

  if (compact) {
    return (
      <div className="font-fields is-compact">
        <label className="mini-field">
          <span className="mini-field-label">Font</span>
          {fontSelect}
        </label>
        <label className="mini-field">
          <span className="mini-field-label">Size</span>
          {sizeStepper}
        </label>
      </div>
    )
  }

  return (
    <div className="field-row font-fields">
      <label className="field">
        <span>Font</span>
        {fontSelect}
      </label>
      <label className="field">
        <span>Size (pt)</span>
        {sizeStepper}
      </label>
    </div>
  )
}
