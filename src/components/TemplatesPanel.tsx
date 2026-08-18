import { handleSelectAllOnFocus, handleSelectAllOnMouseUp } from '../lib/inputSelection'
import type { LabelTemplate } from '../lib/types'
import CollapsiblePanel from './CollapsiblePanel'
import { IconButton } from './Icon'

interface TemplatesPanelProps {
  templates: LabelTemplate[]
  activeId: string | null
  name: string
  dirty: boolean
  onNameChange: (name: string) => void
  onSave: () => void
  onSaveCopy: () => void
  onLoad: (id: string) => void
  onDelete: (id: string) => void
  onNew: () => void
}

function whenSaved(updatedAt: number): string {
  const date = new Date(updatedAt)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : ''
}

function describeTemplate(template: LabelTemplate): string {
  const parts = [`${template.elements.length} element${template.elements.length === 1 ? '' : 's'}`]
  parts.push(whenSaved(template.updatedAt))
  return parts.join(' - ')
}

export default function TemplatesPanel({
  templates,
  activeId,
  name,
  dirty,
  onNameChange,
  onSave,
  onSaveCopy,
  onLoad,
  onDelete,
  onNew
}: TemplatesPanelProps) {
  const sorted = [...templates].sort((a, b) => b.updatedAt - a.updatedAt)

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
          : 'Saving keeps the live design — media, elements and input fields — so you can open it again and keep editing.'}
      </p>

      {sorted.length === 0 ? (
        <p className="panel-hint">Nothing saved yet.</p>
      ) : (
        <ul className="element-list">
          {sorted.map((template) => (
            <li key={template.id}>
              <div className={`template-row${template.id === activeId ? ' is-selected' : ''}`}>
                <button
                  type="button"
                  className="element-row"
                  onClick={() => onLoad(template.id)}
                >
                  <span className="element-name">{template.name}</span>
                  <span className="element-meta">{describeTemplate(template)}</span>
                </button>
                <IconButton
                  name="trash"
                  label={`Delete ${template.name}`}
                  className="mini-button is-danger"
                  onClick={() => onDelete(template.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <IconButton
        name="filePlus"
        label="New blank label"
        className="button ghost block"
        onClick={onNew}
      />
    </CollapsiblePanel>
  )
}
