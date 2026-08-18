import { useEffect } from 'react'

const SELECTABLE_TYPES = new Set(['text', 'number', 'search', 'tel', 'url', 'email'])

function isSelectable(target: EventTarget | null): target is HTMLInputElement {
  if (!(target instanceof HTMLInputElement)) return false
  if (target.disabled || target.readOnly) return false
  // Opt out with data-select-all="false" where placing a caret matters more.
  if (target.dataset.selectAll === 'false') return false
  return SELECTABLE_TYPES.has(target.type)
}

/**
 * Selects a field's current value when it gains focus, so typing replaces what is there
 * instead of appending to it. Most values in this app are single numbers or short strings
 * that get retyped wholesale, and a printer operator should never have to clear a box first.
 *
 * This listens once at the document rather than being wired into every input, which keeps
 * the behaviour consistent as fields are added.
 */
export function useSelectOnFocus(): void {
  useEffect(() => {
    function handleFocusIn(event: FocusEvent) {
      const input = event.target
      if (!isSelectable(input)) return

      // Chromium positions the caret while handling the click that gave focus, so the
      // selection has to be made after that finishes. Dragging across the text still wins,
      // because the browser keeps updating the selection as the pointer moves.
      window.setTimeout(() => {
        if (document.activeElement === input) input.select()
      }, 0)
    }

    document.addEventListener('focusin', handleFocusIn)
    return () => document.removeEventListener('focusin', handleFocusIn)
  }, [])
}
