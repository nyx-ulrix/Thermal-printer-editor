import { useEffect, useMemo, useState } from 'react'
import { useCustomFonts } from '../hooks/useCustomFonts'
import { useMonoBitmaps } from '../hooks/useMonoBitmaps'
import { getBasePxPerMm } from '../lib/units'
import type { LabelTemplate } from '../lib/types'
import Icon, { IconButton } from './Icon'
import LabelCanvas from './LabelCanvas'

interface HomeViewProps {
  templates: LabelTemplate[]
  onCreateNew: () => void
  onOpenTemplate: (id: string) => void
  onPrintTemplate: (id: string) => void
  onDuplicateTemplate: (id: string) => void
  onDeleteTemplate: (id: string) => void
}

const PREVIEW_MAX_PX = 180
const noop = () => undefined

export default function HomeView({
  templates,
  onCreateNew,
  onOpenTemplate,
  onPrintTemplate,
  onDuplicateTemplate,
  onDeleteTemplate
}: HomeViewProps) {
  const sorted = [...templates].sort((a, b) => b.updatedAt - a.updatedAt)
  const [menuId, setMenuId] = useState<string | null>(null)

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('.home-card-menu')) return
      setMenuId(null)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuId(null)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    <div className="page home-page">
      <header className="page-header">
        <h1>Templates</h1>
      </header>

      {sorted.length === 0 ? (
        <p className="panel-hint">No templates yet. Use + to create one.</p>
      ) : (
        <div className="home-template-grid">
          {sorted.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              menuOpen={menuId === template.id}
              onOpen={() => onOpenTemplate(template.id)}
              onToggleMenu={() => setMenuId((current) => (current === template.id ? null : template.id))}
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
            />
          ))}
        </div>
      )}

      <IconButton
        name="plus"
        label="New print"
        className="home-fab"
        size={24}
        onClick={onCreateNew}
      />
    </div>
  )
}

interface TemplateCardProps {
  template: LabelTemplate
  menuOpen: boolean
  onOpen: () => void
  onToggleMenu: () => void
  onPrint: () => void
  onDuplicate: () => void
  onDelete: () => void
}

function TemplateCard({
  template,
  menuOpen,
  onOpen,
  onToggleMenu,
  onPrint,
  onDuplicate,
  onDelete
}: TemplateCardProps) {
  const zoom = useMemo(() => {
    const longest = Math.max(template.media.widthMm, template.media.heightMm, 1)
    return PREVIEW_MAX_PX / (longest * getBasePxPerMm())
  }, [template.media.widthMm, template.media.heightMm])

  const { bitmaps } = useMonoBitmaps(template.elements)
  useCustomFonts(template.elements)

  return (
    <article className={`home-template-card${menuOpen ? ' is-menu-open' : ''}`}>
      <button type="button" className="home-template-open" onClick={onOpen}>
        <div className="home-template-preview">
          <LabelCanvas
            media={template.media}
            elements={template.elements}
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
          <div className="home-card-menu-list" role="menu">
            <IconButton name="printer" label="Print" role="menuitem" onClick={onPrint} />
            <IconButton name="duplicate" label="Duplicate" role="menuitem" onClick={onDuplicate} />
            <IconButton
              name="trash"
              label="Delete"
              className="is-danger"
              role="menuitem"
              onClick={onDelete}
            />
          </div>
        )}
      </div>
    </article>
  )
}
