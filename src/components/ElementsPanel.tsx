import { useEffect, useRef, useState, type DragEvent } from 'react'
import { findElement } from '../lib/tree'
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
type MoveDirection = 'up' | 'down'
type MoveControl = 'grip' | MoveDirection

/**
 * After a keyboard or button move the row's DOM node is re-inserted, which
 * drops focus; put it back on the same control (or its nearest usable sibling).
 */
function refocusMoveControl(root: HTMLElement | null, id: string, control: MoveControl) {
  if (!root) return
  const order: MoveControl[] =
    control === 'grip' ? ['grip', 'up', 'down'] : [control, control === 'up' ? 'down' : 'up', 'grip']
  for (const candidate of order) {
    const target = root.querySelector<HTMLButtonElement>(
      `[data-move-id="${CSS.escape(id)}"][data-move-control="${candidate}"]`
    )
    if (target && !target.disabled && target.offsetParent !== null) {
      target.focus()
      return
    }
  }
}

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
  onMove,
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
  onMove: (id: string, targetId: string, place: DropPlace, control: MoveControl) => void
  depth?: number
}) {
  return (
    <ul className={`element-list${depth > 0 ? ' is-nested' : ''}`}>
      {elements.map((element, index) => {
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
              previousId={elements[index - 1]?.id ?? null}
              nextId={elements[index + 1]?.id ?? null}
              onMove={onMove}
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
                onMove={onMove}
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
  onDragEnd,
  previousId,
  nextId,
  onMove
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
  previousId: string | null
  nextId: string | null
  onMove: (id: string, targetId: string, place: DropPlace, control: MoveControl) => void
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

  function move(direction: MoveDirection, control: MoveControl) {
    const targetId = direction === 'up' ? previousId : nextId
    if (targetId) onMove(element.id, targetId, direction === 'up' ? 'before' : 'after', control)
  }

  const name = describeElement(element)

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
      <button
        type="button"
        className="layer-grip"
        title="Drag to reorder, or press the up and down arrow keys"
        aria-label={`Move "${name}"`}
        aria-keyshortcuts="ArrowUp ArrowDown"
        data-move-id={element.id}
        data-move-control="grip"
        draggable
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          event.stopPropagation()
          move(event.key === 'ArrowUp' ? 'up' : 'down', 'grip')
        }}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', element.id)
          onDragStart(element.id)
        }}
        onDragEnd={onDragEnd}
      >
        <Icon name="grip" size={12} />
      </button>

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
          <span className="element-name">{name}</span>
        </button>
      )}

      <span className="layer-move-buttons">
        <button
          type="button"
          className="layer-move is-up"
          title="Move up"
          aria-label={`Move "${name}" up`}
          data-move-id={element.id}
          data-move-control="up"
          disabled={!previousId}
          onClick={(event) => {
            event.stopPropagation()
            move('up', 'up')
          }}
        >
          <Icon name="chevron" size={14} />
        </button>
        <button
          type="button"
          className="layer-move is-down"
          title="Move down"
          aria-label={`Move "${name}" down`}
          data-move-id={element.id}
          data-move-control="down"
          disabled={!nextId}
          onClick={(event) => {
            event.stopPropagation()
            move('down', 'down')
          }}
        >
          <Icon name="chevron" size={14} />
        </button>
      </span>
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
  const layersRef = useRef<HTMLDivElement | null>(null)
  const pendingFocus = useRef<{ id: string; control: MoveControl } | null>(null)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    const pending = pendingFocus.current
    if (!pending) return
    pendingFocus.current = null
    refocusMoveControl(layersRef.current, pending.id, pending.control)
  }, [elements])

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
          <span className="only-fine-pointer">
            Drag the handle to reorder. Click a group&apos;s arrow to hide its layers. Double-click
            to rename.
          </span>
          <span className="only-coarse-pointer">
            Use the arrows to reorder. Tap a group&apos;s arrow to hide its layers. Double-tap to
            rename.
          </span>
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
          <div ref={layersRef}>
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
              onMove={(id, targetId, place, control) => {
                setEditingId(null)
                pendingFocus.current = { id, control }
                onReorder(id, targetId, place)
                const moved = findElement(elements, id)
                const target = findElement(elements, targetId)
                if (moved && target) {
                  setAnnouncement(
                    `Moved "${describeElement(moved)}" ${place === 'before' ? 'above' : 'below'} "${describeElement(target)}".`
                  )
                }
              }}
            />
          </div>
        )}
        <p className="visually-hidden" aria-live="polite">
          {announcement}
        </p>
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
