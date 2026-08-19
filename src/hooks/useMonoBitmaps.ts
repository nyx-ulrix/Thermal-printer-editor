import { useEffect, useRef, useState } from 'react'
import { inputBoxSize } from '../lib/fields'
import { toMonoBitmap, type MonoBitmap } from '../lib/imageMono'
import { walkElements } from '../lib/tree'
import type { ImageElement, InputElement, LabelElement } from '../lib/types'
import { getDpi, mmToDots } from '../lib/units'

export interface MonoBitmapsState {
  bitmaps: Map<string, MonoBitmap>
  converting: boolean
  error: string | null
}

function sourceSignature(dataUrl: string | undefined): string {
  if (!dataUrl) return 'empty'
  return `${dataUrl.length}:${dataUrl.slice(-24)}`
}

function signatureOf(element: ImageElement): string {
  return [
    element.id,
    sourceSignature(element.sourceDataUrl),
    element.widthMm,
    element.heightMm,
    element.rotation,
    element.threshold,
    element.dither ? 'd' : '-',
    element.invert ? 'i' : '-',
    getDpi()
  ].join('|')
}

function signatureOfInput(element: InputElement): string {
  const box = inputBoxSize(element)
  return [
    element.id,
    sourceSignature(element.imageStyle?.sourceDataUrl),
    box.widthMm,
    box.heightMm,
    element.rotation,
    element.imageStyle?.threshold,
    element.imageStyle?.dither ? 'd' : '-',
    element.imageStyle?.invert ? 'i' : '-',
    element.imageStyle?.sourceDataUrl ? 'img' : 'empty',
    getDpi()
  ].join('|')
}

const EMPTY: Map<string, MonoBitmap> = new Map()

/**
 * Rasterises every image element at its printed size. Results are cached by the settings
 * that affect them, so dragging an image around does not trigger a re-conversion.
 */
export function useMonoBitmaps(elements: LabelElement[]): MonoBitmapsState {
  const images = walkElements(elements).filter(
    (element): element is ImageElement | InputElement =>
      element.type === 'image' || (element.type === 'input' && element.contentType === 'image')
  )
  const signatures = images
    .map((element) => (element.type === 'image' ? signatureOf(element) : signatureOfInput(element)))
    .join('~')

  const cache = useRef(new Map<string, MonoBitmap>())
  const [state, setState] = useState<MonoBitmapsState>({
    bitmaps: EMPTY,
    converting: false,
    error: null
  })

  useEffect(() => {
    if (images.length === 0) {
      setState({ bitmaps: EMPTY, converting: false, error: null })
      return
    }

    let cancelled = false
    setState((current) => ({ ...current, converting: true, error: null }))

    // Small debounce so dragging a resize handle does not queue a conversion per frame.
    const timer = window.setTimeout(() => {
      void (async () => {
        const next = new Map<string, MonoBitmap>()
        let failure: string | null = null

        for (const image of images) {
          const signature = image.type === 'image' ? signatureOf(image) : signatureOfInput(image)
          const cached = cache.current.get(signature)
          if (cached) {
            next.set(image.id, cached)
            continue
          }

          const sourceDataUrl =
            image.type === 'image' ? image.sourceDataUrl : image.imageStyle.sourceDataUrl
          if (!sourceDataUrl) continue

          try {
            const size =
              image.type === 'image'
                ? { widthMm: image.widthMm, heightMm: image.heightMm }
                : inputBoxSize(image)
            const bitmap = await toMonoBitmap(sourceDataUrl, {
              widthDots: mmToDots(size.widthMm),
              heightDots: mmToDots(size.heightMm),
              rotation: image.rotation,
              threshold: image.type === 'image' ? image.threshold : image.imageStyle.threshold,
              dither: image.type === 'image' ? image.dither : image.imageStyle.dither,
              invert: image.type === 'image' ? image.invert : image.imageStyle.invert
            })
            if (cancelled) return
            if (cache.current.size > 40) cache.current.clear()
            cache.current.set(signature, bitmap)
            next.set(image.id, bitmap)
          } catch (error) {
            failure = error instanceof Error ? error.message : String(error)
          }
        }

        if (cancelled) return
        setState({ bitmaps: next, converting: false, error: failure })
      })()
    }, 80)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // Signatures capture every input that changes the output bitmaps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatures])

  return state
}
