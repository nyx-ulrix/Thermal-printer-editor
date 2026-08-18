import type { FocusEvent, MouseEvent, PointerEvent } from 'react'

type SelectableInput = HTMLInputElement | HTMLTextAreaElement

function shouldSelectAll(target: SelectableInput): boolean {
  return target.dataset.selectAll !== 'false'
}

function selectAll(target: SelectableInput): void {
  if (!shouldSelectAll(target)) return
  window.requestAnimationFrame(() => target.select())
}

/**
 * Lets a field behave like native calculator-style inputs: focus selects the whole value, so
 * typing immediately replaces it instead of appending to the existing number.
 */
export function handleSelectAllOnFocus(
  event: FocusEvent<SelectableInput>
): void {
  selectAll(event.currentTarget)
}

/**
 * Mouse focus can collapse the selection back to the click point right after focus, so the
 * matching mouse-up handler keeps the whole value selected for replacement typing.
 */
export function handleSelectAllOnMouseUp(
  event: MouseEvent<SelectableInput> | PointerEvent<SelectableInput>
): void {
  if (!shouldSelectAll(event.currentTarget)) return
  event.preventDefault()
}
