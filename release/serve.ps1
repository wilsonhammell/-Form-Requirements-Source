# Serves this folder over http://localhost so the designer can run.
#
# Uses only what ships with Windows, so a machine with no Python and no Node
# can still run this. Windows PowerShell 5.1 and .NET's HttpListener are both
# present on a stock Windows 10/11 install.
#
# The app cannot be opened straight off the filesystem: it loads as an ES
# module and reads two JSON files, and browsers block both over file://.
#
# The .mjs content type below is not optional. A browser refuses to run a
# module script that is not served as JavaScript, which would leave pdf.js
# with no worker and no page would ever render.
#
# Usage: powershell -ExecutionPolicy Bypass -File serve.ps1 [port]

param([int]$Port = 8000)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $PSScriptRoot).Path

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
}

# Only the literal "localhost" prefix can be bound without administrator
# rights, which is what keeps this a zero install, zero prompt path.
$listener = New-Object System.Net.HttpListener
$bound = $false
foreach ($p in $Port..($Port + 19)) {
  try {
    $listener.Prefixes.Clear()
    $listener.Prefixes.Add("http://localhost:$p/")
    $listener.Start()
    $Port = $p
    $bound = $true
    break
  } catch {
    # Port in use, try the next one.
  }
}
if (-not $bound) { Write-Error "No free port between $Port and $($Port + 19)."; exit 1 }

$url = "http://localhost:$Port/"
Write-Host "PDF Requirement Designer running at $url"
Write-Host "Leave this window open. Press Ctrl+C to stop."
Start-Process $url | Out-Null

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $rel = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }

    # Combine then verify the result is still inside this folder, so a crafted
    # path cannot climb out and read the rest of the disk.
    $full = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $rel))
    $response = $context.Response
    $response.Headers.Add('Cache-Control', 'no-store')

    if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
      $response.StatusCode = 403
      $response.Close()
      continue
    }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $response.StatusCode = 404
      $response.Close()
      continue
    }

    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    $response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
    $bytes = [System.IO.File]::ReadAllBytes($full)
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.Close()
  }
} finally {
  $listener.Stop()
  $listener.Close()
  Write-Host "`nStopped."
}
