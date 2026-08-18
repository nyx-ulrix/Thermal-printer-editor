import type { ResolvedTheme, ThemePreference } from '../hooks/useTheme'
import Icon, { type IconName } from './Icon'

interface ThemeToggleProps {
  preference: ThemePreference
  resolved: ResolvedTheme
  onChange: (preference: ThemePreference) => void
}

const OPTIONS: Array<{ id: ThemePreference; label: string; icon: IconName }> = [
  { id: 'system', label: 'Auto', icon: 'monitor' },
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' }
]

export default function ThemeToggle({ preference, resolved, onChange }: ThemeToggleProps) {
  return (
    <div className="toolbar-field">
      <span>Theme</span>
      <div
        className="theme-toggle"
        role="group"
        aria-label="Colour theme"
        title={preference === 'system' ? `Following the system (${resolved})` : undefined}
      >
        {OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`theme-option${preference === option.id ? ' is-active' : ''}`}
            aria-pressed={preference === option.id}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.id)}
          >
            <Icon name={option.icon} size={14} />
          </button>
        ))}
      </div>
    </div>
  )
}
