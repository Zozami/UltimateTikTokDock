# ---------------------------------------------------------------------
# TikFinity Dock - one-time setup for every creator.
# Launched by SETUP.bat (double-click). Safe to run as many times as you
# like: every step checks whether it is already done.
#
#   powershell -File setup.ps1            interactive
#   powershell -File setup.ps1 -Yes       take the defaults, no questions
#   powershell -File setup.ps1 -SkipLike  chat bridge only
# ---------------------------------------------------------------------
# ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less files as
# ANSI, and smart punctuation would turn into mojibake in the console.

param(
  [switch]$Yes,
  [switch]$SkipLike,
  [switch]$SkipLogin
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$bridge = Join-Path $here "chat-bridge.ps1"
$port = 8080
$startup = [Environment]::GetFolderPath("Startup")

$script:ok = 0
$script:warn = 0

function Step($n, $text) { Write-Host ""; Write-Host " [$n] $text" -ForegroundColor Cyan }
function Ok($text)   { $script:ok++;   Write-Host "     [ok] $text" -ForegroundColor Green }
function Warn($text) { $script:warn++; Write-Host "     [!]  $text" -ForegroundColor Yellow }
function Bad($text)  { $script:warn++; Write-Host "     [x]  $text" -ForegroundColor Red }
function Note($text) { Write-Host "          $text" -ForegroundColor DarkGray }
function Rule { Write-Host ""; Write-Host " -----------------------------------------------" -ForegroundColor DarkGray }

function Ask($question, $default) {
  if ($Yes) { return $default }
  $a = Read-Host "     $question [Y/n]"
  if ([string]::IsNullOrWhiteSpace($a)) { return $default }
  return ($a -match "^(y|yes)$")
}

function Test-Port($p) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $up = $c.ConnectAsync("127.0.0.1", $p).Wait(600)
    $c.Close()
    return $up
  } catch { return $false }
}

# Ask whatever is on the port which build of chat-bridge.ps1 it is. An older
# copy keeps the port busy after a GitHub pull, and the routes the new dock
# needs then answer "unknown helper route" - which looks like a broken button
# rather than a helper that needs swapping. One short request settles it.
function Get-HelperVer($p) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect("127.0.0.1", $p)
    $s = $c.GetStream()
    $req = "GET /key/info HTTP/1.1`r`nHost: 127.0.0.1`r`nConnection: close`r`n`r`n"
    $b = [Text.Encoding]::ASCII.GetBytes($req)
    $s.Write($b, 0, $b.Length)
    $s.Flush()
    $ms = New-Object IO.MemoryStream
    $buf = New-Object byte[] 4096
    while ($ms.Length -lt 65536) {
      $n = $s.Read($buf, 0, $buf.Length)
      if ($n -le 0) { break }
      $ms.Write($buf, 0, $n)
    }
    $c.Close()
    $txt = [Text.Encoding]::UTF8.GetString($ms.ToArray())
    $a = $txt.IndexOf("{")
    $z = $txt.LastIndexOf("}")
    if ($a -lt 0 -or $z -le $a) { return $null }
    return [string]((($txt.Substring($a, $z - $a + 1)) | ConvertFrom-Json).helperVer)
  } catch { return $null }
}

# The version lives in chat-bridge.ps1, so that file stays the one place to
# edit. An old chat-bridge.ps1 that predates the stamp just reads as blank.
function Get-WantedVer {
  try {
    $m = [regex]::Match((Get-Content $bridge -Raw), '\$script:helperVer\s*=\s*"([^"]+)"')
    if ($m.Success) { return $m.Groups[1].Value }
  } catch { }
  return ""
}

# Only ever stops our own bridge: a powershell process whose command line
# names chat-bridge.ps1 on this port, and never this script itself.
function Stop-Helper($p) {
  $me = $PID
  $hit = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $me -and $_.CommandLine -and
                   $_.CommandLine -like "*chat-bridge.ps1*" -and $_.CommandLine -like "*$p*" })
  foreach ($h in $hit) {
    try { Stop-Process -Id $h.ProcessId -Force -ErrorAction Stop } catch { }
  }
  if ($hit.Count) { Start-Sleep -Seconds 2 }
  return $hit.Count
}

