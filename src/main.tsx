import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyStoredTheme } from './hooks/useTheme'
// The dark token file overrides the light one, so load order matters here.
import './styles/nyt-design-tokens.css'
import './styles/nyt-dark-mode-tokens.css'
import './styles.css'

try {
  applyStoredTheme()
} catch {
  // Theme must never block the first paint.
}

const container = document.getElementById('root')
if (!container) throw new Error('Root element not found')

window.addEventListener('error', (event) => {
  if (container.childElementCount > 0) return
  container.textContent = event.message || 'The editor failed to start.'
})

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
