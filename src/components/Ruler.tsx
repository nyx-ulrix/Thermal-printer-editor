import { formatMm } from '../lib/units'

export interface RulerHighlight {
  startMm: number
  endMm: number
}

interface RulerProps {
  orientation: 'horizontal' | 'vertical'
  lengthMm: number
  pxPerMm: number
  /** Extent of the current selection along this axis, shaded on the ruler. */
  highlight: RulerHighlight | null
}

/** Tick spacing that stays readable as the zoom changes. */
function tickSteps(pxPerMm: number): { minorMm: number; majorMm: number } {
  if (pxPerMm >= 12) return { minorMm: 1, majorMm: 5 }
  if (pxPerMm >= 6) return { minorMm: 1, majorMm: 10 }
  return { minorMm: 5, majorMm: 10 }
}

export default function Ruler({ orientation, lengthMm, pxPerMm, highlight }: RulerProps) {
  const { minorMm, majorMm } = tickSteps(pxPerMm)
  const horizontal = orientation === 'horizontal'
  const lengthPx = lengthMm * pxPerMm

  const ticks: Array<{ positionMm: number; major: boolean }> = []
  for (let positionMm = 0; positionMm <= lengthMm + 0.001; positionMm += minorMm) {
    const rounded = Number(positionMm.toFixed(3))
    ticks.push({ positionMm: rounded, major: Math.abs(rounded % majorMm) < 0.001 })
  }

  return (
    <div
      className={`ruler ruler-${orientation}`}
      style={horizontal ? { width: `${lengthPx}px` } : { height: `${lengthPx}px` }}
      aria-hidden="true"
    >
      {highlight && (
        <span
          className="ruler-highlight"
          style={
            horizontal
              ? {
                  left: `${highlight.startMm * pxPerMm}px`,
                  width: `${Math.max((highlight.endMm - highlight.startMm) * pxPerMm, 1)}px`
                }
              : {
                  top: `${highlight.startMm * pxPerMm}px`,
                  height: `${Math.max((highlight.endMm - highlight.startMm) * pxPerMm, 1)}px`
                }
          }
        />
      )}

      {ticks.map((tick) => (
        <span
          key={tick.positionMm}
          className={`ruler-tick${tick.major ? ' is-major' : ''}`}
          style={
            horizontal
              ? { left: `${tick.positionMm * pxPerMm}px` }
              : { top: `${tick.positionMm * pxPerMm}px` }
          }
        >
          {tick.major && <em>{formatMm(tick.positionMm, 0)}</em>}
        </span>
      ))}
    </div>
  )
}
