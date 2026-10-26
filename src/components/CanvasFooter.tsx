import { isContinuous } from '../lib/media'
import type { LabelMedia } from '../lib/types'
import { clamp, formatMm } from '../lib/units'
import { IconButton } from './Icon'
import type { CanvasMode } from './LabelCanvas'

interface CanvasFooterProps {
  media: LabelMedia
  zoom: number
  mode: CanvasMode
  converting: boolean
  /** Lower zoom bound; phones go below 1 so a wide label fits the screen. */
  minZoom?: number
  onZoomChange: (zoom: number) => void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 6

export default function CanvasFooter({
  media,
  zoom,
  mode,
  converting,
  minZoom = MIN_ZOOM,
  onZoomChange
}: CanvasFooterProps) {
  const continuous = isContinuous(media)
  const step = (delta: number) =>
    onZoomChange(Number(clamp(zoom + delta, minZoom, MAX_ZOOM).toFixed(1)))

  return (
    <footer className="canvas-footer">
      <span className="canvas-facts">
        {formatMm(media.widthMm)} &times; {formatMm(media.heightMm)} mm
        <span className="dot-divider">&middot;</span>
        {continuous ? (
          'continuous'
        ) : (
          <>
            gap {formatMm(media.gapMm)} mm
            {media.dieCut && (
              <>
                <span className="dot-divider">&middot;</span>
                die-cut r{formatMm(media.cornerRadiusMm)} mm
              </>
            )}
          </>
        )}
      </span>

      <span className="canvas-hint">
        {converting
          ? 'Converting images...'
          : mode === 'line'
            ? `Drag across the ${continuous ? 'paper' : 'label'} to draw a line`
            : 'Click text to edit, drag to move, drag a handle to resize'}
      </span>

      <div className="zoom-control">
        <IconButton name="minus" label="Zoom out" className="mini-button" onClick={() => step(-0.5)} />
        <input
          type="range"
          min={minZoom}
          max={MAX_ZOOM}
          step={0.5}
          value={zoom}
          aria-label="Preview zoom"
          onChange={(event) => onZoomChange(Number(event.target.value))}
        />
        <IconButton name="plus" label="Zoom in" className="mini-button" onClick={() => step(0.5)} />
        <span className="zoom-value">{Math.round(zoom * 100)}%</span>
      </div>
    </footer>
  )
}
