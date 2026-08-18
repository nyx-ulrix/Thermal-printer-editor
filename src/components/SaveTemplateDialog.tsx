import { useEffect, useRef } from 'react'
import { handleSelectAllOnFocus, handleSelectAllOnMouseUp } from '../lib/inputSelection'

interface SaveTemplateDialogProps {
  open: boolean
  name: string
  onNameChange: (name: string) => void
  onSave: () => void
  onCancel: () => void
}

export default function SaveTemplateDialog({
  open,
  name,
  onNameChange,
  onSave,
  onCancel
}: SaveTemplateDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const canSave = name.trim().length > 0

  useEffect(() => {
    if (!open) return
    const input = inputRef.current
    input?.focus()
    input?.select()
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <form
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-template-title"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSave) onSave()
        }}
      >
        <h2 id="save-template-title">Name this template</h2>
        <p className="panel-hint">This design is not saved as a template yet.</p>
        <label className="field">
          <span>Template name</span>
          <input
            ref={inputRef}
            type="text"
            value={name}
            spellCheck={false}
            placeholder="e.g. Shipping 50 x 30"
            onChange={(event) => onNameChange(event.target.value)}
            onFocus={handleSelectAllOnFocus}
            onMouseUp={handleSelectAllOnMouseUp}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!canSave}>
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
