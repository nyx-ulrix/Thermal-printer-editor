import { anchorForBounds, elementBoundsMm, rotationPatch } from '../../lib/preview'
import type { AlignScope, Alignment } from '../../lib/snapping'
import type { ElementPatch, LabelElement, LabelMedia, Rotation } from '../../lib/types'
import { formatMm, roundMm } from '../../lib/units'
import { IconButton, type IconName } from '../Icon'
import NumberField from '../NumberField'

interface GeometryFieldsProps {
  element: LabelElement
  media: LabelMedia
  onChange: (patch: ElementPatch) => void
  onAlign: (alignment: Alignment, scope?: AlignScope) => void
  extraAlign?: Array<{ label: string; scope: Exclude<AlignScope, 'label'> }>
}

const ALIGNMENTS: Array<{ id: Alignment; label: string; icon: IconName }> = [
  { id: 'left', label: 'Left', icon: 'alignLeft' },
  { id: 'centre', label: 'Centre', icon: 'alignHCenter' },
  { id: 'right', label: 'Right', icon: 'alignRight' },
  { id: 'top', label: 'Top', icon: 'alignTop' },
  { id: 'middle', label: 'Middle', icon: 'alignVCenter' },
  { id: 'bottom', label: 'Bottom', icon: 'alignBottom' }
]

/**
 * Position, rotation and alignment, shared by every element type. X and Y describe the
 * box you see on the label rather than the raw anchor, which a rotation would otherwise
 * push somewhere unintuitive.
 */
export default function GeometryFields({
  element,
  media,
  onChange,
  onAlign,
  extraAlign = []
}: GeometryFieldsProps) {
  const bounds = elementBoundsMm(element)

  return (
    <>
      <div className="field-row">
        <NumberField
          label="X (mm)"
          value={roundMm(bounds.xMm, 1)}
          min={-media.widthMm}
          max={media.widthMm}
          step={0.1}
          onCommit={(xMm) => onChange(anchorForBounds(element, xMm, bounds.yMm))}
        />
        <NumberField
          label="Y (mm)"
          value={roundMm(bounds.yMm, 1)}
          min={-media.heightMm}
          max={media.heightMm}
          step={0.1}
          onCommit={(yMm) => onChange(anchorForBounds(element, bounds.xMm, yMm))}
        />
      </div>

      <NumberField
        label="Rotation (deg)"
        value={roundMm(element.rotation, 0)}
        min={0}
        max={359}
        step={1}
        onCommit={(rotation) => onChange(rotationPatch(element, rotation as Rotation))}
      />

      <div className="presets">
        <span className="presets-label">Align on label</span>
        <div className="preset-buttons">
          {ALIGNMENTS.map((alignment) => (
            <IconButton
              key={alignment.id}
              name={alignment.icon}
              label={alignment.label}
              className="chip"
              onClick={() => onAlign(alignment.id, 'label')}
            />
          ))}
        </div>
      </div>

      {extraAlign.map((row) => (
        <div className="presets" key={row.scope}>
          <span className="presets-label">{row.label}</span>
          <div className="preset-buttons">
            {ALIGNMENTS.map((alignment) => (
              <IconButton
                key={alignment.id}
                name={alignment.icon}
                label={alignment.label}
                className="chip"
                onClick={() => onAlign(alignment.id, row.scope)}
              />
            ))}
          </div>
        </div>
      ))}

      <p className="panel-hint">
        Occupies {formatMm(bounds.widthMm, 1)} x {formatMm(bounds.heightMm, 1)} mm on the label.
      </p>
    </>
  )
}
