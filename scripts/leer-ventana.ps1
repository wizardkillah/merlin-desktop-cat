# Lee el texto de una ventana con la accesibilidad de Windows, la misma vía de los lectores de pantalla.
# Solo lee: no hace clics ni escribe. Las casillas de contraseña no entregan su contenido.
# -Titulo: la ventana cuyo título cumple esa expresión. Sin él, la ventana activa (saltándose la de Merlín).
param([string]$Titulo = "", [int]$MaxCaracteres = 12000, [int]$MaxElementos = 2500, [int]$MaxSegundos = 5)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class Ventanas {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  public static string Texto(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  public static uint Proceso(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
}
'@

$ignorar = @("electron", "ApplicationFrameHost", "ShellExperienceHost", "SearchHost", "StartMenuExperienceHost", "TextInputHost", "LockApp")
function Proceso($h) { try { (Get-Process -Id ([Ventanas]::Proceso($h))).ProcessName } catch { "" } }
function Valida($h) {
  if (-not [Ventanas]::IsWindowVisible($h) -or [Ventanas]::IsIconic($h)) { return $false }
  $t = [Ventanas]::Texto($h); if (-not $t -or $t -eq "Program Manager") { return $false }
  return ($ignorar -notcontains (Proceso $h))
}
# De la más visible a la menos, según el orden en pantalla
function Buscar {
  if (-not $Titulo) { $a = [Ventanas]::GetForegroundWindow(); if ($a -ne [IntPtr]::Zero -and (Valida $a)) { return $a } }
  $h = [Ventanas]::GetTopWindow([IntPtr]::Zero)
  while ($h -ne [IntPtr]::Zero) {
    if ((Valida $h) -and (-not $Titulo -or [Ventanas]::Texto($h) -match $Titulo)) { return $h }
    $h = [Ventanas]::GetWindow($h, 2)
  }
  return [IntPtr]::Zero
}
$h = Buscar
if ($h -eq [IntPtr]::Zero) { @{ error = "sin ventana" } | ConvertTo-Json -Compress; exit 0 }

$raiz = [Windows.Automation.AutomationElement]::FromHandle($h)
$tipo = [Windows.Automation.AutomationElement]::ControlTypeProperty
$documento = [Windows.Automation.PropertyCondition]::new($tipo, [Windows.Automation.ControlType]::Document)
$fin = (Get-Date).AddSeconds($MaxSegundos)
$texto = ""; $via = "ninguna"

# Lo mejor es el documento entero, como lo leería un lector de pantalla. Chrome prepara su árbol al primer intento.
for ($i = 0; $i -lt 4 -and -not $texto; $i++) {
  $doc = $raiz.FindFirst([Windows.Automation.TreeScope]::Descendants, $documento)
  if ($doc) {
    $p = $null
    if ($doc.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern, [ref]$p)) {
      $t = $p.DocumentRange.GetText($MaxCaracteres)
      if ($t -and $t.Trim().Length -gt 40) { $texto = $t; $via = "documento" }
    }
  }
  if (-not $texto) { Start-Sleep -Milliseconds 500 }
}

# Si no, se recorren los elementos visibles por su nombre
if (-not $texto) {
  $partes = New-Object System.Collections.Generic.List[string]
  $n = 0; $largo = 0
  $w = [Windows.Automation.TreeWalker]::ContentViewWalker
  $pila = New-Object System.Collections.Stack
  $pila.Push($raiz)
  while ($pila.Count -gt 0 -and $n -lt $MaxElementos -and $largo -lt $MaxCaracteres -and (Get-Date) -lt $fin) {
    $e = $pila.Pop(); $n++
    try {
      $c = $e.Current
      if (-not $c.IsPassword -and -not $c.IsOffscreen -and $c.Name) { $partes.Add($c.Name); $largo += $c.Name.Length }
      $hijos = New-Object System.Collections.ArrayList
      $x = $w.GetFirstChild($e)
      while ($x) { [void]$hijos.Add($x); $x = $w.GetNextSibling($x) }
      for ($k = $hijos.Count - 1; $k -ge 0; $k--) { $pila.Push($hijos[$k]) }
    } catch {}
  }
  $texto = ($partes -join "`n"); $via = "elementos"
}

@{ titulo = [Ventanas]::Texto($h); proceso = (Proceso $h); via = $via; texto = $texto } | ConvertTo-Json -Compress
