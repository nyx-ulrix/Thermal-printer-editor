import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useCustomFonts } from '../hooks/useCustomFonts'
import { useMonoBitmaps } from '../hooks/useMonoBitmaps'
import { handleSelectAllOnFocus, handleSelectAllOnMouseUp } from '../lib/inputSelection'
import {
  loadHomeSort,
  saveHomeSort,
  type HomeSortDirection,
  type HomeSortKey
} from '../lib/storage'
import { getBasePxPerMm } from '../lib/units'
import type { LabelTemplate, TemplateGroup } from '../lib/types'
import Icon, { IconButton } from './Icon'
import LabelCanvas from './LabelCanvas'

interface HomeViewProps {
  templates: LabelTemplate[]
  groups: TemplateGroup[]
  onCreateNew: () => void
  onOpenTemplate: (id: string) => void
  onPrintTemplate: (id: string) => void
  onDuplicateTemplate: (id: string) => void
  onDeleteTemplate: (id: string) => void
  onCreateGroup: (name: string) => string
  onRenameGroup: (id: string, name: string) => void
  onDeleteGroup: (id: string) => void
  onSetTemplateGroup: (templateId: string, groupId: string | null) => void
}

const PREVIEW_MAX_PX = 180
const TEMPLATE_DRAG = 'application/x-receipt-template-id'
const SORT_FIELDS: HomeSortKey[] = ['edited', 'created', 'name']
const SORT_LABELS: Record<HomeSortKey, string> = {
  created: 'Date created',
  edited: 'Date edited',
  name: 'Name'
}
const noop = () => undefined

function createdAtOf(template: LabelTemplate): number {
  return template.createdAt || template.updatedAt || 0
}

function sortTemplates(
  templates: LabelTemplate[],
  key: HomeSortKey,
  direction: HomeSortDirection
): LabelTemplate[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...templates].sort((a, b) => {
    if (key === 'name') {
      return sign * a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    }
    const left = key === 'created' ? createdAtOf(a) : a.updatedAt
    const right = key === 'created' ? createdAtOf(b) : b.updatedAt
    return sign * (left - right)
  })
}

function readDraggedTemplateId(event: DragEvent): string | null {
  return event.dataTransfer.getData(TEMPLATE_DRAG) || event.dataTransfer.getData('text/plain') || null
}

