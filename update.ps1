# ---------------------------------------------------------------------
# TikFinity Dock - updater.
#
# One job: make "get the new version from GitHub" a click, not a
# download-and-unzip-and-copy. Works with a public repo, and with a private
# one when a token is supplied (see below).
#
#   powershell -File update.ps1                 check, show it, ask, apply
#   powershell -File update.ps1 -Check          check only   (exit 3 = update ready)
#   powershell -File update.ps1 -Apply -Yes     apply silently (what the dock calls)
#   powershell -File update.ps1 -Apply -Force   reinstall even if versions match
#   powershell -File update.ps1 -Json           print the result as JSON
#
# Exit codes: 0 = up to date or applied, 1 = failed, 3 = update available.
#
# PRIVATE REPO: downloading needs a GitHub token with read access to the
# repo's contents. Put one in update-token.txt next to this file, or set
# TF_UPDATE_TOKEN. update-token.txt is gitignored - never share it, and
# never commit it. Public repos need no token at all.
#
# USER DATA IS NEVER TOUCHED. Only files that exist in the downloaded copy
# are written, and the skip list below (tokens, logs, node_modules, the
# like-engine profile, .git) is never written at all. Nothing is deleted.
# ---------------------------------------------------------------------
# ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less files as
# ANSI, and smart punctuation would turn into mojibake in the console.

