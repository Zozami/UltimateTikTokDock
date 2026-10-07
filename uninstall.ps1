# ---------------------------------------------------------------------
# TikFinity Dock - clean uninstall.
# Launched by UNINSTALL.bat. Undoes everything SETUP.bat installed:
#   - the two Startup-folder launchers
#   - the running chat bridge and like engine
#   - optionally the downloaded dependencies, the logged-in browser
#     profile (contains session cookies), the stream key token and logs
#
# It never deletes the dock itself (index.html, app.js, ...). Deleting the
# folder is one click in Explorer and keeps this script alive while it runs.
# ---------------------------------------------------------------------
# ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less files as ANSI.

param(
  [switch]$Yes,        # do not ask anything
  [switch]$KeepFiles   # only undo the auto-start + stop processes
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$startup = [Environment]::GetFolderPath("Startup")

function Ok($t)   { Write-Host "     [removed] $t" -ForegroundColor Green }
function Did($t)  { Write-Host "     [stopped]  $t" -ForegroundColor Green }
function None($t) { Write-Host "     [absent]  $t" -ForegroundColor DarkGray }
function Warn($t) { Write-Host "     [!]       $t" -ForegroundColor Yellow }
function Ask($q, $d) {
  if ($Yes) { return $d }
  $a = Read-Host "     $q [Y/n]"
  if ([string]::IsNullOrWhiteSpace($a)) { return $d }
  return ($a -match "^(y|yes)$")
}

Write-Host ""
Write-Host "  TikFinity Dock  -  uninstall" -ForegroundColor White
Write-Host "  Undoes everything SETUP.bat installed." -ForegroundColor DarkGray

# --- 1. auto-start launchers --------------------------------------
Write-Host ""
Write-Host " [1/4] Windows auto-start" -ForegroundColor Cyan
foreach ($n in @("tikfinity-chat-bridge.vbs", "tikfinity-like-engine.vbs")) {
  $p = Join-Path $startup $n
  if (Test-Path $p) {
    try { Remove-Item $p -Force; Ok $n }
    catch { Warn "could not delete $n - delete it from $startup by hand" }
  } else { None $n }
}

# --- 2. running processes -----------------------------------------
Write-Host ""
Write-Host " [2/4] Stopping what is running" -ForegroundColor Cyan

function Stop-Matching($label, $match) {
  $hit = $false
  foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
    $cmd = [string]$p.CommandLine
    if (-not $cmd) { continue }
    if ($cmd -like $match -and $p.ProcessId -ne $PID) {
      try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $hit = $true }
      catch { Warn "could not stop $label (pid $($p.ProcessId))" }
    }
  }
  if ($hit) { Did $label } else { None "$label not running" }
}

# only our own bridge: a powershell.exe running THIS script
Stop-Matching "chat bridge" "*chat-bridge.ps1*"
# only our own engine: node running auto-liker.js from this folder
Stop-Matching "like engine" "*auto-liker.js*"
Write-Host "          note: OBS and TikFinity were left alone" -ForegroundColor DarkGray

# --- 3. files -----------------------------------------------------
Write-Host ""
Write-Host " [3/4] Files" -ForegroundColor Cyan

if ($KeepFiles) {
  Write-Host "     keeping node_modules, like-engine-profile, token and logs (-KeepFiles)" -ForegroundColor DarkGray
} else {
  # the browser profile holds a real TikTok session - delete it by default
  $big = @()
  if (Test-Path (Join-Path $here "node_modules")) { $big += "node_modules (the like engine's downloads, ~50MB)" }
  if (Test-Path (Join-Path $here "like-engine-profile")) { $big += "like-engine-profile (your logged-in TikTok session)" }
  if (Test-Path (Join-Path $here "slobs-token.txt")) { $big += "slobs-token.txt (your Streamlabs token)" }
  if (Test-Path (Join-Path $here "config.json")) { $big += "config.json" }

  if ($big.Count -eq 0) {
    None "nothing else to delete"
  } elseif (Ask ("Also delete: " + ($big -join ", ") + "?") $true) {
    foreach ($item in @("node_modules", "like-engine-profile", "slobs-token.txt", "config.json")) {
      $p = Join-Path $here $item
      if (-not (Test-Path $p)) { continue }
      try { Remove-Item $p -Recurse -Force -ErrorAction Stop; Ok $item }
      catch { Warn "could not delete $item - close anything using it and retry" }
    }
  } else {
    Write-Host "     kept, as asked" -ForegroundColor DarkGray
  }

  foreach ($log in @("chat-bridge.log", "like-engine.log")) {
    $p = Join-Path $here $log
    if (Test-Path $p) {
      try { Remove-Item $p -Force; Ok $log } catch { Warn "could not delete $log" }
    }
  }
}

# --- 4. what is left to do by hand --------------------------------
Write-Host ""
Write-Host " [4/4] Two things only you can undo" -ForegroundColor Cyan
Write-Host "     1. In OBS: close the dock (right-click its title, uncheck it)"
Write-Host "        in View > Docks, then delete this folder in Explorer."
Write-Host "     2. In TikFinity Desktop, clear the Streamer.bot connection"
Write-Host "        (Setup > Streamer.bot) and untick the Chatbot push option."
Write-Host ""
Write-Host "     OBS's WebSocket server and password are still set - OBS owns"
Write-Host "     those, so turn them off yourself if you want: Tools > WebSocket"
Write-Host "     Server Settings."
Write-Host ""
Write-Host " Uninstalled. Nothing of yours was touched beyond the four items above."
Write-Host ""