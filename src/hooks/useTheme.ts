import { useCallback, useEffect, useState } from 'react'
import { readPersistedString, writePersistedString } from '../lib/persist'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'gp3120tl.theme.v1'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function readPreference(): ThemePreference {
  const stored = readPersistedString(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

/**
 * Applies the saved preference before React mounts, so a stored choice that
 * disagrees with the OS never paints in the wrong theme first.
 */
export function applyStoredTheme(): void {
  const preference = readPreference()
  if (preference === 'system') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.dataset.theme = preference
  }
}

export interface ThemeState {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
}

/**
 * Drives the token files: `system` leaves data-theme off so the tokens follow
 * prefers-color-scheme, while an explicit choice sets data-theme="light" or "dark".
 */
export function useTheme(): ThemeState {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference)
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
  )

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY)
    const handleChange = (event: MediaQueryListEvent) =>
      setSystemTheme(event.matches ? 'dark' : 'light')

    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (preference === 'system') {
      root.removeAttribute('data-theme')
    } else {
      root.dataset.theme = preference
    }
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    writePersistedString(STORAGE_KEY, next)
  }, [])

  return {
    preference,
    resolved: preference === 'system' ? systemTheme : preference,
    setPreference
  }
}
