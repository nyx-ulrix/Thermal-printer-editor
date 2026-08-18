import { useEffect, useState } from 'react'
import { handleSelectAllOnFocus, handleSelectAllOnMouseUp } from '../lib/inputSelection'
import { clamp } from '../lib/units'

interface NumberFieldProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  title?: string
  /** Lets the same field sit in the top bar, where the label styling differs. */
  className?: string
  onCommit: (value: number) => void
}

/**
 * A numeric input that lets you type freely. Values are applied as soon as they parse and
 * only clamped to the allowed range on blur, so typing "12" into a field that maxes out at
 * 10 does not fight the keyboard. An empty box stays empty while you retype rather than
 * snapping back to the old value.
 */
export default function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  title,
  className = 'field',
  onCommit
}: NumberFieldProps) {
  const [draft, setDraft] = useState(() => String(value))

  useEffect(() => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed) || parsed !== value) setDraft(String(value))
    // Re-syncing on `draft` would overwrite partial input such as "1." while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <label className={className} title={title}>
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          setDraft(event.target.value)
          const parsed = Number(event.target.value)
          if (event.target.value !== '' && Number.isFinite(parsed)) onCommit(parsed)
        }}
        onFocus={handleSelectAllOnFocus}
        onMouseUp={handleSelectAllOnMouseUp}
        onBlur={() => {
          const parsed = Number(draft)
          const next = clamp(Number.isFinite(parsed) ? parsed : min, min, max)
          setDraft(String(next))
          onCommit(next)
        }}
      />
    </label>
  )
}
