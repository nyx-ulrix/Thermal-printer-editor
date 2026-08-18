import { isContinuous, matchingMediaPreset, type MediaPreset } from '../lib/media'
import { mediaPadding } from '../lib/padding'
import type { LabelMedia, MediaStock, PrintDirection } from '../lib/types'
import { formatMm, isOverPrintWidth, MAX_PRINT_WIDTH_MM } from '../lib/units'
import CollapsiblePanel from './CollapsiblePanel'
import NumberField from './NumberField'
import PaddingFields from './PaddingFields'

interface MediaPanelProps {
  media: LabelMedia
  presets: MediaPreset[]
  onChange: (patch: Partial<LabelMedia>) => void
}

const STOCK: Array<{ id: MediaStock; label: string }> = [
  { id: 'labels', label: 'Labels' },
  { id: 'continuous', label: 'Continuous' }
]

export default function MediaPanel({ media, presets, onChange }: MediaPanelProps) {
  const continuous = isContinuous(media)
  const summary = continuous
    ? `${formatMm(media.widthMm)} x ${formatMm(media.heightMm)} mm continuous`
    : `${formatMm(media.widthMm)} x ${formatMm(media.heightMm)} mm`

  function setStock(stock: MediaStock) {
    if (stock === 'continuous') {
      onChange({ stock, dieCut: false, gapMm: 0 })
      return
    }
    onChange({
      stock,
      gapMm: media.gapMm > 0 ? media.gapMm : 2
    })
  }

  return (
    <CollapsiblePanel
      title="Media"
      summary={summary}
      storageKey="media"
      defaultOpen={false}
    >
      <p className="panel-hint">
        {continuous
          ? 'Continuous paper uses TSPL GAP 0,0, so the printer feeds the print length instead of hunting for a label gap.'
          : 'These values are sent with every job as TSPL SIZE and GAP, so Windows printer preferences do not need to match.'}
      </p>

      <div className="presets">
        <span className="presets-label">Stock</span>
        <div className="preset-buttons">
          {STOCK.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`chip${media.stock === option.id ? ' is-active' : ''}`}
              onClick={() => setStock(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <NumberField
          label="Width (mm)"
          value={media.widthMm}
          min={5}
          max={120}
          step={0.1}
          onCommit={(widthMm) => onChange({ widthMm })}
        />
        <NumberField
          label={continuous ? 'Print length (mm)' : 'Height (mm)'}
          value={media.heightMm}
          min={5}
          max={continuous ? 500 : 300}
          step={0.1}
          title={
            continuous
              ? 'How much paper feeds for each copy.'
              : undefined
          }
          onCommit={(heightMm) => onChange({ heightMm })}
        />
      </div>

      {isOverPrintWidth(media.widthMm) && (
        <p className="warning">
          The GP-3120TL images at most {MAX_PRINT_WIDTH_MM} mm wide. Anything past that edge
          will be cut off.
        </p>
      )}

      <div className="field-row">
        {!continuous && (
          <NumberField
            label="Gap (mm)"
            value={media.gapMm}
            min={0}
            max={20}
            step={0.1}
            onCommit={(gapMm) => onChange({ gapMm })}
          />
        )}
        <NumberField
          label="Density"
          value={media.density}
          min={0}
          max={15}
          step={1}
          title="0 is lightest, 15 is darkest."
          onCommit={(density) => onChange({ density })}
        />
      </div>

      <div className="field-row">
        <label className="field">
          <span>Speed (in/s)</span>
          <select
            value={media.speed}
            onChange={(event) => onChange({ speed: Number(event.target.value) })}
          >
            {[2, 3, 4, 5].map((speed) => (
              <option key={speed} value={speed}>
                {speed}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Direction</span>
          <select
            value={media.direction}
            onChange={(event) =>
              onChange({ direction: Number(event.target.value) as PrintDirection })
            }
          >
            <option value={0}>0</option>
            <option value={1}>1</option>
          </select>
        </label>
      </div>

      {!continuous && (
        <>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={media.dieCut}
              onChange={(event) => onChange({ dieCut: event.currentTarget.checked })}
            />
            <span>Die-cut stock (rounded corners)</span>
          </label>

          {media.dieCut && (
            <>
              <NumberField
                label="Corner radius (mm)"
                value={media.cornerRadiusMm}
                min={0}
                max={12}
                step={0.5}
                onCommit={(cornerRadiusMm) => onChange({ cornerRadiusMm })}
              />
              <p className="panel-hint">
                The rounded corners are the shape of the paper, not something the printer draws.
                Anything you place in a corner is clipped in the preview because the stock is
                already cut away there.
              </p>
            </>
          )}
        </>
      )}

      <span className="presets-label">Padding</span>
      <PaddingFields
        value={mediaPadding(media)}
        onChange={(padding) => onChange({ padding })}
      />
      <p className="panel-hint">
        Padding keeps content away from the {continuous ? 'paper' : 'label'} edges. Alignment
        and snapping use this inner area.
      </p>

      <div className="presets">
        <span className="presets-label">Presets</span>
        <div className="preset-buttons">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`chip${matchingMediaPreset(media.widthMm, media.heightMm, presets)?.id === preset.id ? ' is-active' : ''}`}
              onClick={() => onChange({ widthMm: preset.widthMm, heightMm: preset.heightMm })}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    </CollapsiblePanel>
  )
}
