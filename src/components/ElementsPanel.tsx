import { useEffect, useRef, useState } from 'react'
import { handleSelectAllOnFocus } from '../lib/inputSelection'
import { describeElement } from '../lib/preview'
import type { LabelElement } from '../lib/types'
import { formatMm } from '../lib/units'
import CollapsiblePanel from './CollapsiblePanel'
import Icon, { IconButton } from './Icon'
import type { CanvasMode } from './LabelCanvas'

interface ElementsPanelProps {
  elements: LabelElement[]
  selectedIds: string[]
  mode: CanvasMode
  tspl: string
  showTspl: boolean
  onAddText: () => void
  onAddInput: () => void
  onToggleLineMode: () => void
  onPickImage: (file: File) => void
  onSelect: (id: string, additive?: boolean) => void
  onRename: (id: string, layerName: string) => void
  onToggleTspl: () => void
  onCopyTspl: () => void
}

const TYPE_LABELS: Record<LabelElement['type'], string> = {
  text: 'Text',
  line: 'Line',
  image: 'Image',
  input: 'Input',
  group: 'Group'
}

function LayerRows({
  elements,
  selectedIds,
  editingId,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  depth = 0
}: {
  elements: LabelElement[]
  selectedIds: string[]
  editingId: string | null
  onSelect: (id: string, additive?: boolean) => void
  onStartEdit: (id: string) => void
  onCommitEdit: (id: string, name: string) => void
  onCancelEdit: () => void
  depth?: number
}) {
  return (
    <ul className={`element-list${depth > 0 ? ' is-nested' : ''}`}>
      {elements.map((element) => (
        <li key={element.id}>
          <LayerRow
            element={element}
            selected={selectedIds.includes(element.id)}
            editing={editingId === element.id}
            depth={depth}
            onSelect={onSelect}
            onStartEdit={onStartEdit}
            onCommitEdit={onCommitEdit}
            onCancelEdit={onCancelEdit}
          />
          {element.type === 'group' && element.children.length > 0 && (
            <LayerRows
              elements={element.children}
              selectedIds={selectedIds}
              editingId={editingId}
              onSelect={onSelect}
              onStartEdit={onStartEdit}
              onCommitEdit={onCommitEdit}
              onCancelEdit={onCancelEdit}
              depth={depth + 1}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

function LayerRow({
  element,
  selected,
  editing,
  depth,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onCancelEdit
}: {
  element: LabelElement
  selected: boolean
  editing: boolean
  depth: number
  onSelect: (id: string, additive?: boolean) => void
  onStartEdit: (id: string) => void
  onCommitEdit: (id: string, name: string) => void
  onCancelEdit: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const skipBlur = useRef(false)
  const [draft, setDraft] = useState(element.layerName ?? describeElement(element))

  useEffect(() => {
    if (!editing) return
    setDraft(element.layerName?.trim() || describeElement({ ...element, layerName: undefined }))
    const input = inputRef.current
    input?.focus()
    input?.select()
    // Only reset when this row starts editing, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, element.id])

  if (editing) {
    return (
      <div
        className={`element-row is-editing${selected ? ' is-selected' : ''}`}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        <input
          ref={inputRef}
          className="element-name-input"
          value={draft}
          aria-label="Layer name"
          onChange={(event) => setDraft(event.target.value)}
          onFocus={handleSelectAllOnFocus}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              skipBlur.current = true
              onCommitEdit(element.id, draft)
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              skipBlur.current = true
              onCancelEdit()
            }
          }}
          onBlur={() => {
            if (skipBlur.current) {
              skipBlur.current = false
              return
            }
            onCommitEdit(element.id, draft)
          }}
        />
        <span className="element-meta">{TYPE_LABELS[element.type]}</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`element-row${selected ? ' is-selected' : ''}`}
      style={{ paddingLeft: `${12 + depth * 14}px` }}
      onClick={(event) => onSelect(element.id, event.shiftKey || event.ctrlKey || event.metaKey)}
      onDoubleClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onStartEdit(element.id)
      }}
    >
      <span className="element-name">{describeElement(element)}</span>
      <span className="element-meta">
        {TYPE_LABELS[element.type]} - {formatMm(element.xMm, 1)}, {formatMm(element.yMm, 1)} mm
        {element.rotation !== 0 && ` - ${element.rotation} deg`}
      </span>
    </button>
  )
}

export default function ElementsPanel({
  elements,
  selectedIds,
  mode,
  tspl,
  showTspl,
  onAddText,
  onAddInput,
  onToggleLineMode,
  onPickImage,
  onSelect,
  onRename,
  onToggleTspl,
  onCopyTspl
}: ElementsPanelProps) {
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <>
      <section className="panel">
        <h2>Add</h2>

        <div className="tool-rail">
          <button type="button" className="tool" title="Text" aria-label="Text" onClick={onAddText}>
            <Icon name="type" size={18} />
          </button>
          <button
            type="button"
            className="tool"
            title="Input field"
            aria-label="Input field"
            onClick={onAddInput}
          >
            <Icon name="input" size={18} />
          </button>
          <button
            type="button"
            className={`tool${mode === 'line' ? ' is-active' : ''}`}
            onClick={onToggleLineMode}
            title={mode === 'line' ? 'Drawing a line — drag across the label' : 'Line'}
            aria-label={mode === 'line' ? 'Cancel line drawing' : 'Line'}
          >
            <Icon name="line" size={18} />
          </button>
          <button
            type="button"
            className="tool"
            onClick={() => fileInput.current?.click()}
            title="Image — or drop a file onto the label"
            aria-label="Image"
          >
            <Icon name="image" size={18} />
          </button>
        </div>

        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onPickImage(file)
            event.target.value = ''
          }}
        />
        <p className="panel-hint">
          Shift or Ctrl+click several items, then Group. Double-click a layer to rename it.
        </p>
      </section>

      <CollapsiblePanel
        title="Layers"
        summary={`${elements.length}`}
        storageKey="layers"
        defaultOpen
      >
        {elements.length === 0 ? (
          <p className="panel-hint">The label is empty. Add text, a line, or an image.</p>
        ) : (
          <LayerRows
            elements={elements}
            selectedIds={selectedIds}
            editingId={editingId}
            onSelect={(id, additive) => {
              setEditingId(null)
              onSelect(id, additive)
            }}
            onStartEdit={setEditingId}
            onCommitEdit={(id, name) => {
              setEditingId(null)
              onRename(id, name)
            }}
            onCancelEdit={() => setEditingId(null)}
          />
        )}
      </CollapsiblePanel>

      <CollapsiblePanel title="TSPL" storageKey="tspl" defaultOpen={false}>
        <IconButton
          name={showTspl ? 'eyeOff' : 'eye'}
          label={showTspl ? 'Hide commands' : 'Show commands'}
          className="button ghost block"
          onClick={onToggleTspl}
        />

        {showTspl && (
          <>
            <pre className="tspl-view">{tspl}</pre>
            <IconButton
              name="copy"
              label="Copy TSPL"
              className="button ghost block"
              onClick={onCopyTspl}
            />
          </>
        )}
      </CollapsiblePanel>
    </>
  )
}
