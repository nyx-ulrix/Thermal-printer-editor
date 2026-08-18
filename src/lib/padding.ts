import type { BoxPadding, LabelMedia } from './types'
import { roundMm } from './units'

export const ZERO_PADDING: BoxPadding = {
  topMm: 0,
  rightMm: 0,
  bottomMm: 0,
  leftMm: 0
}

export function normalizePadding(raw: Partial<BoxPadding> | undefined): BoxPadding {
  const clampSide = (value: unknown) => {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) return 0
    return roundMm(n)
  }
  return {
    topMm: clampSide(raw?.topMm),
    rightMm: clampSide(raw?.rightMm),
    bottomMm: clampSide(raw?.bottomMm),
    leftMm: clampSide(raw?.leftMm)
  }
}

export function mediaPadding(media: LabelMedia): BoxPadding {
  return normalizePadding(media.padding)
}

/** Usable area inside the label after padding. */
export function mediaContentRect(media: LabelMedia): {
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
} {
  const padding = mediaPadding(media)
  return {
    xMm: padding.leftMm,
    yMm: padding.topMm,
    widthMm: Math.max(roundMm(media.widthMm - padding.leftMm - padding.rightMm), 0),
    heightMm: Math.max(roundMm(media.heightMm - padding.topMm - padding.bottomMm), 0)
  }
}
