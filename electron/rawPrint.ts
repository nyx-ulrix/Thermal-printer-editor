import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Windows will not send arbitrary bytes to a printer through the normal print
 * path, so this script calls the Winspool API with the RAW datatype. That makes
 * the driver pass the TSPL commands through untouched, which is what lets the
 * app control label size instead of the driver's paper settings.
 */
const RAW_PRINT_SCRIPT = `param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$DataPath,
  [string]$DocName = 'TSPL Label'
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOW
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    private static void Fail(string step)
    {
        throw new Exception(step + " failed (Win32 error " + Marshal.GetLastWin32Error() + ")");
    }

    public static void Send(string printerName, byte[] bytes, string docName)
    {
        IntPtr printer;
        if (!OpenPrinter(printerName, out printer, IntPtr.Zero)) Fail("OpenPrinter");

        try
        {
            DOCINFOW info = new DOCINFOW();
            info.pDocName = docName;
            info.pDataType = "RAW";

            if (!StartDocPrinter(printer, 1, info)) Fail("StartDocPrinter");

            try
            {
                if (!StartPagePrinter(printer)) Fail("StartPagePrinter");

                IntPtr buffer = Marshal.AllocCoTaskMem(bytes.Length);
                try
                {
                    Marshal.Copy(bytes, 0, buffer, bytes.Length);
                    int written;
                    if (!WritePrinter(printer, buffer, bytes.Length, out written)) Fail("WritePrinter");
                    if (written != bytes.Length)
                    {
                        throw new Exception("Printer accepted only " + written + " of " + bytes.Length + " bytes");
                    }
                }
                finally
                {
                    Marshal.FreeCoTaskMem(buffer);
                }

                EndPagePrinter(printer);
            }
            finally
            {
                EndDocPrinter(printer);
            }
        }
        finally
        {
            ClosePrinter(printer);
        }
    }
}
'@

try {
  [RawPrinterHelper]::Send($PrinterName, [System.IO.File]::ReadAllBytes($DataPath), $DocName)
}
catch {
  [Console]::Error.WriteLine($_.Exception.GetBaseException().Message)
  exit 1
}
`

function runPowerShell(scriptPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      { windowsHide: true, timeout: 30_000 },
      (error, _stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message
          reject(new Error(detail))
          return
        }
        resolve()
      }
    )
  })
}

export async function sendRawToPrinter(
  printerName: string,
  payload: Buffer,
  docName = 'TSPL Label'
): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('Raw printing is only implemented for Windows in this build')
  }

  const dir = await mkdtemp(join(tmpdir(), 'gp3120tl-'))
  const scriptPath = join(dir, 'rawPrint.ps1')
  const dataPath = join(dir, 'job.prn')

  try {
    await writeFile(scriptPath, RAW_PRINT_SCRIPT, 'utf8')
    await writeFile(dataPath, payload)
    await runPowerShell(scriptPath, [
      '-PrinterName',
      printerName,
      '-DataPath',
      dataPath,
      '-DocName',
      docName
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
