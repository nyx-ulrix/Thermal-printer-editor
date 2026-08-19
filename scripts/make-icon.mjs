import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'src', 'assets', 'app-icon.png')
const outDir = join(root, 'build')
mkdirSync(outDir, { recursive: true })

const script = `
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile(${JSON.stringify(source)})
$size = [Math]::Max($src.Width, $src.Height)
$canvas = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.Clear([System.Drawing.Color]::White)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$x = [int](($size - $src.Width) / 2)
$y = [int](($size - $src.Height) / 2)
$g.DrawImage($src, $x, $y, $src.Width, $src.Height)
$png = [System.Drawing.Imaging.ImageFormat]::Png
$canvas.Save(${JSON.stringify(join(outDir, 'icon.png'))}, $png)
$canvas.Save(${JSON.stringify(join(outDir, 'app-icon.png'))}, $png)
$g.Dispose()
$canvas.Dispose()
$src.Dispose()
`

const result = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-Command', script],
  { encoding: 'utf8' }
)
if (result.status !== 0) {
  console.error(result.stderr || result.stdout)
  process.exit(result.status ?? 1)
}
console.log(`Wrote ${join(outDir, 'icon.png')} from src/assets/app-icon.png`)
