# Creates the desktop launcher for Merlin, using the icon image from "Imagenes Merlin".
# Usage: powershell -ExecutionPolicy Bypass -File scripts\crear-lanzador.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$raiz = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $raiz 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $electron)) { throw "Falta Electron. Ejecuta 'npm install' en $raiz" }

# The icon file name comes from the same manifest the app uses
$manifiesto = Get-Content -LiteralPath (Join-Path $raiz 'src\renderer\avatar.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$origen = Join-Path (Join-Path $raiz $manifiesto.carpeta) $manifiesto.icono
if (-not (Test-Path -LiteralPath $origen)) { throw "No existe la imagen del icono: $origen" }

$destinoDir = Join-Path $raiz 'assets'
New-Item -ItemType Directory -Force -Path $destinoDir | Out-Null
$ico = Join-Path $destinoDir 'merlin.ico'

# Rounded square of the image (1024x1024), leaving out its white corners
$imagen = [System.Drawing.Image]::FromFile($origen)
$esc = $imagen.Width / 1024.0
$recorte = New-Object System.Drawing.RectangleF ([single](132 * $esc)), ([single](132 * $esc)), ([single](760 * $esc)), ([single](760 * $esc))

$tamanos = 16, 24, 32, 48, 64, 128, 256
$pngs = @()
foreach ($t in $tamanos) {
  $bmp = New-Object System.Drawing.Bitmap $t, $t, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)
  $r = [single]($t * 0.17); $d = 2 * $r; $m = [single]($t - $d)
  $forma = New-Object System.Drawing.Drawing2D.GraphicsPath
  $forma.AddArc([single]0, [single]0, $d, $d, 180, 90)
  $forma.AddArc($m, [single]0, $d, $d, 270, 90)
  $forma.AddArc($m, $m, $d, $d, 0, 90)
  $forma.AddArc([single]0, $m, $d, $d, 90, 90)
  $forma.CloseFigure()
  $pincel = New-Object System.Drawing.TextureBrush $imagen, $recorte, (New-Object System.Drawing.Imaging.ImageAttributes)
  $k = [single]($t / $recorte.Width)
  $pincel.ScaleTransform($k, $k)
  $g.FillPath($pincel, $forma)
  $s = New-Object System.IO.MemoryStream
  if ($t -ge 256) {
    $bmp.Save($s, [System.Drawing.Imaging.ImageFormat]::Png)   # PNG is the standard format for 256 px
  } else {
    # Classic 32-bit bitmap: header, BGRA pixels bottom-up, then an empty AND mask
    $bw = New-Object System.IO.BinaryWriter $s
    $bw.Write([uint32]40); $bw.Write([int32]$t); $bw.Write([int32]($t * 2))
    $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]0)
    $bw.Write([uint32]($t * $t * 4)); $bw.Write([int32]0); $bw.Write([int32]0); $bw.Write([uint32]0); $bw.Write([uint32]0)
    for ($y = $t - 1; $y -ge 0; $y--) {
      for ($x = 0; $x -lt $t; $x++) {
        $c = $bmp.GetPixel($x, $y)
        $bw.Write([byte]$c.B); $bw.Write([byte]$c.G); $bw.Write([byte]$c.R); $bw.Write([byte]$c.A)
      }
    }
    $bw.Write((New-Object byte[] ([math]::Ceiling($t / 32.0) * 4 * $t)))
    $bw.Flush()
  }
  $pngs += , $s.ToArray()
  $pincel.Dispose(); $forma.Dispose(); $g.Dispose(); $bmp.Dispose(); $s.Dispose()
}
$imagen.Dispose()

# ICO file containing one PNG per size
$fs = [System.IO.File]::Create($ico)
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$tamanos.Count)
$desplazamiento = 6 + 16 * $tamanos.Count
for ($i = 0; $i -lt $tamanos.Count; $i++) {
  $t = $tamanos[$i]; $lado = if ($t -ge 256) { 0 } else { $t }
  $w.Write([byte]$lado); $w.Write([byte]$lado); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$pngs[$i].Length); $w.Write([uint32]$desplazamiento)
  $desplazamiento += $pngs[$i].Length
}
foreach ($p in $pngs) { $w.Write($p) }
$w.Close()

# Shortcut: opens Electron directly, so no console window appears
$nombre = 'Merl' + [char]0xED + 'n.lnk'
$escritorio = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $escritorio $nombre
$acceso = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$acceso.TargetPath = $electron
$acceso.Arguments = '"' + $raiz + '"'
$acceso.WorkingDirectory = $raiz
$acceso.IconLocation = "$ico,0"
$acceso.Description = 'Merlin, el gatito brujo de escritorio'
$acceso.Save()

Write-Output "Icono: $ico"
Write-Output "Acceso directo: $lnk"
