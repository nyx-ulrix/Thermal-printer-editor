import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react'
import {
  inputsOf,
  isInputFilled,
  missingInputs,
  previousTextValues
} from '../lib/fields'
import { loadImage, readFileAsDataUrl, type MonoBitmap } from '../lib/imageMono'
import { handleSelectAllOnFocus, handleSelectAllOnMouseUp } from '../lib/inputSelection'
import type {
  FieldValue,
  FieldValues,
  InputElement,
  LabelElement,
  LabelMedia,
  LabelTemplate,
  SavedPrintFill,
  TemplateGroup
} from '../lib/types'
import { clamp, getBasePxPerMm } from '../lib/units'
import Icon, { IconButton } from './Icon'
import LabelCanvas from './LabelCanvas'
import NumberField from './NumberField'

interface PrintViewProps {
  templates: LabelTemplate[]
  groups: TemplateGroup[]
  activeTemplateId: string | null
  templateName: string
  values: FieldValues
  media: LabelMedia
  elements: LabelElement[]
  bitmaps: Map<string, MonoBitmap>
  copies: number
  busy: boolean
  converting: boolean
  lastPrintedAt: number | null
  history: SavedPrintFill[]
  onValueChange: (key: string, value: FieldValue) => void
  onReorderInputs: (orderedIds: string[]) => void
  onCopiesChange: (copies: number) => void
  onLoadTemplate: (id: string) => void
  onPrint: () => void
  onEditTemplate: () => void
  onReuseFill: (values: FieldValues) => void
  onSaveFill: () => void
  onDeleteFill: (id: string) => void
}

function whenSaved(updatedAt: number): string {
  const date = new Date(updatedAt)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : ''
}

type MoveControl = 'grip' | 'up' | 'down'

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

const PREVIEW_ZOOM = 2
const NARROW_QUERY = '(max-width: 820px)'

/**
 * The preview is drawn at 2x; on a phone that is wider than the screen, so it
 * shrinks to the space left by the page, panel and canvas padding.
 */
