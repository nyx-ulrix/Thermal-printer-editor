import type { TextAlign, VerticalAlign } from '../lib/types'
import { IconButton, type IconName } from './Icon'

interface BoxAlignButtonsProps {
  textAlign: TextAlign | 'mixed'
  verticalAlign: VerticalAlign | 'mixed'
  onChange: (patch: { textAlign?: TextAlign; verticalAlign?: VerticalAlign }) => void
  compact?: boolean
}

const HORIZONTAL: Array<{ id: TextAlign; label: string; icon: IconName }> = [
  { id: 'left', label: 'Left', icon: 'alignLeft' },
  { id: 'center', label: 'Centre', icon: 'alignHCenter' },
  { id: 'right', label: 'Right', icon: 'alignRight' }
]

const VERTICAL: Array<{ id: VerticalAlign; label: string; icon: IconName }> = [
  { id: 'top', label: 'Top', icon: 'alignTop' },
  { id: 'middle', label: 'Middle', icon: 'alignVCenter' },
  { id: 'bottom', label: 'Bottom', icon: 'alignBottom' }
]

export default function BoxAlignButtons({
  textAlign,
  verticalAlign,
  onChange,
  compact = false
}: BoxAlignButtonsProps) {
  const buttonClass = compact ? 'mini-button' : 'chip'

  return (
    <div className={`box-align${compact ? ' is-compact' : ''}`}>
      <div className="preset-buttons" role="group" aria-label="Horizontal alignment">
        {HORIZONTAL.map((option) => (
          <IconButton
            key={option.id}
            name={option.icon}
            label={`${option.label} align`}
            className={`${buttonClass}${textAlign === option.id ? ' is-active' : ''}`}
            onClick={() => onChange({ textAlign: option.id })}
          />
        ))}
      </div>
      <div className="preset-buttons" role="group" aria-label="Vertical alignment">
        {VERTICAL.map((option) => (
          <IconButton
            key={option.id}
            name={option.icon}
            label={`${option.label} align`}
            className={`${buttonClass}${verticalAlign === option.id ? ' is-active' : ''}`}
            onClick={() => onChange({ verticalAlign: option.id })}
          />
        ))}
      </div>
    </div>
  )
}
