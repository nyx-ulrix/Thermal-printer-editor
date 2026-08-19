import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CanvasFooter from './components/CanvasFooter'
import ElementsPanel from './components/ElementsPanel'
import FontsPanel from './components/FontsPanel'
import HomeView from './components/HomeView'
import LabelCanvas, { type CanvasMode, type NewLine } from './components/LabelCanvas'
import MediaPanel from './components/MediaPanel'
import PrintView from './components/PrintView'
import PropertiesPanel from './components/PropertiesPanel'
import SaveTemplateDialog from './components/SaveTemplateDialog'
import SettingsView from './components/SettingsView'
import TemplatesPanel from './components/TemplatesPanel'
import Toolbar, { type Status } from './components/Toolbar'
import { useCustomFonts } from './hooks/useCustomFonts'
import { useDesignHistory } from './hooks/useDesignHistory'
import { useMonoBitmaps } from './hooks/useMonoBitmaps'
import { useSelectOnFocus } from './hooks/useSelectOnFocus'
import { useTheme } from './hooks/useTheme'
import {
  describeFill,
  incrementFields,
  inputsOf,
  measureStyledTextMm,
  mergeValues,
  missingInputs,
  normalizeLabelElement,
  resolveElements
} from './lib/fields'
import { detectImageContentFromImage, loadImage, readFileAsDataUrl } from './lib/imageMono'
import {
  anchorForBounds,
  elementBoundsMm,
  nextRotation,
  rotationPatch
} from './lib/preview'
import { alignedPosition, moveElementBy, type Alignment, type AlignScope } from './lib/snapping'
import { alignGroupChildren, constrainElementsToMedia, ungroupById } from './lib/groupLayout'
import { isContinuous, matchingMediaPreset, type MediaPreset, withMediaDefaults } from './lib/media'
import { loadAppSettings, saveAppSettings, type AppSettings } from './lib/appSettings'
import {
  loadFieldValues,
  loadFontLibrary,
  loadPrintHistory,
  loadSession,
  loadTemplates,
  loadTemplatesAsync,
  loadTemplateGroups,
  rememberPrintFill,
  saveFieldValues,
  saveFontLibrary,
  savePrintHistory,
  saveSession,
  saveTemplates,
  saveTemplateGroups
} from './lib/storage'
import { cloneElement, findElement, groupSelected, groupingSiblingIds, isImageLike, layerById, assignPrintOrder, moveElementAmongSiblings, moveRootOf, patchElement, removeById } from './lib/tree'
import { collectStyledText, defaultTextStyle, isStyledText, textStyleOf, textStylePatch } from './lib/fontSize'
import { buildRasterTsplBytes, buildTsplBytes, tsplMediaHeader } from './lib/tspl'
import type {
  AppView,
  ElementPatch,
  FieldValues,
  FontLibraryItem,
  ImageElement,
  InputElement,
  LabelElement,
  LabelJob,
  LabelMedia,
  LabelTemplate,
  LineElement,
  PrinterInfo,
  SavedPrintFill,
  TemplateGroup,
  TextElement,
  TextStyle,
  TextAlign,
  VerticalAlign
} from './lib/types'
import { applyDpi, clamp, formatMm, getDotsPerMm, roundMm } from './lib/units'

/** Three dots at 203 DPI, thin enough to look like a rule rather than a bar. */
const DEFAULT_LINE_THICKNESS_MM = 0.375

const IMAGE_MARGIN_MM = 2

