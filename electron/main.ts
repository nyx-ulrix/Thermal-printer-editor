import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import type { PrinterInfo, PrintResult } from '../src/lib/types'
import { registerCacheIpc } from './appCache'
import { sendRawToPrinter } from './rawPrint'

const APP_FOLDER = 'receipt-printer-editor'
const APP_USER_MODEL_ID = 'com.receiptprinter.editor'

// Keep templates and settings on a stable path in both `npm run dev` and the
// packaged app. Electron otherwise uses "Electron" as the userData folder in dev.
app.setName('Receipt Printer Editor')
app.setPath('userData', join(app.getPath('appData'), APP_FOLDER))
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID)
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1040,
    minHeight: 660,
    show: false,
    // Matches --surface-canvas so the first paint does not flash the wrong theme.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121212' : '#ffffff',
    autoHideMenuBar: true,
    title: 'Receipt Printer Editor',
    icon: join(app.getAppPath(), 'build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerIpc(): void {
  registerCacheIpc()

  ipcMain.handle('printers:list', async (): Promise<PrinterInfo[]> => {
    const target = BrowserWindow.getAllWindows()[0]
    if (!target) return []

    const printers = await target.webContents.getPrintersAsync()
    return printers.map((printer) => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      isDefault: printer.isDefault,
      status: printer.status
    }))
  })

  ipcMain.handle(
    'printer:printRaw',
    async (_event, printerName: unknown, payload: unknown): Promise<PrintResult> => {
      if (typeof printerName !== 'string' || printerName.trim() === '') {
        return { ok: false, error: 'No printer selected' }
      }
      if (!(payload instanceof Uint8Array) || payload.length === 0) {
        return { ok: false, error: 'Nothing to print' }
      }

      try {
        await sendRawToPrinter(printerName, Buffer.from(payload))
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