function Write-StartupVbs($name, $lines) {
  $path = Join-Path $startup $name
  try {
    Set-Content -Path $path -Value $lines -Encoding ASCII
    return $path
  } catch {
    return $null
  }
}

# ---------------------------------------------------------------------
Write-Host ""
Write-Host "  TikFinity Dock  -  setup" -ForegroundColor White
Write-Host "  Everything below is one time. Re-run this any time to fix it." -ForegroundColor DarkGray

if (-not (Test-Path $bridge)) {
  Write-Host ""
  Bad "chat-bridge.ps1 is missing next to setup.ps1 - keep the folder together."
  exit 1
}

# --- 1. Chat bridge ------------------------------------------------
Step "1/6" "Chat bridge  (chat sending + stream keys)"

$vbsPath = Write-StartupVbs "tikfinity-chat-bridge.vbs" @(
  'CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + $bridge + '""", 0, False'
)
if ($vbsPath) { Ok "starts with Windows (no admin rights)" }
else {
  Warn "could not write to the Startup folder - start chat-bridge.ps1 by hand"
  Note "$startup"
}

$wantVer = Get-WantedVer
if (Test-Port $port) {
  $runVer = Get-HelperVer $port
  if ($runVer -eq $wantVer) {
    Ok "already running on port $port (up to date)"
  } elseif (-not $runVer -and -not $wantVer) {
    Ok "already running on port $port"
  } else {
    $was = if ($runVer) { " (running $runVer, this folder is $wantVer)" } else { " (an older copy with no version stamp)" }
    $n = Stop-Helper $port
    if ($n -gt 0 -and (Test-Port $port)) { $n = Stop-Helper $port }
    if (Test-Port $port) {
      Warn "something else is holding port $port$was - close it, then run SETUP.bat again"
      Note "that is not chat-bridge.ps1, so it was left alone"
    } else {
      Ok "replaced the old chat bridge$was"
      Start-Process powershell.exe -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
        "-File", "`"$bridge`"", "-Port", "$port"
      ) -WindowStyle Hidden
      Start-Sleep -Seconds 3
      if (Test-Port $port) { Ok "restarted (hidden, port $port)" }
      else { Bad "did not come back up - run chat-bridge.ps1 by hand to see why" }
    }
  }
} else {
  Start-Process powershell.exe -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
    "-File", "`"$bridge`"", "-Port", "$port"
  ) -WindowStyle Hidden
  Start-Sleep -Seconds 3
  if (Test-Port $port) { Ok "started (hidden, port $port)" }
  else {
    Bad "no answer on port $port - run chat-bridge.ps1 by hand to see why"
    Note "powershell -ExecutionPolicy Bypass -File `"$bridge`""
  }
}

# --- 2. Streamlabs token -------------------------------------------
Step "2/6" "Stream key token (optional - only needed to go live from the dock)"

$tokenSource = ""
if ($env:TF_SLOBS_TOKEN) { $tokenSource = "TF_SLOBS_TOKEN environment variable" }
elseif (Test-Path (Join-Path $here "slobs-token.txt")) {
  $t = (Get-Content (Join-Path $here "slobs-token.txt") -Raw).Trim()
  if ($t) { $tokenSource = "slobs-token.txt" }
}
if (-not $tokenSource) {
  foreach ($p in @((Join-Path $here "config.json"))) {
    if (Test-Path $p) {
      try {
        $j = Get-Content $p -Raw | ConvertFrom-Json
        if ($j.token) { $tokenSource = $p; break }
      } catch { }
    }
  }
}
if ($tokenSource) { Ok "token found ($tokenSource)" }
else {
  Warn "not signed in to Streamlabs yet - 'Start stream' will stay greyed out"
  Note 'Everything in the dock works without this, so carry on.'
  Note 'When you want to go live from the dock: Settings -> Stream key ->'
  Note 'Connect... -> Sign in with Streamlabs. Your browser opens, you sign'
  Note 'in with TikTok, and the dock saves the token next to this script.'
}

# --- 3. Like engine ------------------------------------------------
Step "3/6" "Like engine (optional - a second account taps Like for you)"

$node = Get-Command node -ErrorAction SilentlyContinue
if ($SkipLike) {
  Note "skipped on request"
} elseif (-not $node) {
  Warn "Node.js not found - skipping the like engine"
  Note "Install it from https://nodejs.org (LTS), then run SETUP again."
} elseif (-not (Ask "Install the like engine now?" $true)) {
  Note "skipped - run SETUP again any time to install it"
} else {
  Push-Location $here
  try {
    if (Test-Path (Join-Path $here "node_modules")) {
      Ok "dependencies already installed"
    } else {
      Write-Host "     installing dependencies (about 20 seconds)..." -ForegroundColor DarkGray
      & npm install --no-fund --no-audit --loglevel=error 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { Bad "npm install failed - check your internet and re-run" }
      else { Ok "dependencies installed" }
    }
  } finally { Pop-Location }

  if (Test-Path (Join-Path $here "node_modules")) {
    $likeVbs = Write-StartupVbs "tikfinity-like-engine.vbs" @(
      'Set WshShell = CreateObject("WScript.Shell")',
      "WshShell.CurrentDirectory = `"$here`"",
      'WshShell.Run "cmd /c node auto-liker.js >> like-engine.log 2>&1", 0, False'
    )
    if ($likeVbs) { Ok "starts with Windows (hidden)" }

    if ((Ask "Log in to your second TikTok account now? (a browser opens)" $true) -and -not $SkipLogin) {
      Push-Location $here
      Write-Host "     a browser will open - log in there as account 2." -ForegroundColor DarkGray
      Write-Host "     nothing to press here; this waits for the login and saves it." -ForegroundColor DarkGray
      & node auto-liker.js --login
      Pop-Location
      Ok "login saved in like-engine-profile (keep that folder private)"
      Start-Sleep -Seconds 2
    } else {
      Note "later: run  node auto-liker.js --login  in this folder"
    }
  }
}

# --- 4. Verify -----------------------------------------------------
Step "4/6" "Checking"

if (Test-Path (Join-Path $here "index.html")) { Ok "dock files are here" }
else { Bad "index.html is missing - keep the folder together" }

$listen = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
          Where-Object { $_.LocalPort -in @(4455, 4456, 4457) }
if ($listen) { Ok "OBS websocket is listening on port $($listen[0].LocalPort)" }
else { Note "OBS websocket not found - needed only for 'Send to OBS' / 'Send to Aitum'" }

# --- 5. In TikFinity ------------------------------------------------
Step "5/6" "Two clicks in TikFinity Desktop"
Note "Settings > Integrations > Streamer.bot > ENABLE"
Note "    IP 127.0.0.1    Port $port    Endpoint /"
Note "    then Test Connection, and restart your live connection"
Note "Settings > Chatbot > tick 'Allow Streamer.bot to push messages'"
Note "    (this is what lets the dock send chat AS YOU)"

# --- 6. In OBS -----------------------------------------------------
Step "6/6" "Add the dock in OBS"
Note "View > Docks > Custom Browser Docks..."
Note "    Name: TikFinity"
Note "    URL:  file:///$($here -replace '\\','/')/index.html"
Note "Optional second dock for wide layouts:"
Note "    Name: TikFinity Controls"
Note "    URL:  file:///$($here -replace '\\','/')/index.html?panel=controls"

# ---------------------------------------------------------------------
Rule
Write-Host " Setup finished: $script:ok ok, $script:warn thing(s) to look at." -ForegroundColor White
Write-Host ""
Write-Host " When you go live:"
Write-Host "   1. Start TikFinity Desktop, press 'Connect to live' in it"
Write-Host "   2. In the dock, press the retry button (it starts TikFinity for you)"
Write-Host "   3. Settings > Stream key > Start stream, then Send to OBS or Aitum"
Write-Host ""
Write-Host " Full guide: SETUP.md    Troubleshooting: chat-bridge.log"
Write-Host ""