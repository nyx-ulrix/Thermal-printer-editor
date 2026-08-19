import { handleSelectAllOnFocus, handleSelectAllOnMouseUp } from '../lib/inputSelection'
import CollapsiblePanel from './CollapsiblePanel'
import { IconButton } from './Icon'

interface TemplatesPanelProps {
  activeId: string | null
  name: string
  dirty: boolean
  onNameChange: (name: string) => void
  onSave: () => void
  onSaveCopy: () => void
}

export default function TemplatesPanel({
  activeId,
  name,
  dirty,
  onNameChange,
  onSave,
  onSaveCopy
}: TemplatesPanelProps) {
  return (
    <CollapsiblePanel
      title="Templates"
      summary={name}
      storageKey="templates"
      defaultOpen={false}
    >
      <label className="field">
        <span>Template name</span>
        <input
          type="text"
          value={name}
          spellCheck={false}
          onChange={(event) => onNameChange(event.target.value)}
          onFocus={handleSelectAllOnFocus}
          onMouseUp={handleSelectAllOnMouseUp}
        />
      </label>

      <div className="field-row">
        <IconButton
          name="save"
          label={activeId ? 'Save' : 'Save template'}
          className="button primary"
          onClick={onSave}
        />
        {activeId && (
          <IconButton
            name="saveCopy"
            label="Save as copy"
            className="button ghost"
            onClick={onSaveCopy}
          />
        )}
      </div>

      <p className="panel-hint">
        {dirty
          ? 'Unsaved changes. Saving keeps the live design — media, elements and input fields — so you can open it again and keep editing.'
          : 'Saving keeps the live design — media, elements and input fields — so you can open it again and keep editing. Browse other templates from Home.'}
      </p>
    </CollapsiblePanel>
  )
}
