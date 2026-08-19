export type TsplFontId = string

export type Rotation = number

export type TextAlign = 'left' | 'center' | 'right'
export type VerticalAlign = 'top' | 'middle' | 'bottom'

/** Print direction. 0 feeds the label out bottom-first, 1 top-first. */
export type PrintDirection = 0 | 1

/** Die-cut / gap labels, or a continuous roll with no gap sensor. */
export type MediaStock = 'labels' | 'continuous'

export interface BoxPadding {
  topMm: number
  rightMm: number
  bottomMm: number
  leftMm: number
}

export interface LabelMedia {
  widthMm: number
  heightMm: number
  /** Vertical gap between die-cut labels. Ignored for continuous stock. */
  gapMm: number
  /** TSPL DENSITY, 0 (lightest) to 15 (darkest). */
  density: number
  /** TSPL SPEED in inches per second. */
  speed: number
  direction: PrintDirection
  /** Gap labels, or a continuous roll. */
  stock: MediaStock
  /** Die-cut stock is pre-cut with rounded corners, which the preview mirrors. */
  dieCut: boolean
  cornerRadiusMm: number
  /** Unprintable / keep-out margin inside the label, in millimetres. */
  padding: BoxPadding
}

interface ElementBase {
  id: string
  /**
   * Anchor position in millimetres from the top-left of the label. Rotation turns the
   * element about this anchor, which is what TSPL does with a TEXT coordinate.
   */
  xMm: number
  yMm: number
  rotation: Rotation
  /** Optional name shown in the layers list. Falls back to the element's contents. */
  layerName?: string
}

export interface TextElement extends ElementBase {
  type: 'text'
  text: string
  font: TsplFontId
  /** Present when the font came from an uploaded TTF rather than a built-in choice. */
  customFontDataUrl?: string
  customFontFamily?: string
  /**
   * Stored TSPL size. The editor exposes a single point size; both axes stay in step.
   */
  scaleX: number
  scaleY: number
}

export type TextStyle = Pick<
  TextElement,
  'font' | 'customFontDataUrl' | 'customFontFamily' | 'scaleX' | 'scaleY'
>

export interface LineElement extends ElementBase {
  type: 'line'
  /** Length along the element's own axis, before rotation. */
  lengthMm: number
  thicknessMm: number
}

export interface ImageElement extends ElementBase {
  type: 'image'
  name: string
  /** The imported file as a data URL, kept so the mono conversion can be redone. */
  sourceDataUrl: string
  /** Size before rotation. A quarter turn swaps the printed footprint. */
  widthMm: number
  heightMm: number
  /** Width / height of the imported file, used to keep proportional resizes honest. */
  aspectRatio: number
  /** Luminance cut-off, 0 to 255. Ignored when dithering. */
  threshold: number
  dither: boolean
  /** Swaps black and white, which also covers firmware with inverted bitmap polarity. */
  invert: boolean
}

export interface InputElement extends ElementBase {
  type: 'input'
  key: string
  label: string
  contentType: 'text' | 'image'
  defaultText: string
  /** Slot size. Print-time text and images shrink to stay inside this box. */
  widthMm: number
  heightMm: number
  textStyle: TextStyle
  imageStyle: Pick<
    ImageElement,
    'name' | 'sourceDataUrl' | 'widthMm' | 'heightMm' | 'aspectRatio' | 'threshold' | 'dither' | 'invert'
  >
  increment: boolean
  /** How print-time text sits inside the slot. */
  textAlign: TextAlign
  verticalAlign: VerticalAlign
  /** Lower values appear first on the Print page. Missing values keep tree order. */
  printOrder?: number
}

export type GroupDirection = 'row' | 'column'
export type GroupJustify = 'start' | 'center' | 'end' | 'space-between'
export type GroupAlign = 'start' | 'center' | 'end'

export interface GroupElement extends ElementBase {
  type: 'group'
  widthMm: number
  heightMm: number
  padding: BoxPadding
  /** Space between children along the layout direction. */
  gapMm: number
  direction: GroupDirection
  justify: GroupJustify
  align: GroupAlign
  /**
   * When true, children keep their own x/y instead of being packed by direction,
   * gap, and justify. Row/column controls turn this off again.
   */
  freeform?: boolean
  children: LabelElement[]
}

export type LabelElement = TextElement | LineElement | ImageElement | InputElement | GroupElement
export type ResolvedLabelElement = TextElement | LineElement | ImageElement

/** Field updates accepted by any element, minus the parts that define its identity. */
export type ElementPatch = Partial<Omit<TextElement, 'id' | 'type'>> &
  Partial<Omit<LineElement, 'id' | 'type'>> &
  Partial<Omit<ImageElement, 'id' | 'type'>> &
  Partial<Omit<InputElement, 'id' | 'type'>> &
  Partial<Omit<GroupElement, 'id' | 'type' | 'children'>> & {
    children?: LabelElement[]
  }

export interface FontLibraryItem {
  id: string
  name: string
  family: string
  dataUrl?: string
}

export interface LabelTemplate {
  id: string
  name: string
  updatedAt: number
  media: LabelMedia
  elements: LabelElement[]
  copies: number
}

export type FieldValue =
  | {
      contentType: 'text'
      text: string
    }
  | {
      contentType: 'image'
      sourceDataUrl: string
      name: string
      aspectRatio: number
    }

export type FieldValues = Record<string, FieldValue>

/** One saved fill-in from the print page, reused for later runs of the same template. */
export interface SavedPrintFill {
  id: string
  savedAt: number
  label: string
  values: FieldValues
}

/** Top-level pages: home, design the label, fill and print, or app settings. */
export type AppView = 'home' | 'design' | 'print' | 'settings'

export interface LabelJob {
  media: LabelMedia
  elements: ResolvedLabelElement[]
  copies: number
}

export interface PrinterInfo {
  name: string
  displayName: string
  isDefault: boolean
  status: number
}

export interface PrintResult {
  ok: boolean
  error?: string
}

export interface PrinterBridge {
  listPrinters(): Promise<PrinterInfo[]>
  /** Bitmap data is binary, so jobs cross the IPC boundary as bytes rather than text. */
  printRaw(printerName: string, payload: Uint8Array): Promise<PrintResult>
}

/** File-backed application cache under userData/app-cache, used by the packaged app. */
export interface AppCacheBridge {
  read(key: string): unknown | null
  write(key: string, value: unknown): Promise<void>
  readTemplates(): LabelTemplate[]
  writeTemplates(templates: LabelTemplate[]): Promise<void>
}