param(
  [switch]$Check,                 # only look, never apply
  [switch]$Apply,                 # apply without asking (implies -Yes)
  [switch]$Yes,                   # answer yes to the confirmation
  [switch]$Force,                 # apply even when the version already matches
  [switch]$Quiet,                 # minimal output (the dock runs it this way)
  [switch]$Json,                  # print the final state as JSON
  [switch]$SkipRestart,           # leave the chat bridge alone
  [switch]$SkipDeps,              # do not run npm install even if it changed
  [string]$Repo = "Zozami/UltimateTikTokDock",
  [string]$Branch = "main",
  [string]$Token = "",
  # Which chat bridge to restart. 0 = work it out from the running one
  # (its -Port argument), then fall back to 8080.
  [int]$BridgePort = 0,
  # Overrides exist so the updater can be pointed at a mirror or a local
  # test server. Leave them empty for GitHub.
  # Also settable with TF_UPDATE_RAW_BASE / TF_UPDATE_ZIP_URL.
  [string]$RawBase = "",
  [string]$ZipUrl = ""
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$stateFile = Join-Path $here "update-state.json"
$versionFile = Join-Path $here "version.txt"
$script:quiet = [bool]$Quiet

# --- speaking ---------------------------------------------------------
# -Json means ONE line on stdout and nothing else, because the bridge parses
# it. -Quiet means no prose at all (the dock runs it that way).
function Say($text, $color) {
  if ($script:quiet -or $Json) { return }
  if ($color) { Write-Host $text -ForegroundColor $color } else { Write-Host $text }
}
function Fail($text) {
  if (-not $Json) { Write-Host "  [x] $text" -ForegroundColor Red }
  Set-State @{ lastError = $text }
}

# --- state file: the dock and the bridge both read this ----------------
$script:state = @{}
# Loads into $script:state and deliberately outputs NOTHING - a hashtable
# escaping to the pipeline would print a table and corrupt -Json output.
function Read-State {
  $script:state = @{}
  if (Test-Path $stateFile) {
    try {
      $j = Get-Content $stateFile -Raw | ConvertFrom-Json
      foreach ($p in $j.PSObject.Properties) { $script:state[$p.Name] = $p.Value }
    } catch { $script:state = @{} }
  }
}
function Set-State($pairs) {
  foreach ($k in $pairs.Keys) { $script:state[$k] = $pairs[$k] }
  $script:state["checkedAt"] = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  $script:state["current"] = Get-LocalVersion
  $script:state["repo"] = $Repo
  try {
    # No BOM: Set-Content -Encoding UTF8 writes one, and a byte-order mark on
    # the front of a JSON file makes ConvertFrom-Json fail for anyone reading
    # it as text. Same trap as the stream title, one file over.
    $json = $script:state | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText($stateFile, $json, (New-Object Text.UTF8Encoding($false)))
  } catch { }
}

function Get-LocalVersion {
  if (Test-Path $versionFile) {
    try { return (Get-Content $versionFile -Raw).Trim() } catch { }
  }
  return ""
}

# --- token: private repos only ----------------------------------------
function Get-Token {
  if ($Token) { return $Token }
  if ($env:TF_UPDATE_TOKEN) { return $env:TF_UPDATE_TOKEN }
  $f = Join-Path $here "update-token.txt"
  if (Test-Path $f) {
    try {
      $t = (Get-Content $f -Raw).Trim()
      if ($t) { return $t }
    } catch { }
  }
  return ""
}
$script:token = Get-Token

function Get-Headers {
  $h = @{ "User-Agent" = "TikFinityDock-Updater" }
  if ($script:token) { $h["Authorization"] = "Bearer $($script:token)" }
  return $h
}

function Init-Tls {
  try {
    [Net.ServicePointManager]::SecurityProtocol =
      [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11
  } catch { }
}

# --- the remote side ---------------------------------------------------
# A mirror or a test server can be used instead of GitHub with -RawBase /
# -ZipUrl, or - because the bridge passes no switches when it spawns this -
# with TF_UPDATE_RAW_BASE / TF_UPDATE_ZIP_URL in the environment.
function Get-UpdateBase {
  if ($RawBase) { return $RawBase.TrimEnd("/") }
  if ($env:TF_UPDATE_RAW_BASE) { return $env:TF_UPDATE_RAW_BASE.TrimEnd("/") }
  return "https://raw.githubusercontent.com/$Repo/$Branch"
}

function Get-ZipUrl {
  if ($ZipUrl) { return $ZipUrl }
  if ($env:TF_UPDATE_ZIP_URL) { return $env:TF_UPDATE_ZIP_URL }
  return "https://api.github.com/repos/$Repo/zipball/$Branch"
}

function Get-RemoteVersion {
  $url = (Get-UpdateBase) + "/version.txt"
  $r = Invoke-WebRequest -Uri $url -Headers (Get-Headers) -UseBasicParsing -TimeoutSec 20
  return ([string]$r.Content).Trim()
}

function Save-Zip($url, $outFile) {
  Invoke-WebRequest -Uri $url -Headers (Get-Headers) -UseBasicParsing `
    -OutFile $outFile -TimeoutSec 300
}

# --- git transport: the route that needs no token ----------------------
# A folder that is a git clone already holds credentials able to read the
# repo - the same ones `git push` from this folder uses. So when .git is
# here we fetch with git and read version.txt out of the fetched commit,
# then shell the files out of it with `git archive`. A PRIVATE repo needs no
# token file this way, and a public one behaves identically (git asks for no
# credentials for those), so the two transports are interchangeable.
#
# The working tree is never touched: a fetch only writes inside .git, and
# the files are then copied from the fetched commit exactly like the zipball
# path does - same skip list, same no-deletions rule.

function Brief($s) {
  $t = ([string]$s).Trim()
  if (-not $t) { return "" }
  $line = ($t -split "`r?`n" | Where-Object { $_ -and $_.Trim() } | Select-Object -First 1)
  if (-not $line) { return "" }
  if ($line.Length -gt 200) { $line = $line.Substring(0, 200) }
  return $line.Trim()
}

$script:gitExe = $null
function Get-GitExe {
  if ($script:gitExe -ne $null) { return $script:gitExe }
  $script:gitExe = ""
  try {
    $c = Get-Command git.exe -ErrorAction SilentlyContinue
    if (-not $c) { $c = Get-Command git -ErrorAction SilentlyContinue }
    if ($c -and $c.Source) { $script:gitExe = [string]$c.Source }
  } catch { }
  return $script:gitExe
}

function Test-GitMode {
  return [bool]((Get-GitExe) -and (Test-Path (Join-Path $here ".git")))
}

# git must never be able to stop and wait for input. This runs hidden, with
# no console to prompt on, so a missing credential would look like a hang
# instead of a failure. Credentials already cached still work with these on.
function Invoke-Git {
  $git = Get-GitExe
  $oldPrompt = $env:GIT_TERMINAL_PROMPT
  $oldGcm = $env:GCM_INTERACTIVE
  $env:GIT_TERMINAL_PROMPT = "0"
  $env:GCM_INTERACTIVE = "never"
  $code = 1
  $out = @()
  try {
    Push-Location $here
    try {
      $out = & $git @args 2>&1
      $code = $LASTEXITCODE
    } finally { Pop-Location }
  } catch {
    $out = @($_.Exception.Message)
    $code = 1
  } finally {
    $env:GIT_TERMINAL_PROMPT = $oldPrompt
    $env:GCM_INTERACTIVE = $oldGcm
  }
  return @{ code = $code; out = (($out | ForEach-Object { [string]$_ }) -join "`n") }
}

# reached = could the remote be contacted at all. A remote that answers but
# has no version.txt is a DIFFERENT thing from one we cannot reach, and the
# two deserve different words: the first is "push this folder", the second is
# "the network or the credentials are the problem".
function Get-GitRemoteVersion {
  $r = Invoke-Git fetch --quiet --no-tags origin $Branch
  if ($r.code -ne 0) {
    return @{ reached = $false; version = ""; error = "git could not fetch from $Repo ($(Brief $r.out))" }
  }
  $r2 = Invoke-Git show "FETCH_HEAD:version.txt"
  if ($r2.code -ne 0) {
    return @{ reached = $true; version = "";
              error = "GitHub has no version.txt on $Branch yet - commit and push this folder once and updates work from then on" }
  }
  return @{ reached = $true; version = ([string]$r2.out).Trim(); error = "" }
}

function Save-ZipFromGit($outFile) {
  $r = Invoke-Git archive --format=zip "--output=$outFile" FETCH_HEAD
  if ($r.code -ne 0) { throw "git archive failed ($(Brief $r.out))" }
}

# --- what must never be overwritten ------------------------------------
$SKIP_DIRS = @(".git", "node_modules", "like-engine-profile", ".freebuff", ".enc-test")
$SKIP_FILES = @("slobs-token.txt", "update-token.txt", "update-state.json",
                "like-streamer.txt", "config.json", "chat-bridge.log", "like-engine.log")

function Test-SkipPath($rel) {
  $rel = $rel -replace "\\", "/"
  foreach ($d in $SKIP_DIRS) {
    if ($rel -eq $d -or $rel.StartsWith("$d/")) { return $true }
  }
  $name = $rel.Substring($rel.LastIndexOf("/") + 1)
  if ($SKIP_FILES -contains $name) { return $true }
  if ($name -like "*.log") { return $true }
  return $false
}

# --- the chat bridge: find it, stop it, start it again ------------------

# Everything that is OUR bridge: powershell processes running a chat-bridge.ps1.
# Matched on the SCRIPT NAME only, never on the port - the Startup-folder
# launcher starts the bridge with no -Port argument at all, so a port match
# finds nothing and the bridge then never gets restarted. Empty results are
# always wrapped back into an array by the callers: an empty array returned
# from a function arrives as $null, and $null.Count is 0.
function Get-BridgeProcs {
  $me = $PID
  return @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $me -and $_.CommandLine -and $_.CommandLine -like "*chat-bridge.ps1*" })
}

