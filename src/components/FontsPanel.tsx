import { useRef, type CSSProperties } from 'react'
import { customFontFamilyFromName, ensureCustomFontLoaded } from '../lib/customFonts'
import { BASIC_BROWSER_FONTS } from '../lib/fonts'
import { readFileAsDataUrl } from '../lib/imageMono'
import type { FontLibraryItem } from '../lib/types'
import CollapsiblePanel from './CollapsiblePanel'
import { IconButton } from './Icon'

interface FontsPanelProps {
  fonts: FontLibraryItem[]
  onAddFont: (font: FontLibraryItem) => void
  onRemoveFont: (id: string) => void
}

function previewStyle(font: FontLibraryItem): CSSProperties {
  return { fontFamily: font.family }
}

export default function FontsPanel({ fonts, onAddFont, onRemoveFont }: FontsPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  return (
    <CollapsiblePanel title="Fonts" summary={`${fonts.length} custom`} storageKey="fonts" defaultOpen={false}>
      <p className="panel-hint">
        The editor includes a basic starter set below. Upload a TTF or OTF here to reuse it
        across any text element.
      </p>

      <div className="font-library">
        {BASIC_BROWSER_FONTS.map((font) => (
          <div key={font.name} className="font-row">
            <div className="font-preview" style={{ fontFamily: font.family }}>
              {font.name}
            </div>
            <span className="element-meta">Basic</span>
          </div>
        ))}
      </div>

      <div className="field-row">
        <IconButton
          name="upload"
          label="Import TTF / OTF"
          className="button ghost"
          onClick={() => inputRef.current?.click()}
        />
      </div>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept=".ttf,.otf,font/ttf,font/otf"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return

          void (async () => {
            const dataUrl = await readFileAsDataUrl(file)
            const family = customFontFamilyFromName(file.name)
            await ensureCustomFontLoaded(family, dataUrl)
            onAddFont({
              id: family,
              name: file.name.replace(/\.[^.]+$/, ''),
              family,
              dataUrl
            })
          })()

          event.target.value = ''
        }}
      />

      {fonts.length > 0 && (
        <div className="font-library">
          {fonts.map((font) => (
            <div key={font.id} className="font-row">
              <div className="font-preview" style={previewStyle(font)}>
                {font.name}
              </div>
              <IconButton
                name="trash"
                label={`Remove ${font.name}`}
                className="mini-button is-danger"
                onClick={() => onRemoveFont(font.id)}
              />
            </div>
          ))}
        </div>
      )}
    </CollapsiblePanel>
  )
}
