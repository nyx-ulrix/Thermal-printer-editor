import { useState, type ReactNode } from 'react'
import { loadPanelState, savePanelState } from '../lib/storage'

interface CollapsiblePanelProps {
  title: string
  /** Shown next to the title while closed, so the panel still reports its state. */
  summary?: string
  /** Identifies the panel in storage, so open and closed sticks between launches. */
  storageKey: string
  defaultOpen?: boolean
  children: ReactNode
}

export default function CollapsiblePanel({
  title,
  summary,
  storageKey,
  defaultOpen = true,
  children
}: CollapsiblePanelProps) {
  const [open, setOpen] = useState(() => loadPanelState()[storageKey] ?? defaultOpen)

  function toggle() {
    const next = !open
    setOpen(next)
    savePanelState({ ...loadPanelState(), [storageKey]: next })
  }

  return (
    <section className={`panel is-collapsible${open ? ' is-open' : ''}`}>
      <button type="button" className="panel-toggle" aria-expanded={open} onClick={toggle}>
        <span className="panel-chevron" aria-hidden="true">
          {open ? '\u25be' : '\u25b8'}
        </span>
        <h2>{title}</h2>
        {!open && summary && <span className="panel-summary">{summary}</span>}
      </button>

      {open && <div className="panel-body">{children}</div>}
    </section>
  )
}