function Get-PortFromCmd($proc) {
  $m = [regex]::Match($proc.CommandLine, "-Port\s+(\d+)")
  if ($m.Success) { return [int]$m.Groups[1].Value }
  return 0
}

# The port the running bridge actually listens on, asked of Windows rather
# than guessed. Get-NetTCPConnection is Windows 8+; older than that falls back
# to the default port.
function Get-ListeningPortOf($pids) {
  try {
    $l = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
      Where-Object { $pids -contains [int]$_.OwningProcess } |
      Select-Object -ExpandProperty LocalPort | Sort-Object -Unique)
    if ($l.Count) { return [int]$l[0] }
  } catch { }
  return 0
}

function Resolve-BridgePort {
  if ($BridgePort -gt 0) { return $BridgePort }
  $procs = @(Get-BridgeProcs)
  foreach ($p in $procs) {
    $n = Get-PortFromCmd $p
    if ($n) { return $n }
  }
  $pids = @($procs | ForEach-Object { [int]$_.ProcessId })
  if ($pids.Count) {
    $n = Get-ListeningPortOf $pids
    if ($n) { return $n }
  }
  return 8080
}

function Test-Port($p) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $up = $c.ConnectAsync("127.0.0.1", $p).Wait(600)
    $c.Close()
    return $up
  } catch { return $false }
}