export default function HomeView({
  templates,
  groups,
  onCreateNew,
  onOpenTemplate,
  onPrintTemplate,
  onDuplicateTemplate,
  onDeleteTemplate,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onSetTemplateGroup
}: HomeViewProps) {
  const [menuId, setMenuId] = useState<string | null>(null)
  const [menuMode, setMenuMode] = useState<'actions' | 'move'>('actions')
  const [openGroupId, setOpenGroupId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [sort, setSort] = useState(loadHomeSort)
  const [groupDialog, setGroupDialog] = useState<
    { mode: 'create' } | { mode: 'rename'; id: string; name: string } | null
  >(null)
  const [groupName, setGroupName] = useState('')
  const [dragging, setDragging] = useState(false)
  const didDrag = useRef(false)

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('.home-card-menu') || target?.closest('.home-folder-menu')) return
      setMenuId(null)
      setMenuMode('actions')
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuId(null)
        setMenuMode('actions')
        setGroupDialog(null)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    if (openGroupId && !groups.some((group) => group.id === openGroupId)) {
      setOpenGroupId(null)
    }
  }, [groups, openGroupId])

  const openGroup = groups.find((group) => group.id === openGroupId) ?? null
  const folderTemplates = sortTemplates(
    templates.filter((template) => template.groupId === openGroupId),
    sort.key,
    sort.direction
  )
  const ungrouped = sortTemplates(
    templates.filter((template) => !template.groupId),
    sort.key,
    sort.direction
  )
  const visibleTemplates = openGroup ? folderTemplates : ungrouped

  function updateSort(next: { key: HomeSortKey; direction: HomeSortDirection }) {
    setSort(next)
    saveHomeSort(next)
  }

  function cycleSortField() {
    const index = SORT_FIELDS.indexOf(sort.key)
    updateSort({ key: SORT_FIELDS[(index + 1) % SORT_FIELDS.length], direction: sort.direction })
  }

  function toggleSortDirection() {
    updateSort({ key: sort.key, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
  }

  function openCreateGroup() {
    setGroupName('')
    setGroupDialog({ mode: 'create' })
  }

  function submitGroupDialog() {
    const trimmed = groupName.trim()
    if (!trimmed || !groupDialog) return
    if (groupDialog.mode === 'create') {
      setOpenGroupId(onCreateGroup(trimmed))
    } else {
      onRenameGroup(groupDialog.id, trimmed)
    }
    setGroupDialog(null)
    setGroupName('')
  }

  function handleDragStart(event: DragEvent, templateId: string) {
    didDrag.current = true
    setDragging(true)
    event.dataTransfer.setData(TEMPLATE_DRAG, templateId)
    event.dataTransfer.setData('text/plain', templateId)
    event.dataTransfer.effectAllowed = 'move'
  }

  function handleDragEnd() {
    setDropTarget(null)
    setDragging(false)
    window.setTimeout(() => {
      didDrag.current = false
    }, 0)
  }

  function allowDrop(event: DragEvent, targetId: string) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dropTarget !== targetId) setDropTarget(targetId)
  }

  function dropOnGroup(event: DragEvent, groupId: string | null) {
    event.preventDefault()
    event.stopPropagation()
    const templateId = readDraggedTemplateId(event)
    setDropTarget(null)
    if (!templateId) return
    onSetTemplateGroup(templateId, groupId)
  }

  function openTemplate(id: string) {
    if (didDrag.current) return
    onOpenTemplate(id)
  }

  return (
    <div className="page home-page">
      <header className="page-header home-header">
        <div className="home-title-row">
          {openGroup ? (
            <button
              type="button"
              className={`home-back${dropTarget === 'ungrouped' ? ' is-drop' : ''}`}
              onClick={() => setOpenGroupId(null)}
              onDragOver={(event) => allowDrop(event, 'ungrouped')}
              onDragLeave={() => setDropTarget((current) => (current === 'ungrouped' ? null : current))}
              onDrop={(event) => dropOnGroup(event, null)}
            >
              <Icon name="chevron" size={16} />
              <span className="visually-hidden">Back to all templates</span>
            </button>
          ) : null}
          <h1>{openGroup ? openGroup.name : 'Templates'}</h1>
        </div>
        <div className="home-header-actions">
          <div className="home-sort">
            <button
              type="button"
              className="button ghost home-sort-field"
              title="Cycle sort: date edited, date created, name"
              onClick={cycleSortField}
            >
              {SORT_LABELS[sort.key]}
            </button>
            <IconButton
              name={sort.direction === 'asc' ? 'sortAsc' : 'sortDesc'}
              label={sort.direction === 'asc' ? 'Sort ascending. Press to sort descending.' : 'Sort descending. Press to sort ascending.'}
              className="button ghost"
              onClick={toggleSortDirection}
            />
          </div>
          {openGroup ? (
            <>
              <IconButton
                name="edit"
                label="Rename folder"
                className="button ghost"
                onClick={() => {
                  setGroupName(openGroup.name)
                  setGroupDialog({ mode: 'rename', id: openGroup.id, name: openGroup.name })
                }}
              />
              <IconButton
                name="trash"
                label="Delete folder"
                className="button ghost"
                onClick={() => {
                  onDeleteGroup(openGroup.id)
                  setOpenGroupId(null)
                }}
              />
            </>
          ) : (
            <IconButton
              name="folder"
              label="New folder"
              className="button ghost"
              onClick={openCreateGroup}
            />
          )}
        </div>
      </header>

      {templates.length === 0 && groups.length === 0 ? (
        <p className="panel-hint">No templates yet. Use + to create one.</p>
      ) : (
        <>
          {!openGroup && groups.length > 0 && (
            <section className="home-library-section">
              <h2>Folders</h2>
              <div className="home-folder-grid">
                {groups.map((group) => {
                  const count = templates.filter((template) => template.groupId === group.id).length
                  return (
                    <FolderCard
                      key={group.id}
                      group={group}
                      count={count}
                      isDrop={dropTarget === group.id}
                      onOpen={() => setOpenGroupId(group.id)}
                      onDragOver={(event) => allowDrop(event, group.id)}
                      onDragLeave={() => setDropTarget((current) => (current === group.id ? null : current))}
                      onDrop={(event) => dropOnGroup(event, group.id)}
                      onRename={() => {
                        setGroupName(group.name)
                        setGroupDialog({ mode: 'rename', id: group.id, name: group.name })
                      }}
                      onDelete={() => onDeleteGroup(group.id)}
                    />
                  )
                })}
              </div>
            </section>
          )}

          {openGroup && dragging && (
            <section className="home-library-section">
              <h2>Move to</h2>
              <div className="home-folder-grid">
                {groups
                  .filter((group) => group.id !== openGroup.id)
                  .map((group) => (
                    <FolderCard
                      key={group.id}
                      group={group}
                      count={templates.filter((template) => template.groupId === group.id).length}
                      isDrop={dropTarget === group.id}
                      onOpen={() => setOpenGroupId(group.id)}
                      onDragOver={(event) => allowDrop(event, group.id)}
                      onDragLeave={() =>
                        setDropTarget((current) => (current === group.id ? null : current))
                      }
                      onDrop={(event) => dropOnGroup(event, group.id)}
                      onRename={() => {
                        setGroupName(group.name)
                        setGroupDialog({ mode: 'rename', id: group.id, name: group.name })
                      }}
                      onDelete={() => onDeleteGroup(group.id)}
                    />
                  ))}
                <article
                  className={`home-folder${dropTarget === 'ungrouped' ? ' is-drop' : ''}`}
                  onDragOver={(event) => allowDrop(event, 'ungrouped')}
                  onDragLeave={() =>
                    setDropTarget((current) => (current === 'ungrouped' ? null : current))
                  }
                  onDrop={(event) => dropOnGroup(event, null)}
                >
                  <div className="home-folder-open">
                    <span className="home-folder-tab" />
                    <span className="home-folder-body">
                      <Icon name="home" size={28} />
                      <strong className="home-folder-name">All templates</strong>
                      <span className="home-folder-count">Drop to ungroup</span>
                    </span>
                  </div>
                </article>
              </div>
            </section>
          )}

          <section
            className={`home-library-section${dropTarget === 'ungrouped' && !openGroup ? ' is-drop' : ''}`}
            onDragOver={(event) => {
              if (openGroup) return
              allowDrop(event, 'ungrouped')
            }}
            onDragLeave={() => setDropTarget((current) => (current === 'ungrouped' ? null : current))}
            onDrop={(event) => {
              if (openGroup) return
              dropOnGroup(event, null)
            }}
          >
            {(openGroup || groups.length > 0) && <h2>Templates</h2>}
            {visibleTemplates.length === 0 ? (
              <p className="panel-hint">
                {openGroup
                  ? 'This folder is empty. Drag templates here, or create a new one.'
                  : groups.length > 0
                    ? 'No ungrouped templates. Open a folder or drag one here.'
                    : 'No templates yet. Use + to create one.'}
              </p>
            ) : (
              <div
                className="home-template-grid"
                onDragOver={
                  openGroup
                    ? (event) => allowDrop(event, openGroup.id)
                    : undefined
                }
                onDrop={
                  openGroup
                    ? (event) => dropOnGroup(event, openGroup.id)
                    : undefined
                }
              >
                {visibleTemplates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    groups={groups}
                    menuOpen={menuId === template.id}
                    menuMode={menuId === template.id ? menuMode : 'actions'}
                    onDragStart={(event) => handleDragStart(event, template.id)}
                    onDragEnd={handleDragEnd}
                    onOpen={() => openTemplate(template.id)}
                    onToggleMenu={() => {
                      setMenuMode('actions')
                      setMenuId((current) => (current === template.id ? null : template.id))
                    }}
                    onPrint={() => {
                      setMenuId(null)
                      onPrintTemplate(template.id)
                    }}
                    onDuplicate={() => {
                      setMenuId(null)
                      onDuplicateTemplate(template.id)
                    }}
                    onDelete={() => {
                      setMenuId(null)
                      onDeleteTemplate(template.id)
                    }}
                    onMoveMode={() => setMenuMode('move')}
                    onMoveTo={(groupId) => {
                      setMenuId(null)
                      setMenuMode('actions')
                      onSetTemplateGroup(template.id, groupId)
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <IconButton
        name="plus"
        label="New print"
        className="home-fab"
        size={24}
        onClick={onCreateNew}
      />

      {groupDialog && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setGroupDialog(null)
          }}
        >
          <form
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-group-title"
            onSubmit={(event) => {
              event.preventDefault()
              submitGroupDialog()
            }}
          >
            <h2 id="template-group-title">
              {groupDialog.mode === 'create' ? 'New folder' : 'Rename folder'}
            </h2>
            <label className="field">
              <span>Folder name</span>
              <input
                type="text"
                value={groupName}
                spellCheck={false}
                placeholder="e.g. Shipping labels"
                autoFocus
                onChange={(event) => setGroupName(event.target.value)}
                onFocus={handleSelectAllOnFocus}
                onMouseUp={handleSelectAllOnMouseUp}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="button ghost" onClick={() => setGroupDialog(null)}>
                Cancel
              </button>
              <button type="submit" className="button primary" disabled={!groupName.trim()}>
                {groupDialog.mode === 'create' ? 'Create' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

interface FolderCardProps {
  group: TemplateGroup
  count: number
  isDrop: boolean
  onOpen: () => void
  onDragOver: (event: DragEvent) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent) => void
  onRename: () => void
  onDelete: () => void
}

function FolderCard({
  group,
  count,
  isDrop,
  onOpen,
  onDragOver,
  onDragLeave,
  onDrop,
  onRename,
  onDelete
}: FolderCardProps) {
  return (
    <article
      className={`home-folder${isDrop ? ' is-drop' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button type="button" className="home-folder-open" onClick={onOpen}>
        <span className="home-folder-tab" />
        <span className="home-folder-body">
          <Icon name="folder" size={28} />
          <strong className="home-folder-name">{group.name}</strong>
          <span className="home-folder-count">{count === 1 ? '1 template' : `${count} templates`}</span>
        </span>
      </button>
      <div className="home-folder-menu">
        <IconButton name="edit" label={`Rename ${group.name}`} className="mini-button" onClick={onRename} />
        <IconButton
          name="trash"
          label={`Delete ${group.name}`}
          className="mini-button is-danger"
          onClick={onDelete}
        />
      </div>
    </article>
  )
}

interface TemplateCardProps {
  template: LabelTemplate
  groups: TemplateGroup[]
  menuOpen: boolean
  menuMode: 'actions' | 'move'
  onDragStart: (event: DragEvent) => void
  onDragEnd: () => void
  onOpen: () => void
  onToggleMenu: () => void
  onPrint: () => void
  onDuplicate: () => void
  onDelete: () => void
  onMoveMode: () => void
  onMoveTo: (groupId: string | null) => void
}

function TemplateCard({
  template,
  groups,
  menuOpen,
  menuMode,
  onDragStart,
  onDragEnd,
  onOpen,
  onToggleMenu,
  onPrint,
  onDuplicate,
  onDelete,
  onMoveMode,
  onMoveTo
}: TemplateCardProps) {
  const zoom = useMemo(() => {
    const longest = Math.max(template.media.widthMm, template.media.heightMm, 1)
    return PREVIEW_MAX_PX / (longest * getBasePxPerMm())
  }, [template.media.widthMm, template.media.heightMm])

  const { bitmaps } = useMonoBitmaps(template.elements ?? [])
  useCustomFonts(template.elements ?? [])

  return (
    <article
      className={`home-template-card${menuOpen ? ' is-menu-open' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <button type="button" className="home-template-open" onClick={onOpen}>
        <div className="home-template-preview">
          <LabelCanvas
            media={template.media}
            elements={template.elements ?? []}
            fieldValues={{}}
            selectedId={null}
            zoom={zoom}
            mode="select"
            bitmaps={bitmaps}
            readOnly
            onSelect={noop}
            onChange={noop}
            onCreateLine={noop}
            onDropImage={noop}
            onAlign={noop}
            onRotate={noop}
            onDuplicate={noop}
            onDelete={noop}
            onLayer={noop}
          />
        </div>
        <strong className="home-template-name">{template.name}</strong>
      </button>

      <div className="home-card-menu">
        <button
          type="button"
          className="home-card-menu-toggle"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="More actions"
          onClick={(event) => {
            event.stopPropagation()
            onToggleMenu()
          }}
        >
          <Icon name="more" size={16} />
          <span className="visually-hidden">More actions</span>
        </button>
        {menuOpen && (
          <div className={`home-card-menu-list${menuMode === 'move' ? ' is-move' : ''}`} role="menu">
            {menuMode === 'move' ? (
              <>
                {groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    role="menuitem"
                    className="home-move-item"
                    disabled={template.groupId === group.id}
                    onClick={() => onMoveTo(group.id)}
                  >
                    {group.name}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  className="home-move-item"
                  disabled={!template.groupId}
                  onClick={() => onMoveTo(null)}
                >
                  Ungrouped
                </button>
              </>
            ) : (
              <>
                <IconButton name="printer" label="Print" role="menuitem" onClick={onPrint} />
                <IconButton name="duplicate" label="Duplicate" role="menuitem" onClick={onDuplicate} />
                {groups.length > 0 && (
                  <IconButton name="group" label="Move to folder" role="menuitem" onClick={onMoveMode} />
                )}
                <IconButton
                  name="trash"
                  label="Delete"
                  className="is-danger"
                  role="menuitem"
                  onClick={onDelete}
                />
              </>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
