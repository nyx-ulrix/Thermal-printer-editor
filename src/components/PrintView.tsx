import { useEffect, useRef, useState, type RefObject } from 'react'
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
  SavedPrintFill
} from '../lib/types'
import { clamp } from '../lib/units'
import { IconButton } from './Icon'
import LabelCanvas from './LabelCanvas'
import NumberField from './NumberField'

interface PrintViewProps {
  templates: LabelTemplate[]
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

export default function PrintView({
  templates,
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
  onCopiesChange,
  onLoadTemplate,
  onPrint,
  onEditTemplate,
  onReuseFill,
  onSaveFill,
  onDeleteFill
}: PrintViewProps) {
  const firstInput = useRef<HTMLInputElement | null>(null)
  const [attempted, setAttempted] = useState(false)
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

              <div className="print-fields">
                {inputs.map((field, index) => (
                  <PrintField
                    key={field.id}
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
                ))}
              </div>
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

          <p className="panel-hint">Ctrl+Enter prints from anywhere on this page.</p>
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
            zoom={2}
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
