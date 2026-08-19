/// <reference types="vite/client" />

import type { AppCacheBridge, PrinterBridge } from './lib/types'

declare global {
  interface Window {
    /** Exposed by electron/preload.ts. Undefined when the UI runs outside Electron. */
    printer?: PrinterBridge
    /** File-backed app data in the Electron userData directory. */
    appCache?: AppCacheBridge
  }
}
