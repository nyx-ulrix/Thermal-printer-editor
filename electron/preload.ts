import { contextBridge, ipcRenderer } from 'electron'
import type { AppCacheBridge, LabelTemplate, PrinterBridge, PrinterInfo, PrintResult } from '../src/lib/types'

const printer: PrinterBridge = {
  listPrinters: (): Promise<PrinterInfo[]> => ipcRenderer.invoke('printers:list'),
  printRaw: (printerName: string, payload: Uint8Array): Promise<PrintResult> =>
    ipcRenderer.invoke('printer:printRaw', printerName, payload)
}

const appCache: AppCacheBridge = {
  read: (key: string): unknown | null => ipcRenderer.sendSync('cache:read', key) as unknown | null,
  write: (key: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke('cache:write', key, value).then(() => undefined),
  readTemplates: (): Promise<LabelTemplate[]> =>
    ipcRenderer.invoke('cache:readTemplates').then((stored: unknown) =>
      Array.isArray(stored) ? (stored as LabelTemplate[]) : []
    ),
  writeTemplates: (templates: LabelTemplate[]): Promise<void> =>
    ipcRenderer.invoke('cache:writeTemplates', templates).then(() => undefined)
}

contextBridge.exposeInMainWorld('printer', printer)
contextBridge.exposeInMainWorld('appCache', appCache)
