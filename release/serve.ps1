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
# Usage: powershell -ExecutionPolicy Bypass -File serve.ps1 [port] [--lan]
#
# Without --lan this listens on localhost and is reachable from this machine
# only. --lan makes it reachable from other machines on the network, which
# Windows only permits with a one time reservation made by an administrator.
# The script prints the exact commands if that reservation is missing.

param(
  [Parameter(Position = 0)][string]$Port = '8000',
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

# Accept --lan in either slot, so "serve.ps1 --lan" and "serve.ps1 8080 --lan"
# both work and match how serve.py and serve.mjs are invoked.
$lanTokens = @('--lan', '-lan', '/lan')
$Lan = ($Rest | Where-Object { $lanTokens -contains $_ }).Count -gt 0
if ($lanTokens -contains $Port) { $Lan = $true; $Port = '8000' }
$Port = [int]$Port

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
# rights, which is what keeps the default a zero install, zero prompt path.
# Anything wider needs a reservation, made once, by an administrator.
$host_ = if ($Lan) { '+' } else { 'localhost' }

$listener = New-Object System.Net.HttpListener
$bound = $false
$denied = $false
foreach ($p in $Port..($Port + 19)) {
  try {
    $listener.Prefixes.Clear()
    $listener.Prefixes.Add("http://${host_}:$p/")
    $listener.Start()
    $Port = $p
    $bound = $true
    break
  } catch {
    # "Access is denied" means the reservation is missing and no other port
    # will help, so stop rather than walking the whole range.
    if ($_.Exception.Message -match 'Access is denied') { $denied = $true; break }
    # Otherwise the port is in use; try the next one.
  }
}

if ($denied) {
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  Write-Host ""
  Write-Host "Cannot listen on the network. Windows needs a one time reservation"
  Write-Host "for this, created by an administrator."
  Write-Host ""
  Write-Host "In an administrator PowerShell, run both of these once:"
  Write-Host ""
  Write-Host "    netsh http add urlacl url=http://+:$Port/ user=`"$me`""
  Write-Host ""
  Write-Host "    New-NetFirewallRule -DisplayName 'PDF Requirement Designer' ``"
  Write-Host "      -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow ``"
  Write-Host "      -Profile Domain"
  Write-Host ""
  Write-Host "Then run this again with --lan, as yourself, no elevation needed."
  Write-Host ""
  Write-Host "To undo them later:"
  Write-Host "    netsh http delete urlacl url=http://+:$Port/"
  Write-Host "    Remove-NetFirewallRule -DisplayName 'PDF Requirement Designer'"
  Write-Host ""
  Write-Host "Note that anyone who can reach this machine on port $Port will then"
  Write-Host "have access. There is no login."
  Write-Host ""
  exit 1
}
if (-not $bound) { Write-Error "No free port between $Port and $($Port + 19)."; exit 1 }

$url = "http://localhost:$Port/"
Write-Host "PDF Requirement Designer running at $url"
if ($Lan) {
  Write-Host "Others on the network use http://$($env:COMPUTERNAME):$Port/"
  Write-Host "There is no login. Anyone who can reach this machine gets in."
}
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