# Stops our bridge and starts it again so the NEW chat-bridge.ps1 is the code
# that runs. Three rules learned the hard way, in order of how much damage
# they cause:
#   1. Never stop a bridge you are not about to replace. Only the process
#      LISTENING ON THE TARGET PORT is ours - a second OBS instance, a second
#      dock folder or a test bridge on another port must be left running.
#   2. Never leave it stopped. Stopping is only ever half the job, so if the
#      port does not free up we say so rather than walking away.
#   3. Never start a second copy on a port something else owns.
function Restart-Bridge {
  $bridge = Join-Path $here "chat-bridge.ps1"
  if (-not (Test-Path $bridge)) { return "chat-bridge.ps1 is missing - cannot restart the bridge" }
  $port = Resolve-BridgePort
  $procs = @(Get-BridgeProcs)
  $mine = @()
  $others = @()
  foreach ($p in $procs) {
    $lp = Get-ListeningPortOf @([int]$p.ProcessId)
    if ($lp -eq $port) { $mine += $p }
    elseif ($lp -eq 0 -and $procs.Count -eq 1) { $mine += $p }   # one bridge, port unreadable: it is ours
    else { $others += $p }
  }
  foreach ($p in $mine) {
    try { Stop-Process -Id ([int]$p.ProcessId) -Force -ErrorAction Stop } catch { }
  }
  # Wait for the socket to actually go, so the new copy can bind it.
  $deadline = (Get-Date).AddSeconds(8)
  while ((Test-Port $port) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if (Test-Port $port) {
    return "stopped the old bridge, but port $port is still held by something else - start chat-bridge.ps1 yourself"
  }
  Start-Process powershell.exe -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
    "-File", "`"$bridge`"", "-Port", "$port"
  ) -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(12)
  while (-not (Test-Port $port) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
  $note = ""
  if ($others.Count) {
    $note = " (left $($others.Count) other chat bridge running on a different port)"
  }
  if (Test-Port $port) {
    $verb = if ($mine.Count) { "bridge restarted" } else { "bridge started (it was not running)" }
    return "$verb on port $port$note"
  }
  return "bridge did not come back up on port $port - run SETUP.bat"
}

# --- cache-busting: the ?v= numbers in index.html ----------------------
# OBS's dock caches sub-resources hard, so app.js/style.css only get
# re-read when their ?v= changes. Doing it here means nobody has to
# remember to bump three numbers by hand on every release.
function Update-CacheBust {
  $idx = Join-Path $here "index.html"
  if (-not (Test-Path $idx)) { return 0 }
  $html = Get-Content $idx -Raw
  $m = [regex]::Matches($html, "\?v=(\d+)")
  if (-not $m.Count) { return 0 }
  $max = 0
  foreach ($x in $m) { $v = [int]$x.Groups[1].Value; if ($v -gt $max) { $max = $v } }
  $next = $max + 1
  $out = [regex]::Replace($html, "\?v=\d+", "?v=$next")
  if ($out -ne $html) {
    [IO.File]::WriteAllText($idx, $out, (New-Object Text.UTF8Encoding($false)))
  }
  return $next
}

# ---------------------------------------------------------------------
#  Go
# ---------------------------------------------------------------------

Init-Tls
Read-State
$local = Get-LocalVersion
$result = [ordered]@{
  ok               = $false
  current          = $local
  latest           = ""
  updateAvailable  = $false
  applied          = $false
  needsToken       = $false
  noVersion        = $false
  transport        = ""
  skipped          = @()
  files            = 0
  cacheBust        = 0
  deps             = ""
  bridge           = ""
  lastError        = ""
}

Say ""
Say "  TikFinity Dock  -  update" White
Say "  installed $local" DarkGray

# --- which way in? ------------------------------------------------------
# git first when this folder is a clone, because that is what reads a
# PRIVATE repo with no token. HTTPS is tried when git cannot get there, and
# is the only route for a folder that was downloaded rather than cloned.
$remote = ""
$script:transport = ""
$failMsg = ""
$errGit = ""
$errHttp = ""
$noVersion = $false

if (Test-GitMode) {
  $g = Get-GitRemoteVersion
  if ($g.reached -and $g.version) {
    $remote = $g.version
    $script:transport = "git"
    Say "  read $Branch with git" DarkGray
  } elseif ($g.reached) {
    # Definitive: the remote answers and simply is not set up for updates.
    # Asking HTTPS would add nothing, so report this on its own. Flagged
    # separately from a plain failure - this one is a step to take, not a
    # problem to debug, and the dock says so in those words.
    $failMsg = $g.error
    $noVersion = $true
  } else {
    $errGit = $g.error
  }
}

if (-not $script:transport -and -not $failMsg) {
  try {
    $remote = Get-RemoteVersion
    $script:transport = "http"
  } catch {
    $errHttp = Brief $_.Exception.Message
  }
}

if (-not $script:transport -and -not $failMsg) {
  if ($errGit -and $errHttp) {
    $failMsg = "$errGit. Over HTTPS: $errHttp."
  } elseif ($errGit) {
    $failMsg = "$errGit."
  } elseif ($errHttp) {
    $failMsg = "could not read version.txt from $Repo ($errHttp)"
  } else {
    # git is not installed and .git is not here: the plain download case.
    $failMsg = "could not read version.txt from $Repo - is there a network, and is $Branch the right branch?"
  }
}

if ($failMsg) {
  $needsToken = ($script:token -eq "") -and ($errHttp -ne "")
  if ($needsToken) {
    $failMsg += " For a private repo with no git clone behind it, put a read-only GitHub token in update-token.txt (or set TF_UPDATE_TOKEN)."
    $result.needsToken = $true
  }
  Fail $failMsg
  $result.lastError = $script:state["lastError"]
  $result.noVersion = $noVersion
  Set-State @{ latest = ""; updateAvailable = $false; needsToken = $needsToken; transport = ""; noVersion = $noVersion }
  if ($Json) { $result | ConvertTo-Json -Compress } else { Say "  [!] $failMsg" Yellow }
  exit 1
}
$result.transport = $script:transport
# Written once: later Set-State calls merge into this, so the transport the
# dock reports is always the one that actually read the version.
Set-State @{ transport = $script:transport; noVersion = $false }

$result.latest = $remote
$need = $Force -or (-not $local) -or ($remote -ne $local)
$result.updateAvailable = $need

if (-not $need) {
  Set-State @{ latest = $remote; updateAvailable = $false; needsToken = $false; lastError = "" }
  Say "  [ok] already up to date" Green
  if ($Json) { $result.ok = $true; $result | ConvertTo-Json -Compress }
  exit 0
}

Say "  [!] update available: $local -> $remote" Yellow

if ($Check -and -not $Apply) {
  Set-State @{ latest = $remote; updateAvailable = $true; needsToken = $false; lastError = "" }
  Say "  run UPDATE.bat (or -Apply) to install it" DarkGray
  if ($Json) { $result.ok = $true; $result | ConvertTo-Json -Compress }
  exit 3
}

if (-not $Apply -and -not $Yes) {
  $a = Read-Host "  install $remote now? [Y/n]"
  if ($a -and $a -notmatch "^(y|yes)$") {
    Say "  nothing changed" DarkGray
    Set-State @{ latest = $remote; updateAvailable = $true }
    if ($Json) { $result | ConvertTo-Json -Compress }
    exit 0
  }
}

# --- download ---------------------------------------------------------
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("tikfinity-update-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
$zipUrl = Get-ZipUrl
try {
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $zip = Join-Path $tmp "dock.zip"
  $ex = Join-Path $tmp "x"
  if ($script:transport -eq "git") {
    # Packed straight out of the commit we already fetched, so the files
    # cannot be a different build than the version we just read.
    Say "  packing $Branch from git..." DarkGray
    Save-ZipFromGit $zip
    Say "  unpacking" DarkGray
    Expand-Archive -Path $zip -DestinationPath $ex -Force
    $src = $ex
  } else {
    Say "  downloading $Branch..." DarkGray
    Save-Zip $zipUrl $zip
    Say "  unpacking" DarkGray
    Expand-Archive -Path $zip -DestinationPath $ex -Force
    $top = @(Get-ChildItem $ex -Directory | Select-Object -First 1)
    if (-not $top.Count) { throw "the download did not contain a folder" }
    $src = $top[0].FullName
  }
} catch {
  Fail "download failed: $($_.Exception.Message)"
  try { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue } catch { }
  $result.lastError = $script:state["lastError"]
  if ($Json) { $result | ConvertTo-Json -Compress } else { Say "  [!] download failed" Yellow }
  exit 1
}

# --- apply: only files that exist in the download, never deletions -----
$pkgBefore = ""
$pkgPath = Join-Path $here "package.json"
if (Test-Path $pkgPath) { $pkgBefore = (Get-Content $pkgPath -Raw) }

$written = 0
$skipped = @()
$failed = @()
foreach ($f in (Get-ChildItem $src -Recurse -File)) {
  $rel = $f.FullName.Substring($src.Length).TrimStart("\", "/")
  if (Test-SkipPath $rel) { $skipped += $rel; continue }
  $dest = Join-Path $here $rel
  $dir = Split-Path $dest -Parent
  try {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Copy-Item -Path $f.FullName -Destination $dest -Force -ErrorAction Stop
    $written++
  } catch {
    $failed += $rel
  }
}
$result.files = $written
$result.skipped = $skipped
Say "  [ok] $written file(s) updated" Green
if ($skipped.Count) { Say "      kept your own: $($skipped -join ', ')" DarkGray }

# One retry pass for anything that was briefly locked (a file being read
# while it was replaced - usually chat-bridge.ps1 itself).
if ($failed.Count) {
  Start-Sleep -Milliseconds 700
  $again = @()
  foreach ($rel in $failed) {
    $dest = Join-Path $here $rel
    try {
      Copy-Item -Path (Join-Path $src $rel) -Destination $dest -Force -ErrorAction Stop
      $written++; $result.files = $written
    } catch { $again += $rel }
  }
  if ($again.Count) {
    Say "  [!] could not replace: $($again -join ', ')" Yellow
    Say "      close OBS / stop the bridge and run UPDATE.bat again" DarkGray
    $result.lastError = "locked: " + ($again -join ", ")
  }
}

# --- cache-bust so OBS actually re-reads the dock ----------------------
$newBust = Update-CacheBust
$result.cacheBust = $newBust
if ($newBust) { Say "  [ok] dock cache version bumped to $newBust" Green }

Set-State @{ latest = $remote; updateAvailable = $false; needsToken = $false; lastError = $result.lastError }
try { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue } catch { }

# --- restart the bridge so the new code is the code that runs ----------
# BEFORE the dependency install on purpose: the dock is waiting for the
# bridge to come back so it can reload, and npm can take minutes. Only the
# like engine needs node_modules, and it is its own process.
if (-not $SkipRestart) {
  $result.bridge = Restart-Bridge
  Say "  [ok] $($result.bridge)" Green
}
$result.applied = $true
$result.ok = $true

Set-State @{ latest = $remote; updateAvailable = $false; appliedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") }

# --- dependencies, only when package.json actually changed -------------
$pkgAfter = ""
if (Test-Path $pkgPath) { $pkgAfter = (Get-Content $pkgPath -Raw) }
$depsChanged = ($pkgBefore -ne $pkgAfter)
if ($depsChanged -and -not $SkipDeps) {
  $hasModules = Test-Path (Join-Path $here "node_modules")
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if ($hasModules -and $npm) {
    Say "  package.json changed - running npm install" DarkGray
    try {
      Push-Location $here
      & npm install --no-audit --no-fund --loglevel=error 2>&1 | ForEach-Object { if (-not $script:quiet) { Say "      $_" DarkGray } }
      $code = $LASTEXITCODE
      Pop-Location
      if ($code -eq 0) { $result.deps = "installed" } else { $result.deps = "npm install exited $code" }
      Say "  [ok] dependencies $($result.deps)" Green
    } catch {
      try { Pop-Location } catch { }
      $result.deps = "failed: $($_.Exception.Message)"
      Say "  [!] npm install failed - run it by hand in this folder" Yellow
    }
  } else {
    $result.deps = if ($npm) { "no node_modules" } else { "npm not found" }
    Say "  [!] package.json changed but $($result.deps) - run npm install yourself" Yellow
  }
} elseif ($depsChanged) {
  Say "  [!] package.json changed - run npm install yourself" Yellow
}
Say ""
Say "  done - $remote is installed. Refresh the dock in OBS to load it." Green
Say ""

if ($Json) { $result | ConvertTo-Json -Compress }
exit 0
