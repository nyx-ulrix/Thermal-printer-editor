import type { GroupAlign, GroupDirection, GroupElement, GroupJustify } from '../../lib/types'
import { IconButton, type IconName } from '../Icon'
import NumberField from '../NumberField'
import PaddingFields from '../PaddingFields'

interface GroupPropertiesProps {
  element: GroupElement
  onChange: (patch: Partial<GroupElement>) => void
}

const DIRECTIONS: Array<{ id: GroupDirection; label: string; icon: IconName }> = [
  { id: 'row', label: 'Horizontal', icon: 'layoutRow' },
  { id: 'column', label: 'Vertical', icon: 'layoutColumn' }
]

const JUSTIFY: Array<{ id: GroupJustify; label: string; icon: IconName }> = [
  { id: 'start', label: 'Start', icon: 'justifyStart' },
  { id: 'center', label: 'Centre', icon: 'justifyCenter' },
  { id: 'end', label: 'End', icon: 'justifyEnd' },
  { id: 'space-between', label: 'Space between', icon: 'justifySpread' }
]

const ALIGN: Array<{ id: GroupAlign; label: string; icon: IconName }> = [
  { id: 'start', label: 'Start', icon: 'alignCrossStart' },
  { id: 'center', label: 'Centre', icon: 'alignCrossCenter' },
  { id: 'end', label: 'End', icon: 'alignCrossEnd' }
]

export default function GroupProperties({ element, onChange }: GroupPropertiesProps) {
  return (
    <>
      <p className="panel-hint">
        Children stay inside this box. Change direction, gap, and alignment to lay them out like a
        flex container.
      </p>
      <div className="field-row">
        <NumberField
          label="Width (mm)"
          value={element.widthMm}
          min={4}
          max={300}
          step={0.5}
          onCommit={(widthMm) => onChange({ widthMm })}
        />
        <NumberField
          label="Height (mm)"
          value={element.heightMm}
          min={4}
          max={300}
          step={0.5}
          onCommit={(heightMm) => onChange({ heightMm })}
        />
      </div>
      <NumberField
        label="Gap (mm)"
        value={element.gapMm}
        min={0}
        max={40}
        step={0.5}
        title="Space between items along the layout direction"
        onCommit={(gapMm) => onChange({ gapMm, freeform: false })}
      />

      <div className="presets">
        <span className="presets-label">Direction</span>
        <div className="preset-buttons">
          {DIRECTIONS.map((option) => (
            <IconButton
              key={option.id}
              name={option.icon}
              label={option.label}
              className={`chip${element.direction === option.id ? ' is-active' : ''}`}
              onClick={() => onChange({ direction: option.id, freeform: false })}
            />
          ))}
        </div>
      </div>

      <div className="presets">
        <span className="presets-label">Align on axis</span>
        <div className="preset-buttons">
          {JUSTIFY.map((option) => (
            <IconButton
              key={option.id}
              name={option.icon}
              label={option.label}
              className={`chip${element.justify === option.id ? ' is-active' : ''}`}
              onClick={() => onChange({ justify: option.id, freeform: false })}
            />
          ))}
        </div>
      </div>

      <div className="presets">
        <span className="presets-label">Align across</span>
        <div className="preset-buttons">
          {ALIGN.map((option) => (
            <IconButton
              key={option.id}
              name={option.icon}
              label={option.label}
              className={`chip${element.align === option.id ? ' is-active' : ''}`}
              onClick={() => onChange({ align: option.id, freeform: false })}
            />
          ))}
        </div>
      </div>

      <span className="presets-label">Padding</span>
      <PaddingFields value={element.padding} onChange={(padding) => onChange({ padding })} />
    </>
  )
}
