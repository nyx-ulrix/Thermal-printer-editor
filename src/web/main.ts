/**
 * Web entry (vite.web.config.ts). Installs the HTTP-backed bridges, waiting for the
 * cache preload, and only then loads the regular renderer entry so React's first
 * render already sees window.appCache and window.printer.
 */

import { installWebBridge } from './bridge'

async function boot(): Promise<void> {
  try {
    await installWebBridge()
  } catch (error) {
    const root = document.getElementById('root')
    if (root) {
      const message = error instanceof Error ? error.message : String(error)
      root.textContent = `The editor could not load your saved data (${message}). Reload the page to try again.`
    }
    return
  }
  await import('../main')
}

void boot()
