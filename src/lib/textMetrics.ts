/** Reference size for measurements. Widths scale linearly, so one measure covers all sizes. */
export const MEASURE_FONT_PX = 100

let context: CanvasRenderingContext2D | null = null

function measureContext(): CanvasRenderingContext2D | null {
  if (context) return context
  context = document.createElement('canvas').getContext('2d')
  return context
}

/** Width of `text` in pixels at MEASURE_FONT_PX, for proportional preview fonts. */
export function measureWidthAtReference(text: string, family: string, weight: number): number {
  const ctx = measureContext()
  if (!ctx) return text.length * MEASURE_FONT_PX * 0.5

  ctx.font = `${weight} ${MEASURE_FONT_PX}px ${family}`
  return ctx.measureText(text).width
}
