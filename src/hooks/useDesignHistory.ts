import { useCallback, useRef, useState } from 'react'
import type { LabelElement, LabelMedia } from '../lib/types'

export interface DesignSnapshot {
  media: LabelMedia
  elements: LabelElement[]
}

const LIMIT = 80

function cloneSnap(media: LabelMedia, elements: LabelElement[]): DesignSnapshot {
  return {
    media: structuredClone(media),
    elements: structuredClone(elements)
  }
}

function equalSnap(a: DesignSnapshot, b: DesignSnapshot): boolean {
  return JSON.stringify(a.media) === JSON.stringify(b.media) && JSON.stringify(a.elements) === JSON.stringify(b.elements)
}

export function useDesignHistory(initial: DesignSnapshot) {
  const stack = useRef<DesignSnapshot[]>([cloneSnap(initial.media, initial.elements)])
  const index = useRef(0)
  const gesture = useRef(false)
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false })

  const syncFlags = () => {
    setFlags({
      canUndo: index.current > 0,
      canRedo: index.current < stack.current.length - 1
    })
  }

  const record = useCallback((media: LabelMedia, elements: LabelElement[]) => {
    if (gesture.current) return
    const snap = cloneSnap(media, elements)
    const current = stack.current[index.current]
    if (current && equalSnap(current, snap)) return
    const next = stack.current.slice(0, index.current + 1)
    next.push(snap)
    if (next.length > LIMIT) next.shift()
    stack.current = next
    index.current = next.length - 1
    syncFlags()
  }, [])

  const reset = useCallback((media: LabelMedia, elements: LabelElement[]) => {
    stack.current = [cloneSnap(media, elements)]
    index.current = 0
    gesture.current = false
    syncFlags()
  }, [])

  const beginGesture = useCallback(() => {
    gesture.current = true
  }, [])

  const endGesture = useCallback((media: LabelMedia, elements: LabelElement[]) => {
    gesture.current = false
    record(media, elements)
  }, [record])

  const isGesture = useCallback(() => gesture.current, [])

  const undo = useCallback((): DesignSnapshot | null => {
    if (index.current <= 0) return null
    index.current -= 1
    syncFlags()
    const snap = stack.current[index.current]
    return cloneSnap(snap.media, snap.elements)
  }, [])

  const redo = useCallback((): DesignSnapshot | null => {
    if (index.current >= stack.current.length - 1) return null
    index.current += 1
    syncFlags()
    const snap = stack.current[index.current]
    return cloneSnap(snap.media, snap.elements)
  }, [])

  return {
    canUndo: flags.canUndo,
    canRedo: flags.canRedo,
    record,
    reset,
    beginGesture,
    endGesture,
    isGesture,
    undo,
    redo
  }
}
