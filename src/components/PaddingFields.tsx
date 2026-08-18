import type { BoxPadding } from '../lib/types'
import NumberField from './NumberField'

interface PaddingFieldsProps {
  value: BoxPadding
  onChange: (padding: BoxPadding) => void
}

export default function PaddingFields({ value, onChange }: PaddingFieldsProps) {
  return (
    <>
      <div className="field-row">
        <NumberField
          label="Pad top (mm)"
          value={value.topMm}
          min={0}
          max={40}
          step={0.5}
          onCommit={(topMm) => onChange({ ...value, topMm })}
        />
        <NumberField
          label="Pad bottom (mm)"
          value={value.bottomMm}
          min={0}
          max={40}
          step={0.5}
          onCommit={(bottomMm) => onChange({ ...value, bottomMm })}
        />
      </div>
      <div className="field-row">
        <NumberField
          label="Pad left (mm)"
          value={value.leftMm}
          min={0}
          max={40}
          step={0.5}
          onCommit={(leftMm) => onChange({ ...value, leftMm })}
        />
        <NumberField
          label="Pad right (mm)"
          value={value.rightMm}
          min={0}
          max={40}
          step={0.5}
          onCommit={(rightMm) => onChange({ ...value, rightMm })}
        />
      </div>
    </>
  )
}
