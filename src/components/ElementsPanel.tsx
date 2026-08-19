import { useEffect, useRef, useState, type DragEvent } from 'react'
import { handleSelectAllOnFocus } from '../lib/inputSelection'
import { describeElement } from '../lib/preview'
import type { LabelElement } from '../lib/types'
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
  onReorder: (movedId: string, targetId: string, place: 'before' | 'after') => void
  onToggleTspl: () => void
  onCopyTspl: () => void
}

type DropPlace = 'before' | 'after'

function LayerRows({
  elements,
  selectedIds,
  editingId,
  collapsedIds,
  dragId,
  drop,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onToggleGroup,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  depth = 0
}: {
  elements: LabelElement[]
  selectedIds: string[]
  editingId: string | null
  collapsedIds: Set<string>
  dragId: string | null
  drop: { id: string; place: DropPlace } | null
  onSelect: (id: string, additive?: boolean) => void
  onStartEdit: (id: string) => void
  onCommitEdit: (id: string, name: string) => void
  onCancelEdit: () => void
  onToggleGroup: (id: string) => void
  onDragStart: (id: string) => void
  onDragOver: (id: string, place: DropPlace) => void
  onDrop: () => void
  onDragEnd: () => void
  depth?: number
}) {
  return (
    <ul className={`element-list${depth > 0 ? ' is-nested' : ''}`}>
      {elements.map((element) => {
        const collapsed = element.type === 'group' && collapsedIds.has(element.id)
        return (
          <li key={element.id}>
            <LayerRow
              element={element}
              selected={selectedIds.includes(element.id)}
              editing={editingId === element.id}
              collapsed={collapsed}
              dragging={dragId === element.id}
              dropPlace={drop?.id === element.id ? drop.place : null}
              depth={depth}
              onSelect={onSelect}
              onStartEdit={onStartEdit}
              onCommitEdit={onCommitEdit}
              onCancelEdit={onCancelEdit}
              onToggleGroup={onToggleGroup}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
            />
            {element.type === 'group' && element.children.length > 0 && !collapsed && (
              <LayerRows
                elements={element.children}
                selectedIds={selectedIds}
                editingId={editingId}
                collapsedIds={collapsedIds}
                dragId={dragId}
                drop={drop}
                onSelect={onSelect}
                onStartEdit={onStartEdit}
                onCommitEdit={onCommitEdit}
                onCancelEdit={onCancelEdit}
                onToggleGroup={onToggleGroup}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onDragEnd={onDragEnd}
                depth={depth + 1}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function LayerRow({
  element,
  selected,
  editing,
  collapsed,
  dragging,
  dropPlace,
  depth,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onToggleGroup,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: {
  element: LabelElement
  selected: boolean
  editing: boolean
  collapsed: boolean
  dragging: boolean
  dropPlace: DropPlace | null
  depth: number
  onSelect: (id: string, additive?: boolean) => void
  onStartEdit: (id: string) => void
  onCommitEdit: (id: string, name: string) => void
  onCancelEdit: () => void
  onToggleGroup: (id: string) => void
  onDragStart: (id: string) => void
  onDragOver: (id: string, place: DropPlace) => void
  onDrop: () => void
  onDragEnd: () => void
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

  const className = [
    'element-row',
    selected ? 'is-selected' : '',
    editing ? 'is-editing' : '',
    dragging ? 'is-dragging' : '',
    dropPlace === 'before' ? 'is-drop-before' : '',
    dropPlace === 'after' ? 'is-drop-after' : ''
  ]
    .filter(Boolean)
    .join(' ')

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const place: DropPlace = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    onDragOver(element.id, place)
  }

  return (
    <div
      className={className}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      onDragOver={handleDragOver}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onDrop()
      }}
    >
      <span
        className="layer-grip"
        title="Drag to reorder"
        role="button"
        aria-label={`Reorder ${describeElement(element)}`}
        draggable
        onClick={(event) => event.stopPropagation()}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', element.id)
          onDragStart(element.id)
        }}
        onDragEnd={onDragEnd}
      >
        <Icon name="grip" size={12} />
      </span>

      {element.type === 'group' ? (
        <button
          type="button"
          className={`layer-chevron${collapsed ? '' : ' is-open'}`}
          title={collapsed ? 'Show grouped layers' : 'Hide grouped layers'}
          aria-label={collapsed ? 'Show grouped layers' : 'Hide grouped layers'}
          aria-expanded={!collapsed}
          onClick={(event) => {
            event.stopPropagation()
            onToggleGroup(element.id)
          }}
        >
          <Icon name="chevron" size={10} />
        </button>
      ) : (
        <span className="layer-chevron-spacer" />
      )}

      {editing ? (
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
      ) : (
        <button
          type="button"
          className="layer-label"
          onClick={(event) => onSelect(element.id, event.shiftKey || event.ctrlKey || event.metaKey)}
          onDoubleClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onStartEdit(element.id)
          }}
        >
          <span className="element-name">{describeElement(element)}</span>
        </button>
      )}
    </div>
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
  onReorder,
  onToggleTspl,
  onCopyTspl
}: ElementsPanelProps) {
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; place: DropPlace } | null>(null)

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
          Drag the handle to reorder. Click a group&apos;s arrow to hide its layers. Double-click to
          rename.
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
            collapsedIds={collapsedIds}
            dragId={dragId}
            drop={drop}
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
            onToggleGroup={(id) =>
              setCollapsedIds((current) => {
                const next = new Set(current)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })
            }
            onDragStart={(id) => {
              setEditingId(null)
              setDragId(id)
            }}
            onDragOver={(id, place) => {
              if (!dragId || dragId === id) {
                setDrop(null)
                return
              }
              setDrop({ id, place })
            }}
            onDrop={() => {
              if (dragId && drop && dragId !== drop.id) {
                onReorder(dragId, drop.id, drop.place)
              }
              setDragId(null)
              setDrop(null)
            }}
            onDragEnd={() => {
              setDragId(null)
              setDrop(null)
            }}
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