function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `el-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function createTextElement(media: LabelMedia, count: number, style: TextStyle): TextElement {
  const offset = (count % 5) * 2
  return {
    id: newId(),
    type: 'text',
    xMm: clamp(2 + offset, 0, media.widthMm),
    yMm: clamp(2 + offset, 0, media.heightMm),
    text: 'New text',
    rotation: 0,
    ...style
  }
}

function createInputElement(media: LabelMedia, count: number, style: TextStyle): InputElement {
  const offset = (count % 5) * 2
  const index = count + 1
  const line = measureStyledTextMm(style, 'M')
  return {
    id: newId(),
    type: 'input',
    xMm: clamp(2 + offset, 0, media.widthMm),
    yMm: clamp(2 + offset, 0, media.heightMm),
    rotation: 0,
    key: `input${index}`,
    label: `Input ${index}`,
    contentType: 'text',
    defaultText: `Input ${index}`,
    increment: false,
    widthMm: 24,
    heightMm: roundMm(Math.max(line.heightMm * 2, 8)),
    textAlign: 'left',
    verticalAlign: 'top',
    textStyle: style,
    imageStyle: {
      name: '',
      sourceDataUrl: '',
      widthMm: 16,
      heightMm: 16,
      aspectRatio: 1,
      threshold: 128,
      dither: false,
      invert: false
    }
  }
}

function lastPresetMedia(presets: MediaPreset[]): LabelMedia {
  const session = loadSession()
  const media = withMediaDefaults(session.media)
  const preset = session.lastPreset ?? matchingMediaPreset(media.widthMm, media.heightMm, presets)
  if (!preset) return media
  return { ...media, widthMm: preset.widthMm, heightMm: preset.heightMm }
}

function normalizeElement(element: LabelElement): LabelElement {
  return normalizeLabelElement(element)
}

export default function App() {
  const [view, setView] = useState<AppView>('home')
  const [settings, setSettings] = useState(() => {
    const loaded = loadAppSettings()
    applyDpi(loaded.dpi)
    return loaded
  })
  const [media, setMedia] = useState<LabelMedia>(() => withMediaDefaults(loadSession().media))
  const [fontLibrary, setFontLibrary] = useState<FontLibraryItem[]>(loadFontLibrary)
  const [elements, setElements] = useState<LabelElement[]>(() => {
    const initialSettings = loadAppSettings()
    applyDpi(initialSettings.dpi)
    const initialMedia = withMediaDefaults(loadSession().media)
    const style = defaultTextStyle(
      initialSettings.defaultFont,
      initialSettings.defaultSizePt,
      loadFontLibrary()
    )
    return constrainElementsToMedia(
      [{ ...createTextElement(initialMedia, 0, style), text: 'Sample label' }],
      initialMedia
    )
  })
  const [values, setValues] = useState<FieldValues>(() => loadFieldValues()['current'] ?? {})
  const [printHistory, setPrintHistory] = useState<Record<string, SavedPrintFill[]>>(loadPrintHistory)
  const [templates, setTemplates] = useState<LabelTemplate[]>(() =>
    typeof window.appCache === 'undefined' ? loadTemplates() : []
  )
  const [templateGroups, setTemplateGroups] = useState<TemplateGroup[]>(loadTemplateGroups)
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('Untitled label')
  const [dirty, setDirty] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mode, setMode] = useState<CanvasMode>('select')
  const [copies, setCopies] = useState<number>(() => loadSession().copies ?? 1)
  const [printerName, setPrinterName] = useState<string>(() => loadSession().printerName ?? '')
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [zoom, setZoom] = useState(2)
  const [busy, setBusy] = useState(false)
  const [showTspl, setShowTspl] = useState(false)
  const [saveNameOpen, setSaveNameOpen] = useState(false)
  const [saveNameDraft, setSaveNameDraft] = useState('')
  const [lastPrintedAt, setLastPrintedAt] = useState<number | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' })

  const bridgeAvailable = typeof window.printer !== 'undefined'
  useCustomFonts(elements, fontLibrary)
  const theme = useTheme()
  useSelectOnFocus()
  const history = useDesignHistory({ media, elements })
  const designRef = useRef({ media, elements })
  designRef.current = { media, elements }
  const restoringHistory = useRef(false)
  const resettingHistory = useRef(false)

  const applyElements = useCallback(
    (updater: LabelElement[] | ((current: LabelElement[]) => LabelElement[])) => {
      setElements((current) => {
        const next = typeof updater === 'function' ? updater(current) : updater
        return constrainElementsToMedia(next, media)
      })
    },
    [media]
  )

  const resolvedValues = useMemo(() => mergeValues(elements, values), [elements, values])
  const resolvedElements = useMemo(
    () => resolveElements(elements, resolvedValues),
    [elements, resolvedValues]
  )
  const { bitmaps, converting, error: conversionError } = useMonoBitmaps(resolvedElements)
  const job = useMemo<LabelJob>(
    () => ({ media, elements: resolvedElements, copies }),
    [media, resolvedElements, copies]
  )
  const tsplPreview = useMemo(
    () =>
      !showTspl
        ? ''
        : [
            '# Rasterized label print',
            '# All output is rendered to a monochrome bitmap, including text and custom TTF fonts.',
            ...tsplMediaHeader(job.media),
            'BITMAP 0,0,<whole-label bitmap>',
            `PRINT 1,${copies}`
          ].join('\r\n'),
    [showTspl, job, copies]
  )
  const selectedId = selectedIds[selectedIds.length - 1] ?? null
  const selected = selectedId ? findElement(elements, selectedId) : null
  const selectedElements = useMemo(
    () =>
      selectedIds
        .map((id) => findElement(elements, id))
        .filter((item): item is LabelElement => item !== null),
    [elements, selectedIds]
  )
  const canGroup = groupingSiblingIds(elements, selectedIds).length >= 2

  const patchSelectedTextStyles = useCallback(
    (mutate: (style: TextStyle) => TextStyle) => {
      applyElements((current) => {
        let next = current
        for (const id of selectedIds) {
          const element = findElement(next, id)
          if (!element) continue
          const targets =
            element.type === 'group' ? collectStyledText([element]) : isStyledText(element) ? [element] : []
          for (const target of targets) {
            const style = textStyleOf(target)
            if (!style) continue
            const patch = textStylePatch(target, mutate(style))
            if (patch) next = patchElement(next, target.id, patch)
          }
        }
        return next
      })
    },
    [applyElements, selectedIds]
  )

  const patchSelectedInputAlign = useCallback(
    (patch: { textAlign?: TextAlign; verticalAlign?: VerticalAlign }) => {
      applyElements((current) => {
        let next = current
        for (const id of selectedIds) {
          const element = findElement(next, id)
          if (!element) continue
          const targets =
            element.type === 'group'
              ? collectStyledText([element]).filter((item) => item.type === 'input')
              : element.type === 'input' && element.contentType === 'text'
                ? [element]
                : []
          for (const target of targets) {
            next = patchElement(next, target.id, patch)
          }
        }
        return next
      })
    },
    [applyElements, selectedIds]
  )
  // The first run of this effect is the mount, which is not an edit.
  const skipDirty = useRef(true)
  useEffect(() => {
    if (skipDirty.current) {
      skipDirty.current = false
      return
    }
    setDirty(true)
  }, [media, elements, copies])

  useEffect(() => {
    if (conversionError) setStatus({ kind: 'error', message: conversionError })
  }, [conversionError])

  useEffect(() => {
    if (typeof window.appCache === 'undefined') return
    let cancelled = false
    void loadTemplatesAsync()
      .then((list) => {
        if (!cancelled) setTemplates(list)
      })
      .catch(() => {
        if (!cancelled) setTemplates([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const refreshPrinters = useCallback(async () => {
    const bridge = window.printer
    if (!bridge) return

    try {
      const found = await bridge.listPrinters()
      setPrinters(found)
      setPrinterName((current) => {
        if (current && found.some((printer) => printer.name === current)) return current
        const preferred =
          found.find((printer) => /GP-?3120/i.test(printer.displayName)) ??
          found.find((printer) => printer.isDefault)
        return preferred?.name ?? ''
      })
    } catch (error) {
      setStatus({
        kind: 'error',
        message: `Could not list printers: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  }, [])

  useEffect(() => {
    void refreshPrinters()
  }, [refreshPrinters])

  useEffect(() => {
    saveSession({
      media,
      copies,
      printerName,
      lastPreset:
        matchingMediaPreset(media.widthMm, media.heightMm, settings.mediaPresets) ??
        loadSession().lastPreset
    })
  }, [media, copies, printerName, settings.mediaPresets])

  useEffect(() => {
    saveFontLibrary(fontLibrary)
  }, [fontLibrary])

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch }
      applyDpi(next.dpi)
      saveAppSettings(next)
      return next
    })
  }, [])

  const valuesKey = activeTemplateId ?? 'current'
  useEffect(() => {
    saveFieldValues({ ...loadFieldValues(), [valuesKey]: values })
  }, [values, valuesKey])

  useEffect(() => {
    savePrintHistory(printHistory)
  }, [printHistory])

  useEffect(() => {
    if (restoringHistory.current) {
      restoringHistory.current = false
      return
    }
    if (resettingHistory.current) {
      resettingHistory.current = false
      history.reset(media, elements)
      return
    }
    history.record(media, elements)
  }, [media, elements, history.record, history.reset])

  const didFitToMedia = useRef(false)
  useEffect(() => {
    if (view !== 'design' || didFitToMedia.current) return
    didFitToMedia.current = true
    applyElements((current) => current)
  }, [view, applyElements])

  const updateElement = useCallback(
    (id: string, patch: ElementPatch) => {
      setElements((current) => {
        const next = patchElement(current, id, patch)
        if (history.isGesture()) return next
        return constrainElementsToMedia(next, media)
      })
    },
    [media, history]
  )

  const selectElement = useCallback((id: string | null, additive = false) => {
    if (!id) {
      setSelectedIds([])
      return
    }
    setSelectedIds((current) => {
      if (additive) {
        return current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
      }
      return [id]
    })
  }, [])

  const selectIds = useCallback((ids: string[]) => {
    setSelectedIds(ids)
  }, [])

  const groupSelection = useCallback(() => {
    applyElements((current) => {
      const result = groupSelected(current, selectedIds, newId())
      if (!result) return current
      setSelectedIds([result.groupId])
      return result.elements
    })
  }, [applyElements, selectedIds])

  const ungroupSelection = useCallback(() => {
    applyElements((current) => {
      let next = current
      const released: string[] = []
      for (const id of selectedIds) {
        const element = findElement(next, id)
        if (!element || element.type !== 'group') continue
        released.push(...element.children.map((child) => child.id))
        next = ungroupById(next, id)
      }
      if (released.length > 0) setSelectedIds(released)
      return next
    })
  }, [applyElements, selectedIds])

  const toggleGroupSelection = useCallback(() => {
    if (canGroup) groupSelection()
    else ungroupSelection()
  }, [canGroup, groupSelection, ungroupSelection])

  const removeElement = useCallback(
    (id: string) => {
      applyElements((current) => removeById(current, id))
      setSelectedIds((current) => current.filter((item) => item !== id))
    },
    [applyElements]
  )

  const duplicateElement = useCallback(
    (id: string) => {
      applyElements((current) => {
        const source = findElement(current, id)
        if (!source) return current
        const copy = cloneElement(source, newId)
        copy.xMm = roundMm(copy.xMm + 2)
        copy.yMm = roundMm(copy.yMm + 2)
        setSelectedIds([copy.id])
        return [...current, copy]
      })
    },
    [applyElements]
  )

  const rotateElement = useCallback(
    (id: string) => {
      const element = findElement(elements, id)
      if (!element) return
      updateElement(id, rotationPatch(element, nextRotation(element.rotation)))
    },
    [elements, updateElement]
  )

  const alignElement = useCallback(
    (id: string, alignment: Alignment, scope: AlignScope = 'label') => {
      const ids = selectedIds.includes(id) ? selectedIds : [id]
      applyElements((current) => {
        let next = current
        for (const targetId of ids) {
          const element = findElement(next, targetId)
          if (!element) continue
          if (scope === 'label') {
            const bounds = elementBoundsMm(element)
            const target = alignedPosition(bounds, media, alignment)
            next = patchElement(next, targetId, anchorForBounds(element, target.xMm, target.yMm))
            continue
          }
          if (element.type === 'group') {
            const aligned = alignGroupChildren(element, alignment, scope)
            next = patchElement(next, targetId, {
              children: aligned.children,
              freeform: true
            })
            continue
          }
          const matches = scope === 'text' ? isStyledText(element) : isImageLike(element)
          if (!matches) continue
          const bounds = elementBoundsMm(element)
          const target = alignedPosition(bounds, media, alignment)
          next = patchElement(next, targetId, anchorForBounds(element, target.xMm, target.yMm))
        }
        return next
      })
    },
    [applyElements, media, selectedIds]
  )

  const layerElement = useCallback(
    (id: string, position: 'front' | 'back') => {
      applyElements((current) => layerById(current, id, position))
    },
    [applyElements]
  )

  const addText = useCallback(() => {
    const style = defaultTextStyle(settings.defaultFont, settings.defaultSizePt, fontLibrary)
    const element = createTextElement(media, elements.length, style)
    applyElements((current) => [...current, element])
    selectElement(element.id)
    setMode('select')
  }, [media, elements.length, selectElement, applyElements, settings, fontLibrary])

  const addInput = useCallback(() => {
    const style = defaultTextStyle(settings.defaultFont, settings.defaultSizePt, fontLibrary)
    const element = createInputElement(media, elements.length, style)
    applyElements((current) => [...current, element])
    selectElement(element.id)
    setMode('select')
  }, [media, elements.length, selectElement, applyElements, settings, fontLibrary])

  const createLine = useCallback((line: NewLine) => {
    const base: LineElement = {
      id: newId(),
      type: 'line',
      xMm: line.xMm,
      yMm: line.yMm,
      rotation: line.rotation,
      lengthMm: Math.max(roundMm(line.lengthMm), 0.5),
      thicknessMm: DEFAULT_LINE_THICKNESS_MM
    }
    // The drag describes the box the operator swept out, so solve for the anchor.
    const element: LineElement = { ...base, ...anchorForBounds(base, line.xMm, line.yMm) }

    applyElements((current) => [...current, element])
    selectElement(element.id)
    setMode('select')
  }, [selectElement, applyElements])

  const addImage = useCallback(
    async (file: File, atXMm?: number, atYMm?: number) => {
      try {
        const sourceDataUrl = await readFileAsDataUrl(file)
        const image = await loadImage(sourceDataUrl)
        const crop = detectImageContentFromImage(image, 128, false)
        const aspectRatio = crop.aspectRatio || 1

        // Start at one image pixel per printer dot, shrunk to fit inside the label.
        let widthMm = crop.width / getDotsPerMm()
        let heightMm = widthMm / aspectRatio
        const maxWidthMm = Math.max(media.widthMm - IMAGE_MARGIN_MM * 2, 5)
        const maxHeightMm = Math.max(media.heightMm - IMAGE_MARGIN_MM * 2, 5)
        const fit = Math.min(1, maxWidthMm / widthMm, maxHeightMm / heightMm)
        widthMm = roundMm(widthMm * fit)
        heightMm = roundMm(heightMm * fit)

        const element: ImageElement = {
          id: newId(),
          type: 'image',
          name: file.name,
          sourceDataUrl,
          xMm: atXMm ?? IMAGE_MARGIN_MM,
          yMm: atYMm ?? IMAGE_MARGIN_MM,
          rotation: 0,
          widthMm,
          heightMm,
          aspectRatio,
          threshold: 128,
          dither: false,
          invert: false
        }

        applyElements((current) => [...current, element])
        selectElement(element.id)
        setMode('select')
        setStatus({ kind: 'ok', message: `${file.name} converted to black and white.` })
      } catch (error) {
        setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
      }
    },
    [media.widthMm, media.heightMm, selectElement, applyElements]
  )

  const finishGesture = useCallback(() => {
    const current = designRef.current
    const fitted = constrainElementsToMedia(current.elements, current.media)
    if (fitted !== current.elements) setElements(fitted)
    history.endGesture(current.media, fitted)
  }, [history])

  const undoDesign = useCallback(() => {
    const snap = history.undo()
    if (!snap) return
    restoringHistory.current = true
    setMedia(snap.media)
    setElements(snap.elements)
  }, [history])

  const redoDesign = useCallback(() => {
    const snap = history.redo()
    if (!snap) return
    restoringHistory.current = true
    setMedia(snap.media)
    setElements(snap.elements)
  }, [history])

  useEffect(() => {
    if (view !== 'design') return

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName ?? ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redoDesign()
        else undoDesign()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redoDesign()
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault()
        if (event.shiftKey) ungroupSelection()
        else toggleGroupSelection()
        return
      }

      if (event.key === 'Escape' && mode === 'line') {
        setMode('select')
        return
      }
      if (!selectedId) return

      const moving = moveRootOf(elements, selectedId)
      if (!moving) return

      const step = event.shiftKey ? 1 : 0.2
      const nudge = (dxMm: number, dyMm: number) => {
        event.preventDefault()
        updateElement(moving.id, moveElementBy(moving, dxMm, dyMm, media))
      }

      switch (event.key) {
        case 'Delete':
        case 'Backspace':
          event.preventDefault()
          removeElement(selectedId)
          break
        case 'ArrowLeft':
          nudge(-step, 0)
          break
        case 'ArrowRight':
          nudge(step, 0)
          break
        case 'ArrowUp':
          nudge(0, -step)
          break
        case 'ArrowDown':
          nudge(0, step)
          break
        case 'r':
        case 'R':
          event.preventDefault()
          rotateElement(moving.id)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    view,
    selectedId,
    selectedIds,
    elements,
    mode,
    media,
    removeElement,
    rotateElement,
    updateElement,
    groupSelection,
    ungroupSelection,
    toggleGroupSelection,
    undoDesign,
    redoDesign
  ])

  const send = useCallback(
    async (payload: Uint8Array, description: string): Promise<boolean> => {
      const bridge = window.printer
      if (!bridge) {
        setStatus({
          kind: 'error',
          message: 'Printer bridge unavailable. Run the Electron app rather than a plain browser.'
        })
        return false
      }
      if (printerName === '') {
        setStatus({ kind: 'error', message: 'Select a printer first.' })
        return false
      }

      setBusy(true)
      setStatus({ kind: 'busy', message: `Sending ${description}...` })

      const result = await bridge.printRaw(printerName, payload)
      setBusy(false)
      setStatus(
        result.ok
          ? { kind: 'ok', message: `${description} sent to ${printerName}.` }
          : { kind: 'error', message: result.error ?? 'Printing failed.' }
      )
      return result.ok
    },
    [printerName]
  )

  const rememberCurrentFill = useCallback(() => {
    if (inputsOf(elements).length === 0) return
    const fill: SavedPrintFill = {
      id: newId(),
      savedAt: Date.now(),
      label: describeFill(elements, values),
      values
    }
    setPrintHistory((current) => rememberPrintFill(current, valuesKey, fill))
  }, [elements, values, valuesKey])

  const handlePrint = useCallback(() => {
    const missing = missingInputs(elements, values)
    if (missing.length > 0) {
      setView('print')
      setStatus({
        kind: 'error',
        message: `Fill in ${missing.map((input) => input.label || input.key).join(', ')} before printing.`
      })
      return
    }
    const hasContent = resolvedElements.some(
      (element) => element.type !== 'text' || element.text.trim() !== ''
    )
    if (!hasContent) {
      setStatus({ kind: 'error', message: 'Add something to the label before printing.' })
      return
    }
    if (converting) {
      setStatus({ kind: 'busy', message: 'Still converting images, try again in a moment.' })
      return
    }

    void (async () => {
      const payload = await buildRasterTsplBytes(job, bitmaps)
      const unit = isContinuous(job.media)
        ? copies === 1
          ? 'copy'
          : 'copies'
        : copies === 1
          ? 'label'
          : 'labels'
      const ok = await send(payload, `${copies} ${unit}`)
      if (!ok) return

      setLastPrintedAt(Date.now())
      rememberCurrentFill()
      if (inputsOf(elements).some((element) => element.increment)) {
        setValues(incrementFields(elements, resolvedValues))
      }
    })()
  }, [elements, values, resolvedElements, converting, job, bitmaps, copies, resolvedValues, send, rememberCurrentFill])

  const handleTestPrint = useCallback(() => {
    const testJob: LabelJob = {
      media,
      copies: 1,
      elements: [
        {
          id: 'test-title',
          type: 'text',
          xMm: 2,
          yMm: 2,
          text: 'GP-3120TL TEST',
          font: 'thermal-classic',
          rotation: 0,
          scaleX: 16,
          scaleY: 16
        },
        {
          id: 'test-size',
          type: 'text',
          xMm: 2,
          yMm: 8,
          text: `${formatMm(media.widthMm)} x ${formatMm(media.heightMm)} mm${
            media.stock === 'continuous' ? ' continuous' : ''
          }`,
          font: 'thermal-classic',
          rotation: 0,
          scaleX: 12,
          scaleY: 12
        },
        {
          id: 'test-rule',
          type: 'line',
          xMm: 2,
          yMm: 13,
          rotation: 0,
          lengthMm: Math.max(media.widthMm - 4, 4),
          thicknessMm: DEFAULT_LINE_THICKNESS_MM
        },
        {
          id: 'test-time',
          type: 'text',
          xMm: 2,
          yMm: 15,
          text: new Date().toLocaleString(),
          font: 'thermal-classic',
          rotation: 0,
          scaleX: 10,
          scaleY: 10
        }
      ]
    }
    void send(buildTsplBytes(testJob, new Map()), 'test print')
  }, [media, send])

  const copyTspl = useCallback(() => {
    void navigator.clipboard
      .writeText(tsplPreview)
      .then(() => setStatus({ kind: 'ok', message: 'TSPL copied to clipboard.' }))
      .catch(() => setStatus({ kind: 'error', message: 'Could not copy TSPL.' }))
  }, [tsplPreview])

  const saveTemplate = useCallback(
    (asCopy: boolean, nameOverride?: string) => {
      const trimmed = (nameOverride ?? templateName).trim() || 'Untitled label'
      const id = asCopy || !activeTemplateId ? newId() : activeTemplateId
      const name = asCopy ? `${trimmed} copy` : trimmed

      const current = templates.find((item) => item.id === (asCopy ? activeTemplateId : id))
      const now = Date.now()
      const template: LabelTemplate = {
        id,
        name,
        createdAt: asCopy || !current?.createdAt ? now : current.createdAt,
        updatedAt: now,
        media,
        elements,
        copies,
        groupId: current?.groupId
      }
      const next = [...templates.filter((item) => item.id !== id), template]

      setTemplates(next)
      saveTemplates(next)
      setActiveTemplateId(id)
      setTemplateName(name)
      setDirty(false)
      setSaveNameOpen(false)
      setStatus({ kind: 'ok', message: `Saved template "${name}".` })
    },
    [templateName, activeTemplateId, media, elements, copies, templates]
  )

  const requestSave = useCallback(() => {
    if (activeTemplateId) {
      saveTemplate(false)
      return
    }
    const draft = templateName.trim() === 'Untitled label' ? '' : templateName.trim()
    setSaveNameDraft(draft)
    setSaveNameOpen(true)
  }, [activeTemplateId, templateName, saveTemplate])

  const confirmNamedSave = useCallback(() => {
    const trimmed = saveNameDraft.trim()
    if (!trimmed) return
    saveTemplate(false, trimmed)
  }, [saveNameDraft, saveTemplate])

  useEffect(() => {
    function handleSaveKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey) return
      if (event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (saveNameOpen) {
        confirmNamedSave()
        return
      }
      requestSave()
    }
    window.addEventListener('keydown', handleSaveKey)
    return () => window.removeEventListener('keydown', handleSaveKey)
  }, [saveNameOpen, requestSave, confirmNamedSave])

  const loadTemplate = useCallback(
    (id: string, nextView: AppView = 'design') => {
      const template = templates.find((item) => item.id === id)
      if (!template) return

      skipDirty.current = true
      resettingHistory.current = true
      const nextMedia = withMediaDefaults(template.media)
      setMedia(nextMedia)
      setElements(constrainElementsToMedia(template.elements.map(normalizeElement), nextMedia))
      setCopies(template.copies ?? 1)
      setValues(loadFieldValues()[id] ?? {})
      setActiveTemplateId(id)
      setTemplateName(template.name)
      setSelectedIds([])
      setMode('select')
      setView(nextView)
      setDirty(false)
      setStatus({ kind: 'ok', message: `Opened "${template.name}".` })
    },
    [templates]
  )

  const deleteTemplate = useCallback(
    (id: string) => {
      const next = templates.filter((item) => item.id !== id)
      setTemplates(next)
      saveTemplates(next)
      if (activeTemplateId === id) setActiveTemplateId(null)
      if (activeTemplateId === id) setView('home')
    },
    [templates, activeTemplateId]
  )

  const duplicateTemplate = useCallback(
    (id: string) => {
      const source = templates.find((item) => item.id === id)
      if (!source) return
      const now = Date.now()
      const copy: LabelTemplate = {
        ...source,
        id: newId(),
        name: `${source.name} copy`,
        createdAt: now,
        updatedAt: now
      }
      const next = [copy, ...templates]
      setTemplates(next)
      saveTemplates(next)
      setStatus({ kind: 'ok', message: `Duplicated "${source.name}".` })
    },
    [templates]
  )

  const createTemplateGroup = useCallback((name: string) => {
    const group: TemplateGroup = { id: newId(), name }
    setTemplateGroups((current) => {
      const next = [...current, group]
      saveTemplateGroups(next)
      return next
    })
    return group.id
  }, [])

  const renameTemplateGroup = useCallback((id: string, name: string) => {
    setTemplateGroups((current) => {
      const next = current.map((group) => (group.id === id ? { ...group, name } : group))
      saveTemplateGroups(next)
      return next
    })
  }, [])

  const deleteTemplateGroup = useCallback((id: string) => {
    setTemplateGroups((current) => {
      const next = current.filter((group) => group.id !== id)
      saveTemplateGroups(next)
      return next
    })
    setTemplates((current) => {
      const next = current.map((template) =>
        template.groupId === id ? { ...template, groupId: undefined } : template
      )
      saveTemplates(next)
      return next
    })
  }, [])

  const setTemplateGroup = useCallback((templateId: string, groupId: string | null) => {
    setTemplates((current) => {
      const next = current.map((template) =>
        template.id === templateId ? { ...template, groupId: groupId || undefined } : template
      )
      saveTemplates(next)
      return next
    })
  }, [])

  const newLabel = useCallback(() => {
    skipDirty.current = true
    resettingHistory.current = true
    setElements([])
    setValues({})
    setActiveTemplateId(null)
    setTemplateName('Untitled label')
    setSelectedIds([])
    setMode('select')
    setMedia(lastPresetMedia(settings.mediaPresets))
    setCopies(1)
    setView('design')
    setDirty(false)
  }, [settings.mediaPresets])

  return (
    <div className={`app view-${view}`}>
      <Toolbar
        view={view}
        documentName={templateName}
        printers={printers}
        printerName={printerName}
        copies={copies}
        busy={busy}
        bridgeAvailable={bridgeAvailable}
        status={status}
        onViewChange={setView}
        onPrinterChange={setPrinterName}
        onCopiesChange={(value) => setCopies(clamp(Math.round(value) || 1, 1, 999))}
        onRefreshPrinters={() => void refreshPrinters()}
        onPrint={handlePrint}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={undoDesign}
        onRedo={redoDesign}
      />

      {view === 'home' && (
        <main className="page-area">
          <HomeView
            templates={templates}
            groups={templateGroups}
            onCreateNew={newLabel}
            onOpenTemplate={loadTemplate}
            onPrintTemplate={(id) => loadTemplate(id, 'print')}
            onDuplicateTemplate={duplicateTemplate}
            onDeleteTemplate={deleteTemplate}
            onCreateGroup={createTemplateGroup}
            onRenameGroup={renameTemplateGroup}
            onDeleteGroup={deleteTemplateGroup}
            onSetTemplateGroup={setTemplateGroup}
          />
        </main>
      )}

      {view === 'design' && (
        <>
          <aside className="sidebar left">
            <ElementsPanel
              elements={elements}
              selectedIds={selectedIds}
              mode={mode}
              tspl={tsplPreview}
              showTspl={showTspl}
              onAddText={addText}
              onAddInput={addInput}
              onToggleLineMode={() =>
                setMode((current) => (current === 'line' ? 'select' : 'line'))
              }
              onPickImage={(file) => void addImage(file)}
              onSelect={selectElement}
              onRename={(id, layerName) =>
                updateElement(id, { layerName: layerName.trim() || undefined })
              }
              onReorder={(movedId, targetId, place) =>
                applyElements((current) => moveElementAmongSiblings(current, movedId, targetId, place))
              }
              onToggleTspl={() => setShowTspl((current) => !current)}
              onCopyTspl={copyTspl}
            />
          </aside>

          <main className="workspace">
            <LabelCanvas
              media={media}
              elements={elements}
              fieldValues={resolvedValues}
              selectedId={selectedId}
              selectedIds={selectedIds}
              zoom={zoom}
              mode={mode}
              bitmaps={bitmaps}
              onSelect={selectElement}
              onSelectIds={selectIds}
              onChange={updateElement}
              onPatchTextStyles={patchSelectedTextStyles}
              onPatchInputAlign={patchSelectedInputAlign}
              fontLibrary={fontLibrary}
              onGestureStart={history.beginGesture}
              onGestureEnd={finishGesture}
              onCreateLine={createLine}
              onDropImage={(file, xMm, yMm) => void addImage(file, xMm, yMm)}
              onAlign={alignElement}
              onRotate={rotateElement}
              onDuplicate={duplicateElement}
              onDelete={removeElement}
              onLayer={layerElement}
              onGroup={groupSelection}
              onUngroup={ungroupSelection}
              canGroup={canGroup}
            />
            <CanvasFooter
              media={media}
              zoom={zoom}
              mode={mode}
              converting={converting}
              onZoomChange={setZoom}
            />
          </main>

          <aside className="sidebar right">
            <PropertiesPanel
              element={selected}
              selectedElements={selectedElements}
              selectedCount={selectedIds.length}
              media={media}
              bitmap={selectedId ? bitmaps.get(selectedId) : undefined}
              fontLibrary={fontLibrary}
              onChange={(patch) => selectedId && updateElement(selectedId, patch)}
              onPatchTextStyles={patchSelectedTextStyles}
              onPatchInputAlign={patchSelectedInputAlign}
              onAlign={(alignment, scope) => selectedId && alignElement(selectedId, alignment, scope)}
              onDuplicate={() => selectedId && duplicateElement(selectedId)}
              onDelete={() => selectedId && removeElement(selectedId)}
              onGroup={groupSelection}
              onUngroup={ungroupSelection}
              canGroup={canGroup}
            />
            <MediaPanel
              media={media}
              presets={settings.mediaPresets}
              onChange={(patch) => {
                setMedia((current) => {
                  const next = { ...current, ...patch }
                  setElements((els) => constrainElementsToMedia(els, next))
                  return next
                })
              }}
            />
            <TemplatesPanel
              activeId={activeTemplateId}
              name={templateName}
              dirty={dirty}
              onNameChange={setTemplateName}
              onSave={requestSave}
              onSaveCopy={() => saveTemplate(true)}
            />
            <FontsPanel
              fonts={fontLibrary}
              onAddFont={(font) =>
                setFontLibrary((current) =>
                  current.some((item) => item.id === font.id) ? current : [...current, font]
                )
              }
              onRemoveFont={(id) => setFontLibrary((current) => current.filter((font) => font.id !== id))}
            />
          </aside>
        </>
      )}

      {view === 'print' && (
        <main className="page-area">
          <PrintView
            templates={templates}
            groups={templateGroups}
            activeTemplateId={activeTemplateId}
            templateName={templateName}
            values={values}
            media={media}
            elements={elements}
            bitmaps={bitmaps}
            copies={copies}
            busy={busy}
            converting={converting}
            lastPrintedAt={lastPrintedAt}
            history={printHistory[valuesKey] ?? []}
            onValueChange={(key, value) =>
              setValues((current) => ({ ...current, [key]: value }))
            }
            onReorderInputs={(orderedIds) =>
              applyElements((current) => assignPrintOrder(current, orderedIds))
            }
            onCopiesChange={setCopies}
            onLoadTemplate={(id) => loadTemplate(id, 'print')}
            onPrint={handlePrint}
            onEditTemplate={() => setView('design')}
            onReuseFill={setValues}
            onSaveFill={() => {
              rememberCurrentFill()
              setStatus({ kind: 'ok', message: 'Saved these values for reuse.' })
            }}
            onDeleteFill={(id) =>
              setPrintHistory((current) => ({
                ...current,
                [valuesKey]: (current[valuesKey] ?? []).filter((fill) => fill.id !== id)
              }))
            }
          />
        </main>
      )}

      {view === 'settings' && (
        <main className="page-area">
          <SettingsView
            settings={settings}
            media={media}
            fontLibrary={fontLibrary}
            themePreference={theme.preference}
            resolvedTheme={theme.resolved}
            busy={busy}
            onSettingsChange={updateSettings}
            onThemeChange={theme.setPreference}
            onTestPrint={handleTestPrint}
          />
        </main>
      )}

      <SaveTemplateDialog
        open={saveNameOpen}
        name={saveNameDraft}
        onNameChange={setSaveNameDraft}
        onSave={confirmNamedSave}
        onCancel={() => setSaveNameOpen(false)}
      />
    </div>
  )
}
