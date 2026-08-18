import type { LabelMedia, LineElement } from '../../lib/types'
import { formatMm, getDotsPerMm, getDpi } from '../../lib/units'
import NumberField from '../NumberField'

interface LinePropertiesProps {
  element: LineElement
  media: LabelMedia
  onChange: (patch: Partial<LineElement>) => void
}

export default function LineProperties({ element, media, onChange }: LinePropertiesProps) {
  const maxLength = Math.max(Math.max(media.widthMm, media.heightMm), 300)

  return (
    <>
      <div className="field-row">
        <NumberField
          label="Length (mm)"
          value={element.lengthMm}
          min={0.5}
          max={maxLength}
          step={0.5}
          onCommit={(lengthMm) => onChange({ lengthMm })}
        />
        <NumberField
          label="Thickness (mm)"
          value={element.thicknessMm}
          min={0.125}
          max={12}
          step={0.125}
          title="One dot is 0.125 mm. Thick solid bars beyond 12 mm are discouraged by the manual."
          onCommit={(thicknessMm) => onChange({ thicknessMm })}
        />
      </div>

      <p className="panel-hint">
        Lines are drawn as solid rectangles on the printer. Arbitrary angles are shown in the
        editor and, when needed, printed through the bitmap fallback so the output matches the
        preview. One dot is {formatMm(1 / getDotsPerMm(), 3)} mm at {getDpi()} DPI.
      </p>
    </>
  )
}
