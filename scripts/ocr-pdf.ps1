# Reads a scanned PDF with the OCR engine built into Windows (Windows.Data.Pdf + Windows.Media.Ocr).
# Nothing leaves the PC. Writes UTF-8 JSON to stdout: {"idioma":"es-ES","paginas":[{"n":1,"texto":"..."}]}
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ocr-pdf.ps1 -Ruta file.pdf [-MaxPaginas 200] [-Ancho 2200]
# With -Idiomas it only lists the installed OCR languages.
param([string]$Ruta, [int]$MaxPaginas = 200, [int]$Ancho = 2200, [switch]$Idiomas)
$ErrorActionPreference = 'Stop'

function Salir-Con($objeto) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($objeto | ConvertTo-Json -Depth 4 -Compress))
  $o = [Console]::OpenStandardOutput(); $o.Write($bytes, 0, $bytes.Length); $o.Flush()
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
$asTaskAccion = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
} | Select-Object -First 1
function Esperar($operacion, [type]$tipo) {
  $t = $asTask.MakeGenericMethod($tipo).Invoke($null, @($operacion))
  $t.Wait(-1) | Out-Null
  $t.Result
}
function EsperarAccion($accion) { $t = $asTaskAccion.Invoke($null, @($accion)); $t.Wait(-1) | Out-Null }

$disponibles = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages
if ($Idiomas) { Salir-Con @{ idiomas = @($disponibles | ForEach-Object { $_.LanguageTag }) }; exit 0 }

$espanol = $disponibles | Where-Object { $_.LanguageTag -like 'es*' } | Select-Object -First 1
if (-not $espanol) { throw 'Windows no tiene instalado el idioma espanol para OCR' }
$motor = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($espanol)

$archivo = Esperar ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path -LiteralPath $Ruta).ProviderPath)) ([Windows.Storage.StorageFile])
$pdf = Esperar ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($archivo)) ([Windows.Data.Pdf.PdfDocument])
$paginas = New-Object System.Collections.ArrayList
$total = [math]::Min([int]$pdf.PageCount, $MaxPaginas)
for ($i = 0; $i -lt $total; $i++) {
  $pagina = $pdf.GetPage([uint32]$i)
  try {
    $flujo = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $opciones = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $opciones.DestinationWidth = [uint32]$Ancho
    EsperarAccion ($pagina.RenderToStreamAsync($flujo, $opciones))
    $dec = Esperar ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($flujo)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = Esperar ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Esperar ($motor.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    $texto = (@($res.Lines | ForEach-Object { $_.Text }) -join "`n")
    if ($texto.Trim()) { [void]$paginas.Add(@{ n = $i + 1; texto = $texto }) }
    $bmp.Dispose(); $flujo.Dispose()
  } finally { $pagina.Dispose() }
}
Salir-Con @{ idioma = $espanol.LanguageTag; totalPaginas = [int]$pdf.PageCount; paginas = @($paginas) }