function useFittedPreviewZoom(widthMm: number): number {
  const measure = () => {
    if (!window.matchMedia(NARROW_QUERY).matches) return PREVIEW_ZOOM
    const available = window.innerWidth - 32 - 34 - 32 - 8
    const fit = Math.floor((available / (widthMm * getBasePxPerMm())) * 20) / 20
    return clamp(fit, 0.25, PREVIEW_ZOOM)
  }
  const [zoom, setZoom] = useState(measure)
  useEffect(() => {
    const update = () => setZoom(measure())
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
    // measure reads only widthMm and the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widthMm])
  return zoom
}

export default function PrintView({
  templates,
  groups,
  activeTemplateId,
  templateName,
  values,
  media,
  elements,
  bitmaps,
  copies,
  busy,
  converting,
  lastPrintedAt,
  history,
  onValueChange,
  onReorderInputs,
  onCopiesChange,
  onLoadTemplate,
  onPrint,
  onEditTemplate,
  onReuseFill,
  onSaveFill,
  onDeleteFill
}: PrintViewProps) {
  const previewZoom = useFittedPreviewZoom(media.widthMm)
  const firstInput = useRef<HTMLInputElement | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; place: 'before' | 'after' } | null>(null)
  const fieldsRef = useRef<HTMLDivElement | null>(null)
  const pendingFocus = useRef<{ id: string; control: MoveControl } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const inputs = inputsOf(elements)
  const missing = missingInputs(elements, values)
  const missingKeys = new Set(missing.map((input) => input.key))

  useEffect(() => {
    setAttempted(false)
  }, [activeTemplateId])

  useEffect(() => {
    firstInput.current?.focus()
    if (firstInput.current?.type === 'text') firstInput.current.select()
  }, [activeTemplateId, lastPrintedAt])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        setAttempted(true)
        onPrint()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onPrint])

  useEffect(() => {
    const pending = pendingFocus.current
    if (!pending) return
    pendingFocus.current = null
    refocusMoveControl(fieldsRef.current, pending.id, pending.control)
  }, [elements])

  /** Shared by drag-and-drop and the keyboard / touch move controls. */
  function moveInput(sourceId: string, targetId: string, place: 'before' | 'after'): boolean {
    const without = inputs.filter((input) => input.id !== sourceId)
    const targetIndex = without.findIndex((input) => input.id === targetId)
    const insertAt = place === 'before' ? targetIndex : targetIndex + 1
    const moved = inputs.find((input) => input.id === sourceId)
    if (!moved || targetIndex < 0) return false
    const next = [...without.slice(0, insertAt), moved, ...without.slice(insertAt)]
    onReorderInputs(next.map((input) => input.id))
    return true
  }

  function stepInput(index: number, direction: 'up' | 'down', control: MoveControl) {
    const field = inputs[index]
    const target = inputs[direction === 'up' ? index - 1 : index + 1]
    if (!field || !target) return
    pendingFocus.current = { id: field.id, control }
    if (moveInput(field.id, target.id, direction === 'up' ? 'before' : 'after')) {
      setAnnouncement(
        `Moved "${field.label || field.key}" to position ${direction === 'up' ? index : index + 2} of ${inputs.length}.`
      )
    }
  }

  const sorted = [...templates].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="page">
      <div className="page-main">
        <header className="page-header">
          <h1>Print</h1>
          <p className="page-lede">
            Fill in each input for this template, then print. Values are kept for the next
            run, and you can reuse any saved set below.
          </p>
        </header>

        {sorted.length > 0 && (
          <section className="panel">
            <h2>Template</h2>
            {groups.length > 0 ? (
              <div className="print-template-groups">
                {groups.map((group) => {
                  const items = sorted.filter((template) => template.groupId === group.id)
                  if (items.length === 0) return null
                  return (
                    <div key={group.id} className="print-template-group">
                      <span className="presets-label">{group.name}</span>
                      <div className="preset-buttons">
                        {items.map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            className={`chip${template.id === activeTemplateId ? ' is-active' : ''}`}
                            onClick={() => onLoadTemplate(template.id)}
                          >
                            {template.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {sorted.some((template) => !template.groupId) && (
                  <div className="print-template-group">
                    <span className="presets-label">Ungrouped</span>
                    <div className="preset-buttons">
                      {sorted
                        .filter((template) => !template.groupId)
                        .map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            className={`chip${template.id === activeTemplateId ? ' is-active' : ''}`}
                            onClick={() => onLoadTemplate(template.id)}
                          >
                            {template.name}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="preset-buttons">
                {sorted.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className={`chip${template.id === activeTemplateId ? ' is-active' : ''}`}
                    onClick={() => onLoadTemplate(template.id)}
                  >
                    {template.name}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="panel">
          <h2>{templateName || 'Current label'}</h2>

          {inputs.length === 0 ? (
            <p className="panel-hint">
              This template has no input fields yet, so it prints exactly as designed. Add an
              input field from the Design page when you want a value or image filled at print
              time.
            </p>
          ) : (
            <>
              <p className="print-prompt">
                {missing.length === 0
                  ? 'All inputs are filled. Print when you are ready, or reuse a saved set.'
                  : `Fill in ${missing.map((input) => input.label || input.key).join(', ')} before printing.`}
              </p>
              {inputs.length > 1 && (
                <p className="panel-hint">
                  <span className="only-fine-pointer">
                    Drag the handle to change the order these fields appear.
                  </span>
                  <span className="only-coarse-pointer">
                    Use the arrows to change the order these fields appear.
                  </span>
                </p>
              )}

              <div className="print-fields" ref={fieldsRef}>
                {inputs.map((field, index) => (
                  <div
                    key={field.id}
                    className={[
                      'print-field-row',
                      dragId === field.id ? 'is-dragging' : '',
                      drop?.id === field.id ? `is-drop-${drop.place}` : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onDragOver={(event: DragEvent<HTMLDivElement>) => {
                      if (!dragId || dragId === field.id) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      const rect = event.currentTarget.getBoundingClientRect()
                      const place = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                      setDrop({ id: field.id, place })
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      const sourceId = dragId
                      if (!sourceId || sourceId === field.id) {
                        setDragId(null)
                        setDrop(null)
                        return
                      }
                      const rect = event.currentTarget.getBoundingClientRect()
                      const place = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                      moveInput(sourceId, field.id, place)
                      setDragId(null)
                      setDrop(null)
                    }}
                  >
                    {inputs.length > 1 && (
                      <button
                        type="button"
                        className="layer-grip"
                        title="Drag to reorder, or press the up and down arrow keys"
                        aria-label={`Move "${field.label || field.key}"`}
                        aria-keyshortcuts="ArrowUp ArrowDown"
                        data-move-id={field.id}
                        data-move-control="grip"
                        draggable
                        onKeyDown={(event) => {
                          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                          event.preventDefault()
                          stepInput(index, event.key === 'ArrowUp' ? 'up' : 'down', 'grip')
                        }}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', field.id)
                          setDragId(field.id)
                        }}
                        onDragEnd={() => {
                          setDragId(null)
                          setDrop(null)
                        }}
                      >
                        <Icon name="grip" size={14} />
                      </button>
                    )}
                    <PrintField
                      field={field}
                      index={index}
                      firstInput={firstInput}
                      value={values[field.key]}
                      suggestions={previousTextValues(history, field.key)}
                      showError={attempted && missingKeys.has(field.key)}
                      onValueChange={onValueChange}
                      onPrint={() => {
                        setAttempted(true)
                        onPrint()
                      }}
                    />
                    {inputs.length > 1 && (
                      <span className="layer-move-buttons">
                        <button
                          type="button"
                          className="layer-move is-up"
                          title="Move up"
                          aria-label={`Move "${field.label || field.key}" up`}
                          data-move-id={field.id}
                          data-move-control="up"
                          disabled={index === 0}
                          onClick={() => stepInput(index, 'up', 'up')}
                        >
                          <Icon name="chevron" size={14} />
                        </button>
                        <button
                          type="button"
                          className="layer-move is-down"
                          title="Move down"
                          aria-label={`Move "${field.label || field.key}" down`}
                          data-move-id={field.id}
                          data-move-control="down"
                          disabled={index === inputs.length - 1}
                          onClick={() => stepInput(index, 'down', 'down')}
                        >
                          <Icon name="chevron" size={14} />
                        </button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <p className="visually-hidden" aria-live="polite">
                {announcement}
              </p>
            </>
          )}

          <div className="print-actions">
            <NumberField
              className="field copies"
              label="Copies"
              value={copies}
              min={1}
              max={999}
              step={1}
              onCommit={(value) => onCopiesChange(clamp(Math.round(value) || 1, 1, 999))}
            />
            <IconButton
              name="printer"
              label={busy ? 'Sending...' : `Print ${copies} label${copies === 1 ? '' : 's'}`}
              className="button primary print-button"
              disabled={busy || converting}
              onClick={() => {
                setAttempted(true)
                onPrint()
              }}
            />
            {inputs.length > 0 && (
              <IconButton
                name="bookmark"
                label="Save these values"
                className="button ghost"
                onClick={onSaveFill}
              />
            )}
            <IconButton
              name="edit"
              label="Edit template"
              className="button ghost"
              onClick={onEditTemplate}
            />
          </div>

          <p className="panel-hint only-fine-pointer">
            Ctrl+Enter prints from anywhere on this page.
          </p>
        </section>

        {inputs.length > 0 && (
          <section className="panel">
            <h2>Saved values</h2>
            {history.length === 0 ? (
              <p className="panel-hint">
                After you print or save, those details stay here so the next run can reuse them.
              </p>
            ) : (
              <ul className="saved-fills">
                {history.map((fill) => (
                  <li key={fill.id} className="saved-fill">
                    <button type="button" className="saved-fill-apply" onClick={() => onReuseFill(fill.values)}>
                      <span className="element-name">{fill.label}</span>
                      <span className="element-meta">{whenSaved(fill.savedAt)}</span>
                    </button>
                    <IconButton
                      name="trash"
                      label="Remove saved values"
                      className="mini-button is-danger"
                      onClick={() => onDeleteFill(fill.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <aside className="page-aside">
        <section className="panel">
          <h2>What will print</h2>
          <LabelCanvas
            media={media}
            elements={elements}
            fieldValues={values}
            selectedId={null}
            zoom={previewZoom}
            mode="select"
            bitmaps={bitmaps}
            readOnly
            onSelect={() => undefined}
            onChange={() => undefined}
            onCreateLine={() => undefined}
            onDropImage={() => undefined}
            onAlign={() => undefined}
            onRotate={() => undefined}
            onDuplicate={() => undefined}
            onDelete={() => undefined}
            onLayer={() => undefined}
          />
        </section>
      </aside>
    </div>
  )
}

interface PrintFieldProps {
  field: InputElement
  index: number
  firstInput: RefObject<HTMLInputElement | null>
  value: FieldValue | undefined
  suggestions: string[]
  showError: boolean
  onValueChange: (key: string, value: FieldValue) => void
  onPrint: () => void
}

function PrintField({
  field,
  index,
  firstInput,
  value,
  suggestions,
  showError,
  onValueChange,
  onPrint
}: PrintFieldProps) {
  const textValue = value?.contentType === 'text' ? value.text : ''
  const imageName = value?.contentType === 'image' ? value.name : ''
  const filled = isInputFilled(field, value)
  const listId = `print-suggestions-${field.id}`

  return (
    <label className={`field${showError ? ' is-missing' : ''}`}>
      <span>
        {field.label || field.key}
        {field.increment && field.contentType === 'text' && ' (counts up)'}
      </span>
      {field.contentType === 'text' ? (
        <>
          <input
            ref={index === 0 ? firstInput : undefined}
            type="text"
            value={textValue}
            placeholder={field.defaultText || `Enter ${field.label || field.key}`}
            spellCheck={false}
            list={suggestions.length > 0 ? listId : undefined}
            required
            onChange={(event) =>
              onValueChange(field.key, { contentType: 'text', text: event.target.value })
            }
            onFocus={handleSelectAllOnFocus}
            onMouseUp={handleSelectAllOnMouseUp}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              const textInputs = [
                ...(event.currentTarget
                  .closest('.print-fields')
                  ?.querySelectorAll('input[type="text"]') ?? [])
              ] as HTMLInputElement[]
              const next = textInputs[textInputs.indexOf(event.currentTarget) + 1]
              if (next) next.focus()
              else onPrint()
            }}
          />
          {suggestions.length > 0 && (
            <datalist id={listId}>
              {suggestions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          )}
        </>
      ) : (
        <>
          <input
            ref={index === 0 ? firstInput : undefined}
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              void (async () => {
                const sourceDataUrl = await readFileAsDataUrl(file)
                const image = await loadImage(sourceDataUrl)
                onValueChange(field.key, {
                  contentType: 'image',
                  sourceDataUrl,
                  name: file.name,
                  aspectRatio:
                    image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1
                })
              })()
            }}
          />
          <small className="panel-hint">
            {imageName
              ? `Using ${imageName}`
              : filled
                ? `Using ${field.imageStyle.name || 'the template default image'}`
                : 'Choose the image that should print in this slot.'}
          </small>
        </>
      )}
      {showError && (
        <small className="field-error">
          {field.contentType === 'image' ? 'Choose an image to print.' : 'This value is required.'}
        </small>
      )}
    </label>
  )
}
