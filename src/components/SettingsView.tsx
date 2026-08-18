import type { ResolvedTheme, ThemePreference } from '../hooks/useTheme'
import type { AppSettings } from '../lib/appSettings'
import { presetLabel, type MediaPreset } from '../lib/media'
import type { FontLibraryItem, LabelMedia, TsplFontId } from '../lib/types'
import { DPI_PRESETS, clamp, formatMm, roundMm } from '../lib/units'
import FontControls from './FontControls'
import { IconButton } from './Icon'
import NumberField from './NumberField'
import ThemeToggle from './ThemeToggle'

interface SettingsViewProps {
  settings: AppSettings
  media: LabelMedia
  fontLibrary: FontLibraryItem[]
  themePreference: ThemePreference
  resolvedTheme: ResolvedTheme
  busy: boolean
  onSettingsChange: (patch: Partial<AppSettings>) => void
  onThemeChange: (preference: ThemePreference) => void
  onTestPrint: () => void
}

export default function SettingsView({
  settings,
  media,
  fontLibrary,
  themePreference,
  resolvedTheme,
  busy,
  onSettingsChange,
  onThemeChange,
  onTestPrint
}: SettingsViewProps) {
  function updatePreset(id: string, patch: Partial<MediaPreset>) {
    onSettingsChange({
      mediaPresets: settings.mediaPresets.map((preset) => {
        if (preset.id !== id) return preset
        const next = { ...preset, ...patch }
        const autoLabel = presetLabel(preset.widthMm, preset.heightMm)
        if (patch.widthMm != null || patch.heightMm != null) {
          if (!preset.label || preset.label === autoLabel) {
            next.label = presetLabel(next.widthMm, next.heightMm)
          }
        }
        return next
      })
    })
  }

  function addPreset() {
    const widthMm = roundMm(media.widthMm, 1)
    const heightMm = roundMm(media.heightMm, 1)
    if (settings.mediaPresets.some((preset) => preset.widthMm === widthMm && preset.heightMm === heightMm)) {
      return
    }
    onSettingsChange({
      mediaPresets: [
        ...settings.mediaPresets,
        {
          id:
            typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `preset-${Date.now()}`,
          label: presetLabel(widthMm, heightMm),
          widthMm,
          heightMm
        }
      ]
    })
  }

  function removePreset(id: string) {
    const next = settings.mediaPresets.filter((preset) => preset.id !== id)
    if (next.length === 0) return
    onSettingsChange({ mediaPresets: next })
  }

  return (
    <div className="page settings-page">
      <header className="page-header">
        <h1>Settings</h1>
        <p className="page-lede">
          Defaults for new text, label size presets, and the GP-3120TL print head.
        </p>
      </header>

      <section className="panel">
        <h2>Colour mode</h2>
        <p className="panel-hint">
          Light, dark, or follow the system. The label preview stays white stock with black
          ink either way.
        </p>
        <ThemeToggle
          preference={themePreference}
          resolved={resolvedTheme}
          onChange={onThemeChange}
        />
      </section>

      <section className="panel">
        <h2>Default font and size</h2>
        <p className="panel-hint">Used for new text boxes and input fields. Font and size are set separately.</p>
        <FontControls
          font={settings.defaultFont}
          sizePt={settings.defaultSizePt}
          fontLibrary={fontLibrary}
          onFontChange={(font: TsplFontId) => onSettingsChange({ defaultFont: font })}
          onSizeChange={(defaultSizePt) => onSettingsChange({ defaultSizePt })}
          onSizeNudge={(delta) =>
            onSettingsChange({
              defaultSizePt: clamp(settings.defaultSizePt + delta, 1, 400)
            })
          }
        />
      </section>

      <section className="panel">
        <h2>Print resolution</h2>
        <p className="panel-hint">
          The GP-3120TL prints at 203 DPI. Change this only if you are using a different
          head resolution. Coordinates stay in millimetres; dots per millimetre follow DPI.
        </p>
        <div className="presets">
          <span className="presets-label">Presets</span>
          <div className="preset-buttons">
            {DPI_PRESETS.map((dpi) => (
              <button
                key={dpi}
                type="button"
                className={`chip${settings.dpi === dpi ? ' is-active' : ''}`}
                onClick={() => onSettingsChange({ dpi })}
              >
                {dpi} DPI
              </button>
            ))}
          </div>
        </div>
        <NumberField
          label="DPI"
          value={settings.dpi}
          min={72}
          max={600}
          step={1}
          onCommit={(dpi) => onSettingsChange({ dpi })}
        />
      </section>

      <section className="panel">
        <h2>Label size presets</h2>
        <p className="panel-hint">
          These chips appear in Design under Label media. Add the size currently on the
          canvas, or edit the list.
        </p>
        <div className="preset-editor">
          {settings.mediaPresets.map((preset) => (
            <div key={preset.id} className="preset-editor-row">
              <label className="field">
                <span>Name</span>
                <input
                  type="text"
                  value={preset.label}
                  onChange={(event) => updatePreset(preset.id, { label: event.target.value })}
                />
              </label>
              <NumberField
                label="Width (mm)"
                value={preset.widthMm}
                min={5}
                max={120}
                step={0.1}
                onCommit={(widthMm) => updatePreset(preset.id, { widthMm })}
              />
              <NumberField
                label="Height (mm)"
                value={preset.heightMm}
                min={5}
                max={300}
                step={0.1}
                onCommit={(heightMm) => updatePreset(preset.id, { heightMm })}
              />
              <IconButton
                name="trash"
                label={`Remove ${preset.label}`}
                className="button ghost"
                disabled={settings.mediaPresets.length < 2}
                onClick={() => removePreset(preset.id)}
              />
            </div>
          ))}
        </div>
        <button type="button" className="button ghost" onClick={addPreset}>
          Add {formatMm(media.widthMm, 1)} x {formatMm(media.heightMm, 1)} mm
        </button>
      </section>

      <section className="panel">
        <h2>Test print</h2>
        <p className="panel-hint">
          Sends a small diagnostic using the current media size and stock type, so you can
          check that the printer is selected and RAW printing is working.
        </p>
        <button type="button" className="button" onClick={onTestPrint} disabled={busy}>
          {busy ? 'Sending...' : 'Test print'}
        </button>
      </section>
    </div>
  )
}
