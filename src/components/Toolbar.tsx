import type { AppView, PrinterInfo } from '../lib/types'
import brandIconDark from '../assets/brand-icon-dark.png'
import brandIconLight from '../assets/brand-icon-light.png'
import Icon, { IconButton, type IconName } from './Icon'
import NumberField from './NumberField'

export type StatusKind = 'idle' | 'busy' | 'ok' | 'error'

export interface Status {
  kind: StatusKind
  message: string
}

interface ToolbarProps {
  view: AppView
  documentName: string
  printers: PrinterInfo[]
  printerName: string
  copies: number
  busy: boolean
  bridgeAvailable: boolean
  status: Status
  onViewChange: (view: AppView) => void
  onPrinterChange: (name: string) => void
  onCopiesChange: (copies: number) => void
  onRefreshPrinters: () => void
  onPrint: () => void
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
}

const VIEWS: Array<{ id: AppView; label: string; icon: IconName }> = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'design', label: 'Design', icon: 'design' },
  { id: 'print', label: 'Print', icon: 'printer' }
]

export default function Toolbar({
  view,
  documentName,
  printers,
  printerName,
  copies,
  busy,
  bridgeAvailable,
  status,
  onViewChange,
  onPrinterChange,
  onCopiesChange,
  onRefreshPrinters,
  onPrint,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="brand">
        <img className="brand-icon brand-icon-light" src={brandIconLight} alt="" aria-hidden="true" />
        <img className="brand-icon brand-icon-dark" src={brandIconDark} alt="" aria-hidden="true" />
        <div className="brand-copy">
          <span className="brand-name">{documentName || 'Label designer'}</span>
        </div>
      </div>

      <nav className="view-nav" aria-label="Pages">
        {VIEWS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`view-tab${view === entry.id ? ' is-active' : ''}`}
            aria-current={view === entry.id ? 'page' : undefined}
            aria-label={entry.label}
            title={entry.label}
            onClick={() => onViewChange(entry.id)}
          >
            <Icon name={entry.icon} size={18} />
          </button>
        ))}
      </nav>

      {view === 'design' && (
        <div className="history-nav" role="group" aria-label="Undo and redo">
          <IconButton
            name="undo"
            label="Undo (Ctrl+Z)"
            className="button ghost"
            onClick={onUndo}
            disabled={!canUndo}
          />
          <IconButton
            name="redo"
            label="Redo (Ctrl+Y)"
            className="button ghost"
            onClick={onRedo}
            disabled={!canRedo}
          />
        </div>
      )}

      <label className="toolbar-field printer-select">
        <span>Printer</span>
        <select
          value={printerName}
          disabled={!bridgeAvailable}
          onChange={(event) => onPrinterChange(event.target.value)}
        >
          <option value="">Select a printer</option>
          {printers.map((printer) => (
            <option key={printer.name} value={printer.name}>
              {printer.displayName}
              {printer.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </label>

      <IconButton
        name="refresh"
        label="Refresh printers"
        className="button ghost"
        onClick={onRefreshPrinters}
        disabled={!bridgeAvailable}
      />

      <NumberField
        className="toolbar-field copies"
        label="Copies"
        value={copies}
        min={1}
        max={999}
        step={1}
        onCommit={onCopiesChange}
      />

      <div className="toolbar-actions">
        <IconButton
          name="settings"
          label="Settings"
          className={`button ghost${view === 'settings' ? ' is-active' : ''}`}
          onClick={() => onViewChange(view === 'settings' ? 'home' : 'settings')}
        />
        <button
          type="button"
          className="button primary"
          onClick={onPrint}
          disabled={busy}
        >
          {busy ? 'Sending...' : 'Print'}
        </button>
      </div>

      {status.message !== '' && (
        <p className={`status status-${status.kind}`} role="status">
          {status.message}
        </p>
      )}
    </header>
  )
}
