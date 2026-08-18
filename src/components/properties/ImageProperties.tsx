import type { MonoBitmap } from '../../lib/imageMono'
import type { ImageElement } from '../../lib/types'
import { roundMm } from '../../lib/units'
import NumberField from '../NumberField'

interface ImagePropertiesProps {
  element: ImageElement
  bitmap: MonoBitmap | undefined
  onChange: (patch: Partial<ImageElement>) => void
}

export default function ImageProperties({ element, bitmap, onChange }: ImagePropertiesProps) {
  const aspectRatio = element.aspectRatio || 1

  return (
    <>
      <p className="panel-hint">{element.name}</p>

      <div className="field-row">
        <NumberField
          label="Width (mm)"
          value={element.widthMm}
          min={2}
          max={300}
          step={0.5}
          onCommit={(widthMm) =>
            onChange({ widthMm, heightMm: roundMm(widthMm / aspectRatio) })
          }
        />
        <NumberField
          label="Height (mm)"
          value={element.heightMm}
          min={2}
          max={300}
          step={0.5}
          onCommit={(heightMm) =>
            onChange({ heightMm, widthMm: roundMm(heightMm * aspectRatio) })
          }
        />
      </div>
      <p className="panel-hint">Width and height stay proportional to the imported file.</p>

      <NumberField
        label="Threshold"
        value={element.threshold}
        min={1}
        max={254}
        step={1}
        title="Pixels darker than this print black. Also the pivot when dithering."
        onCommit={(threshold) => onChange({ threshold })}
      />
      <input
        type="range"
        min={1}
        max={254}
        step={1}
        value={element.threshold}
        onChange={(event) => onChange({ threshold: Number(event.target.value) })}
      />

      <label className="checkbox">
        <input
          type="checkbox"
          checked={element.dither}
          onChange={(event) => onChange({ dither: event.target.checked })}
        />
        <span>Dither (better for photos)</span>
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={element.invert}
          onChange={(event) => onChange({ invert: event.target.checked })}
        />
        <span>Invert black and white</span>
      </label>

      {bitmap && (
        <p className="panel-hint">
          Prints as {bitmap.widthDots} x {bitmap.heightDots} dots,{' '}
          {(bitmap.bytes.length / 1024).toFixed(1)} KB of bitmap data. Rotation is baked into
          this raster because BITMAP has no rotation of its own.
        </p>
      )}
    </>
  )
}
