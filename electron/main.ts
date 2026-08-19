import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PrinterInfo, PrintResult } from '../src/lib/types'
import { registerCacheIpc } from './appCache'
import { sendRawToPrinter } from './rawPrint'

const APP_FOLDER = 'receipt-printer-editor'
const APP_USER_MODEL_ID = 'com.receiptprinter.editor'

if (process.platform === 'win32') {
  // GPU shader cache failures on Windows leave a composited black window.
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
}

const userData = join(app.getPath('appData'), APP_FOLDER)
app.setPath('userData', userData)
app.setPath('sessionData', userData)

const chromiumCache = join(
  process.platform === 'win32' ? join(app.getPath('home'), 'AppData', 'Local', APP_FOLDER) : userData,
  app.isPackaged ? 'release-cache' : 'dev-cache'
)
mkdirSync(chromiumCache, { recursive: true })
app.setPath('cache', chromiumCache)
app.commandLine.appendSwitch('disk-cache-dir', chromiumCache)

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1040,
    minHeight: 660,
    show: true,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    title: 'Receipt Printer Editor',
    icon: join(app.getAppPath(), 'build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`Renderer failed to load (${code}): ${description} ${url}`)
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

if (gotLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    registerIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
