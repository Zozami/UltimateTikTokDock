# TikFinity Dock - Chat Bridge (Windows PowerShell, ZERO dependencies)
# ---------------------------------------------------------------------
# A tiny single-threaded WebSocket server (raw TCP, no http.sys, no
# runspaces, nothing to install). The OBS dock connects to it as a
# client and sends chat lines; TikFinity Desktop ALSO connects to it
# as a Streamer.bot client (TikFinity Settings -> Integrations ->
# Streamer.bot -> enable, IP 127.0.0.1, port 8080) and posts every
# "sendChatbotMessage" Custom event it receives to TikTok chat as the
# logged-in account.
#
# Normally you never run this by hand: SETUP.bat installs it to
# start automatically with Windows. Manual start (optional):
#   powershell -ExecutionPolicy Bypass -File chat-bridge.ps1 -Port 8080
# ---------------------------------------------------------------------

param(
  [int]$Port = 8080
)

$ErrorActionPreference = "Stop"

# Bump this whenever the dock's expected behaviour changes. Every /key/*
# answer carries it, so the dock can tell a creator that the helper they
# are running is an older copy than the page in front of them - which
# otherwise shows up as a mysterious "could not open browser".
$script:helperVer = "2026.10.11-2"

$logFile = Join-Path $PSScriptRoot "chat-bridge.log"
function Write-Log([string]$msg) {
  $line = "{0} - {1}" -f (Get-Date -Format "h:mm:ss tt"), $msg
  try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch { }
  try { Write-Host $line } catch { }
}

$WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
$sha1 = [System.Security.Cryptography.SHA1]::Create()
$utf8 = [System.Text.Encoding]::UTF8

# ------------------------------ frame helpers -------------------------------

function New-Frame([byte[]]$payload, [byte]$opcode) {
  $len = $payload.Length
  $head = New-Object System.Collections.Generic.List[byte]
  $head.Add([byte](0x80 -bor $opcode))
  if ($len -lt 126) {
    $head.Add([byte]$len)
  } elseif ($len -lt 65536) {
    $head.Add([byte]126)
    $head.Add([byte](($len -shr 8) -band 0xFF))
    $head.Add([byte]($len -band 0xFF))
  } else {
    $head.Add([byte]127)
    for ($i = 7; $i -ge 0; $i--) { $head.Add([byte](($len -shr (8 * $i)) -band 0xFF)) }
  }
  foreach ($b in $payload) { $head.Add($b) }
  return $head.ToArray()
}

function Send-Frame($client, [byte[]]$frameBytes) {
  try {
    $client.Stream.Write($frameBytes, 0, $frameBytes.Length)
    $client.Stream.Flush()
    return $true
  } catch { return $false }
}

function Send-Text($client, [string]$text) {
  return Send-Frame $client (New-Frame $utf8.GetBytes($text) 1)
}

# ------------------------------ ws handshake --------------------------------

function Complete-Handshake($client) {
  # read the HTTP upgrade request headers (ends with a blank line)
  $headerBytes = New-Object System.Collections.Generic.List[byte]
  $buf = New-Object byte[] 4096
  $deadline = [DateTime]::UtcNow.AddSeconds(3)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($client.Stream.DataAvailable) {
      $n = $client.Stream.Read($buf, 0, $buf.Length)
      if ($n -le 0) { break }
      for ($i = 0; $i -lt $n; $i++) { $headerBytes.Add($buf[$i]) }
      $headerText = $utf8.GetString($headerBytes.ToArray())
      if ($headerText.Contains("`r`n`r`n")) { break }
    } else { Start-Sleep -Milliseconds 10 }
  }
  $all = $headerBytes.ToArray()
  # split headers from body at the byte level: a POST's body often arrives in
  # the same TCP segment as the headers, and must not be thrown away
  $sep = -1
  for ($i = 0; $i -lt ($all.Length - 3); $i++) {
    if ($all[$i] -eq 13 -and $all[$i+1] -eq 10 -and $all[$i+2] -eq 13 -and $all[$i+3] -eq 10) { $sep = $i; break }
  }
  if ($sep -lt 0) { return $false }
  $headerText = $utf8.GetString($all, 0, $sep + 4)
  $headerEnd = $sep + 4

  # --- plain HTTP (not a WebSocket upgrade): only /launch is served ---------
  # The dock's Reconnect button pings this to start TikFinity on demand.
  # Deliberately fire-and-forget for the caller: no auto-launch, ever.
  if ($headerText -notmatch "(?im)^upgrade:\s*websocket") {
    $requestLine = ($headerText -split "`r`n")[0]
    $path = ($requestLine -split " ")[1]
    # a POST body, if there is one (used to hand over a token without ever
    # putting it in a URL). Read by Content-Length; keep it CORS-simple
    # (text/plain) so the dock's file:// page needs no preflight.
    $body = ""
    if ($requestLine -match "^(?i)POST\s") {
      $clen = 0
      if ($headerText -match "(?im)^content-length:\s*(\d+)") { $clen = [int]$matches[1] }
      if ($clen -gt 0 -and $clen -lt 4096) {
        $bodyBytes = New-Object byte[] $clen
        $got = 0
        # whatever came in with the headers first...
        $rest = $all.Length - $headerEnd
        if ($rest -gt 0) {
          $take = [Math]::Min($rest, $clen)
          [Array]::Copy($all, $headerEnd, $bodyBytes, 0, $take)
          $got = $take
        }
        # ...then the rest of it, briefly waiting if it is still in flight
        $bodyDeadline = [DateTime]::UtcNow.AddSeconds(2)
        while ($got -lt $clen -and [DateTime]::UtcNow -lt $bodyDeadline) {
          if ($client.Stream.DataAvailable) {
            $n = $client.Stream.Read($bodyBytes, $got, $clen - $got)
            if ($n -le 0) { break }
            $got += $n
          } else { Start-Sleep -Milliseconds 15 }
        }
        $body = $utf8.GetString($bodyBytes, 0, $got)
      }
    }
    $result = "unknown"
    if ($path -like "*/launch*") { $result = Start-TikFinityNow }

    # --- helper API (/key/*, /obs/*): always JSON, CORS-open. The dock is on
    # --- file:// inside OBS, so Access-Control-Allow-Origin is required.
    if ($path -like "*/key/*" -or $path -like "*/obs/*" -or $path -like "*/update/*") {
      $out = Handle-HelperRequest $path $body
      # Stamp every answer so the dock can spot an out-of-date helper.
      if ($out -is [hashtable]) { $out.helperVer = $script:helperVer }
      $json = $out | ConvertTo-Json -Compress -Depth 6
      $h = [System.Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK`r`nAccess-Control-Allow-Origin: *`r`nContent-Type: application/json`r`nCache-Control: no-store`r`nContent-Length: $($utf8.GetByteCount($json))`r`nConnection: close`r`n`r`n")
      $b = $utf8.GetBytes($json)
      try { $client.Stream.Write($h, 0, $h.Length); $client.Stream.Write($b, 0, $b.Length); $client.Stream.Flush() } catch { }
      return $false
    }

    # Answer with a 1x1 PNG by default: the OBS dock is loaded from
    # file://, where a fetch() to http:// can be blocked as cross-origin.
    # An <img> request is never CORS-restricted, so this always lands.
    # Callers that want JSON (tests, curl) can add ?json=1.
    if ($path -like "*json=1*") {
      $body = @{ ok = $true; action = $path; result = $result } | ConvertTo-Json -Compress
      $resp = "HTTP/1.1 200 OK`r`nAccess-Control-Allow-Origin: *`r`nContent-Type: application/json`r`nContent-Length: $($utf8.GetByteCount($body))`r`nConnection: close`r`n`r`n$body"
      $rb = $utf8.GetBytes($resp)
      try { $client.Stream.Write($rb, 0, $rb.Length); $client.Stream.Flush() } catch { }
    } else {
      $png = [byte[]](0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x06,0x00,0x00,0x00,0x1F,0x15,0xC4,0x89,0x00,0x00,0x00,0x0D,0x49,0x44,0x41,0x54,0x78,0x9C,0x63,0xF8,0xCF,0xC0,0x00,0x00,0x03,0x00,0x01,0x36,0x24,0x2D,0xAF,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82)
      $head = [System.Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK`r`nAccess-Control-Allow-Origin: *`r`nCache-Control: no-store`r`nContent-Type: image/png`r`nContent-Length: $($png.Length)`r`nConnection: close`r`n`r`n")
      try { $client.Stream.Write($head, 0, $head.Length); $client.Stream.Write($png, 0, $png.Length); $client.Stream.Flush() } catch { }
    }
    return $false
  }

  $key = $null
  $proto = $null
  foreach ($line in ($headerText -split "`r`n")) {
    $idx = $line.IndexOf(":")
    if ($idx -lt 1) { continue }
    $name = $line.Substring(0, $idx).Trim().ToLower()
    $value = $line.Substring($idx + 1).Trim()
    if ($name -eq "sec-websocket-key") { $key = $value }
    if ($name -eq "sec-websocket-protocol" -and -not $proto) { $proto = ($value -split ",")[0].Trim() }
  }
  if (-not $key) { return $false }

  $accept = [Convert]::ToBase64String($sha1.ComputeHash($utf8.GetBytes($key + $WS_GUID)))
  $resp = "HTTP/1.1 101 Switching Protocols`r`nUpgrade: websocket`r`nConnection: Upgrade`r`nSec-WebSocket-Accept: $accept`r`n"
  if ($proto) { $resp += "Sec-WebSocket-Protocol: $proto`r`n" }
  $resp += "`r`n"
  $bytes = $utf8.GetBytes($resp)
  $client.Stream.Write($bytes, 0, $bytes.Length)
  $client.Stream.Flush()
  return $true
}

# ------------------------- per-client frame parsing -------------------------
# returns a list of decoded messages (text) received this tick

function Drain-Frames($client) {
  $messages = New-Object System.Collections.Generic.List[string]
  $stream = $client.Stream
  $buf = New-Object byte[] 8192

  # pull in whatever arrived
  while ($stream.DataAvailable) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    for ($i = 0; $i -lt $n; $i++) { $client.Buf.Add($buf[$i]) }
  }

  # parse as many complete frames as the buffer holds
  while ($true) {
    $b = $client.Buf
    if ($b.Count -lt 2) { break }
    $opcode = $b[0] -band 0x0F
    $masked = ($b[1] -band 0x80) -ne 0
    $len = [int]($b[1] -band 0x7F)
    $off = 2
    if ($len -eq 126) {
      if ($b.Count -lt 4) { break }
      $len = ([int]$b[2] -shl 8) -bor [int]$b[3]
      $off = 4
    } elseif ($len -eq 127) {
      if ($b.Count -lt 10) { break }
      $len = 0
      for ($i = 2; $i -le 9; $i++) { $len = ($len -shl 8) -bor [int]$b[$i] }
      $off = 10
    }
    $maskKey = $null
    if ($masked) {
      if ($b.Count -lt ($off + 4)) { break }
      $maskKey = [byte[]]@($b[$off], $b[$off + 1], $b[$off + 2], $b[$off + 3])
      $off += 4
    }
    if ($b.Count -lt ($off + $len)) { break }

    $payload = New-Object byte[] $len
    for ($i = 0; $i -lt $len; $i++) {
      $byte = $b[$off + $i]
      if ($maskKey) { $byte = $byte -bxor $maskKey[$i -band 3] }
      $payload[$i] = [byte]$byte
    }
    $b.RemoveRange(0, $off + $len)

    if ($opcode -eq 8) {
      # close
      Send-Frame $client (New-Frame (New-Object byte[] 0) 8) | Out-Null
      $client.Open = $false
      break
    }
    elseif ($opcode -eq 9) {
      # ping -> pong
      Send-Frame $client (New-Frame $payload 10) | Out-Null
    }
    elseif ($opcode -eq 1) {
      $messages.Add($utf8.GetString($payload))
    }
    # 0x0 continuation / 0x2 binary: not used by this protocol - ignored
  }
  return $messages
}

# ------------------------------ server loop ---------------------------------

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try {
  $listener.Start()
} catch {
  Write-Log "ERROR: cannot listen on port $Port ($($_.Exception.Message))"
  Write-Log "Is Streamer.bot or another copy already using it? Change the port in the dock's Settings -> Chat sending, or run: powershell -ExecutionPolicy Bypass -File chat-bridge.ps1 -Port 8090"
  exit 1
}

Write-Log "Chat bridge listening on ws://127.0.0.1:$Port"
Write-Log "In TikFinity: Settings -> Integrations -> Streamer.bot -> ENABLE it"
Write-Log "  IP: 127.0.0.1   Port: $Port   (then restart the live connection)"
Write-Log "In TikFinity: Chatbot must be ENABLED (messages are sent as chatbot)."
Write-Log "Ready. This window can be minimised; chat sending works whenever TikFinity is open."

$clients = New-Object System.Collections.Generic.List[object]

# ---------------------------------------------------------------------------
# MANUAL launch endpoint. Nothing here starts TikFinity on its own - the dock's
# Reconnect button is the ONLY trigger, and it asks us over plain HTTP:
#     http://127.0.0.1:<port>/launch
# We start TikFinity (minimised) if it isn't already running, then answer.
# ---------------------------------------------------------------------------

$tfExe = $env:TF_TIKFINITY_EXE
if (-not $tfExe) {
  $guess = Join-Path $env:LOCALAPPDATA "Programs\TikFinity\TikFinity.exe"
  if (Test-Path $guess) { $tfExe = $guess }
}

function Test-TikFinityUp {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $c.BeginConnect("127.0.0.1", 21213, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(400)) { return $false }
    $c.EndConnect($iar)
    return $true
  } catch { return $false }
  finally { try { $c.Close() } catch { } }
}

function Start-TikFinityNow {
  if (Test-TikFinityUp) {
    Write-Log "launch requested - TikFinity is already running"
    return "already-running"
  }
  if (-not $tfExe -or -not (Test-Path $tfExe)) {
    Write-Log "launch requested but TikFinity.exe was not found (set TF_TIKFINITY_EXE if it moved)"
    return "not-found"
  }
  try {
    Start-Process -FilePath $tfExe -WindowStyle Minimized | Out-Null
    Write-Log "launch requested - starting TikFinity (minimised)"
    return "started"
  } catch {
    Write-Log "could not launch TikFinity: $($_.Exception.Message)"
    return "failed"
  }
}

# ---------------------------------------------------------------------------
# Streamlabs SLOBS proxy - hands the dock a TikTok stream URL + key.
# Same API the "StreamLabs TikTok Stream Key Generator" tool calls, but we
# call it ourselves so no external app is needed. Token comes from
#   1. the TF_SLOBS_TOKEN environment variable, or
#   2. slobs-token.txt next to this script (gitignored - never share it), or
#   3. the generator tool's own config.json, if it is still on the machine.
# Endpoints (all GET, so the file:// dock never needs a CORS preflight):
#   /key/info                      account + can-go-live status
#   /key/start?title=&category=     create a broadcast session -> url + key
#   /key/login                     start the Streamlabs sign-in
#   /key/logintatus                poll it while the browser comes back
# ---------------------------------------------------------------------------

$SLOBS_API = "https://streamlabs.com/api/v5/slobs"
$script:slobsToken = $null

function Get-SlobsToken {
  if ($script:slobsToken) { return $script:slobsToken }
  if ($env:TF_SLOBS_TOKEN) { return $env:TF_SLOBS_TOKEN }

  $tokenFile = Join-Path $PSScriptRoot "slobs-token.txt"
  if (Test-Path $tokenFile) {
    try {
      $t = (Get-Content $tokenFile -Raw).Trim()
      if ($t) { $script:slobsToken = $t; return $script:slobsToken }
    } catch { }
  }

  # any config.json that happens to sit next to us (e.g. from the old
  # StreamLabs TikTok Stream Key Generator, if a creator kept it here)
  $candidates = @(
    (Join-Path $PSScriptRoot "config.json"),
    (Join-Path $PSScriptRoot "StreamLabsTikTokStreamKeyGenerator\config.json")
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) {
      try {
        $j = Get-Content $p -Raw | ConvertFrom-Json
        if ($j.token) { $script:slobsToken = [string]$j.token; return $script:slobsToken }
      } catch { }
    }
  }
  return $null
}

function Invoke-Slobs($method, $url, $bodyObj, $tokenOverride) {
  $token = if ($tokenOverride) { $tokenOverride } else { Get-SlobsToken }
  if (-not $token) {
    return @{ ok = $false; error = "no token found - put it in slobs-token.txt next to chat-bridge.ps1" }
  }
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
  $headers = @{ Authorization = "Bearer $token"; Accept = "application/json"; "User-Agent" = "TikFinityDock" }
  try {
    if ($bodyObj) {
      $json = $bodyObj | ConvertTo-Json -Compress -Depth 5
      # Hand this a STRING body and Windows PowerShell 5.1 encodes it with the
      # machine's ANSI code page (Windows-1252 on a normal English box), so
      # every non-ASCII character in a title - Arabic, Cyrillic, CJK, emoji -
      # reaches Streamlabs as "?" and TikTok shows a row of question marks.
      # UTF-8 BYTES are written through untouched, which fixes it. Measured on
      # 5.1: the string body put 0x3F on the wire, the byte body put the real
      # UTF-8; the charset alone also worked, so both are done here.
      return Invoke-RestMethod -Method $method -Uri $url -Headers $headers `
        -ContentType "application/json; charset=utf-8" `
        -Body $utf8.GetBytes($json) -TimeoutSec 25
    }
    return Invoke-RestMethod -Method $method -Uri $url -Headers $headers -TimeoutSec 25
  } catch {
    $msg = $_.Exception.Message
    try {
      $resp = $_.Exception.Response
      if ($resp) {
        $sr = New-Object IO.StreamReader($resp.GetResponseStream())
        $txt = $sr.ReadToEnd()
        $sr.Close()
        if ($txt) { $msg = $txt }
      }
    } catch { }
    Write-Log "slobs $method failed: $msg"
    return @{ ok = $false; error = $msg }
  }
}

# Streamlabs nests the payload differently across API versions; dig it out.
function Get-Prop($obj, $name) {
  if (-not $obj) { return $null }
  if ($obj -is [hashtable]) {
    if ($obj.ContainsKey($name)) { return $obj[$name] }
    return $null
  }
  if ($obj.PSObject.Properties.Name -contains $name) { return $obj.$name }
  return $null
}

function Find-Field($obj, $name) {
  if (-not $obj) { return $null }
  if ($obj.PSObject.Properties.Name -contains $name) { return $obj.$name }
  foreach ($prop in $obj.PSObject.Properties) {
    $v = $prop.Value
    if ($v -is [PSCustomObject]) {
      $found = Find-Field $v $name
      if ($found) { return $found }
    }
  }
  return $null
}

function Get-SlobsTokenFile { Join-Path $PSScriptRoot "slobs-token.txt" }

# Opens Streamlabs' own sign-in page in the default browser. No url comes in
# from the dock - this is a fixed link, so the helper cannot be used to open
# anything else on the machine.
# Opens a web address in the default browser. Machines with a broken
# http/https file association make Start-Process throw, and some locked-down
# PCs refuse ShellExecute entirely, so try the usual launch routes in turn.
function Open-Url([string]$url) {
  $tries = @(
    { Start-Process $url | Out-Null },
    { [void][System.Diagnostics.Process]::Start($url) },
    { Start-Process "rundll32.exe" -ArgumentList "url.dll,FileProtocolHandler $url" | Out-Null },
    { Start-Process "cmd.exe" -ArgumentList "/c", "start", "`"$url`"" -WindowStyle Hidden | Out-Null }
  )
  foreach ($t in $tries) {
    try { & $t; return $true } catch { }
  }
  return $false
}

# ---------------------------- Streamlabs sign-in ---------------------------
# A standard PKCE code flow, and it turns out not to need Electron at all:
#
#   1. make a random verifier, and its SHA-256 as base64url = the challenge
#   2. listen on a throwaway port
#   3. open  streamlabs.com/slobs/login?...&port=<ours>&code_challenge=<ours>
#   4. Streamlabs sends the browser back to
#      http://127.0.0.1:<ours>/?success=true&code=<one-time code>
#   5. GET /api/v5/slobs/auth/data?code_verifier&code_challenge&code
#      and read data.oauth_token out of the reply
#
# Two things cost real time to work out, so they are worth keeping written
# down: the exchange is a GET (a POST comes back 405), and the query key for
# the code is "code" - "auth_code" is answered with 401. It also only replies
# to a request carrying the Streamlabs Desktop User-Agent plus Origin/Referer.
#
# The token never travels through a URL, through the dock, or into the log.
$script:loginFlow = $null

function New-RandomHex([int]$byteCount) {
  $b = New-Object byte[] $byteCount
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($b)
  $rng.Dispose()
  ($b | ForEach-Object { $_.ToString("x2") }) -join ""
}

function New-CodeChallenge([string]$verifier) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $d = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($verifier))
  $sha.Dispose()
  # base64url, no padding
  ([Convert]::ToBase64String($d).TrimEnd('=').Replace('+', '-').Replace('/', '_'))
}

function Get-FreePort {
  $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
  $l.Start()
  $p = ([System.Net.IPEndPoint]$l.LocalEndpoint).Port
  $l.Stop()
  return $p
}

function Stop-LoginCallback {
  if ($script:loginFlow) {
    try { $script:loginFlow.Listener.Stop() } catch { }
    $script:loginFlow = $null
  }
}

function Start-SlobsLogin {
  Stop-LoginCallback
  $verifier = New-RandomHex 64
  $challenge = New-CodeChallenge $verifier
  $port = Get-FreePort
  $listen = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
  try {
    $listen.Start()
  } catch {
    return @{ ok = $false; error = "Could not open a local port for the sign-in: $($_.Exception.Message)" }
  }
  $url = "https://streamlabs.com/slobs/login?skip_splash=true&external=electron&tiktok&force_verify&origin=slobs&port=$port&code_challenge=$challenge&code_flow=true"
  if (-not (Open-Url $url)) {
    try { $listen.Stop() } catch { }
    Write-Log "could not start a browser for the Streamlabs sign-in"
    return @{ ok = $false; error = "No browser could be started on this PC. Open this address yourself, then press the button again: $url" }
  }
  $script:loginFlow = @{
    Listener = $listen; Port = $port; Verifier = $verifier; Challenge = $challenge
    Code = ""; Started = [DateTime]::UtcNow
  }
  Write-Log "opened Streamlabs sign-in; waiting for the callback on port $port"
  return @{ ok = $true; port = $port; url = $url }
}

# Called from the main server loop. Streamlabs lands the browser on
# /?success=true&code=... - answer that page and keep the code. The exchange
# itself waits for the dock's next poll, so the loop never blocks on network.
function Pump-LoginCallback {
  $f = $script:loginFlow
  if (-not $f) { return }
  if ((([DateTime]::UtcNow) - $f.Started).TotalMinutes -gt 10) {
    Write-Log "Streamlabs sign-in timed out after 10 minutes"
    Stop-LoginCallback
    return
  }
  try {
    while ($f.Listener.Pending()) {
      $tcp = $f.Listener.AcceptTcpClient()
      try {
        $st = $tcp.GetStream()
        $st.ReadTimeout = 3000
        $buf = New-Object byte[] 8192
        $got = 0
        while ($got -lt 8191) {
          $n = $st.Read($buf, $got, 8191 - $got)
          if ($n -le 0) { break }
          $got += $n
          if ([Text.Encoding]::ASCII.GetString($buf, 0, $got).Contains("`r`n`r`n")) { break }
        }
        $req = [Text.Encoding]::ASCII.GetString($buf, 0, $got)
        $line = ($req -split "`r`n")[0]
        $q = Read-Query (($line -split " ")[1])
        $code = [string]$q["code"]
        if ($code) {
          $html = "<h2>Signed in. You can close this tab and go back to OBS.</h2>"
          $f.Code = $code
          Write-Log "Streamlabs sent a sign-in code back"
        } else {
          $html = "<h2>Sign-in did not finish. Go back to OBS and try again.</h2>"
        }
        $b = $utf8.GetBytes($html)
        $h = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK`r`nContent-Type: text/html; charset=utf-8`r`nContent-Length: $($b.Length)`r`nConnection: close`r`n`r`n")
        $st.Write($h, 0, $h.Length)
        $st.Write($b, 0, $b.Length)
        $st.Flush()
      } catch { } finally { try { $tcp.Close() } catch { } }
    }
  } catch { }
}

# Streamlabs passes the three values in the query string, not a body, and
# only answers something that looks like the desktop app - so send that
# User-Agent and the fetch headers it expects.
function Exchange-SlobsCode($verifier, $challenge, $code) {
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
  # Streamlabs only hands this endpoint to something that looks like the
  # desktop app, and their edge is picky about header sets - a wrong
  # combination comes back 401 with an HTML page instead of JSON.
  #
  # GET, not POST - this endpoint answers 405 to a POST body, and the three
  # values travel in the query string. The first entry below is the one
  # Streamlabs actually answers today; the rest are cheap insurance, because
  # a rejected attempt does not burn the one-time code, so the next try
  # still counts.
  $desktop = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) StreamlabsDesktop/1.20.4 Chrome/122.0.6261.156 Electron/29.3.1 Safari/537.36"
  $chrome  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.156 Safari/537.36"
  $fetch = @{ "Sec-Fetch-Site" = "cross-site"; "Sec-Fetch-Mode" = "cors"; "Sec-Fetch-Dest" = "empty" }
  $plain = @{ Accept = "*/*"; "Accept-Language" = "en-US" }
  $web = @{ Origin = "https://streamlabs.com"; Referer = "https://streamlabs.com/slobs/login" }
  $byCode = "code_verifier=$verifier&code_challenge=$challenge&code=$code"
  $byAuthCode = "code_verifier=$verifier&code_challenge=$challenge&auth_code=$code"
  $tries = @(
    @{ n = "code / desktop+origin"; qs = $byCode;      ua = $desktop; h = $fetch + $plain + $web }
    @{ n = "code / desktop";         qs = $byCode;      ua = $desktop; h = $fetch + $plain }
    @{ n = "auth_code / desktop+origin"; qs = $byAuthCode; ua = $desktop; h = $fetch + $plain + $web }
    @{ n = "code / chrome+origin";   qs = $byCode;      ua = $chrome;  h = $fetch + $plain + $web }
    @{ n = "code / desktop bare";    qs = $byCode;      ua = $desktop; h = $plain }
  )
  $last = ""
  foreach ($t in $tries) {
    $headers = $t.h
    $headers["User-Agent"] = $t.ua
    try {
      $r = Invoke-RestMethod -Method GET -Uri "$SLOBS_API/auth/data?$($t.qs)" -Headers $headers -TimeoutSec 25
      if ($r.success) {
        $tok = [string](Find-Field $r "oauth_token")
        if ($tok) {
          Write-Log "token exchange accepted ($($t.n))"
          return Save-SlobsToken $tok
        }
        $last = "reply carried no token"
      } else {
        $last = "Streamlabs said the sign-in failed"
      }
    } catch {
      $code2 = 0
      try {
        $resp = $_.Exception.Response
        if ($resp) { $code2 = [int]$resp.StatusCode }
      } catch { }
      $last = "HTTP $code2"
      Write-Log "token exchange [$($t.n)]: $last"
    }
  }
  Write-Log "token exchange failed on every attempt ($last)"
  return @{ ok = $false; error = "Streamlabs would not complete the sign-in. Try again." }
}

function Get-SlobsLoginStatus {
  $f = $script:loginFlow
  if (-not $f) { return @{ ok = $true; state = "idle" } }
  if ($f.Code) {
    Stop-LoginCallback
    return Exchange-SlobsCode $f.Verifier $f.Challenge $f.Code
  }
  $left = [int](600 - (([DateTime]::UtcNow) - $f.Started).TotalSeconds)
  if ($left -le 0) {
    Stop-LoginCallback
    return @{ ok = $false; state = "error"; error = "Timed out waiting for the sign-in." }
  }
  return @{ ok = $true; state = "waiting"; secondsLeft = $left }
}

# Connect: the dock hands us a Streamlabs token in the POST body (never in a
# URL, never in the log). We only keep it if Streamlabs says who it belongs
# to - a bad token is not written anywhere.
function Connect-SlobsAccount($token) {
  $t = [string]$token
  $t = ($t -replace '\s+', "").Trim()
  if (-not $t -or $t.Length -lt 8) {
    return @{ ok = $false; error = "That does not look like a token." }
  }
  return Save-SlobsToken $t
}

# One place that decides whether a token is real (Streamlabs has to say who it
# belongs to) and then keeps it. Used by both the browser sign-in and a
# hand-pasted token, so neither path can save something that does not work.
function Save-SlobsToken($t) {
  $r = Invoke-Slobs "GET" "$SLOBS_API/tiktok/info" $null $t
  if (-not $r -or $r.error) {
    return @{ ok = $false; error = "Streamlabs did not accept that token." }
  }
  $user = Find-Field $r "username"
  $canLive = $r.can_be_live
  try {
    [IO.File]::WriteAllText((Get-SlobsTokenFile), $t, (New-Object Text.UTF8Encoding($false)))
    $script:slobsToken = $t
    Write-Log "account connected ($user)"
    return @{ ok = $true; state = "connected"; username = [string]$user; canGoLive = $canLive }
  } catch {
    return @{ ok = $false; error = "Token is valid but could not be saved: $($_.Exception.Message)" }
  }
}

# Disconnect: forget the token on this PC. Never touches Streamlabs itself,
# so a creator can come back with one click.
function Disconnect-SlobsAccount {
  $script:slobsToken = $null
  try {
    if (Test-Path (Get-SlobsTokenFile)) {
      Remove-Item (Get-SlobsTokenFile) -Force
      Write-Log "account disconnected (local token removed)"
    }
    return @{ ok = $true; connected = $false }
  } catch {
    return @{ ok = $false; error = $_.Exception.Message }
  }
}

function Get-SlobsInfo {
  $r = Invoke-Slobs "GET" "$SLOBS_API/tiktok/info" $null
  if (-not $r) { return @{ ok = $false; error = "no response" } }
  $user = Find-Field $r "username"
  $status = Find-Field $r "status"
  $canLive = $r.can_be_live
  return @{ ok = $true; username = $user; status = $status; canGoLive = $canLive; raw = $r }
}

function Start-SlobsStream($title, $category, $audience) {
  $body = @{
    title         = $title
    category      = $category
    audience_type = $audience
  }
  $r = Invoke-Slobs "POST" "$SLOBS_API/tiktok/stream/start" $body

  # Streamlabs v5 names these `rtmp` (ingest server) and `key` (the secret),
  # not stream_url/stream_key - look for the real names first, then dig.
  $url = Get-Prop $r "rtmp"
  if (-not $url) { $url = Find-Field $r "stream_url" }
  $key = Get-Prop $r "key"
  if (-not $key) { $key = Find-Field $r "stream_key" }

  if (-not $key -or -not $url) {
    $fields = ""
    try { $fields = ($r.PSObject.Properties.Name -join ", ") } catch { }
    $msg = "no stream key in response"
    $err = Get-Prop $r "error"
    if (-not $err) { $err = Find-Field $r "message" }
    if ($err) { $msg = "$msg - $err" }
    if ($fields) { $msg = "$msg (fields returned: $fields)" }
    Write-Log "stream/start did not return a key: $msg"
    return @{ ok = $false; error = $msg }
  }
  Write-Log "stream session ready (key returned, not logged)"
  # NOT idempotent, and this matters: measured against the live API, a second
  # start returns a different broadcast id AND a different ingest server, even
  # while a publisher is connected and healthy. So every start mints a brand new
  # broadcast. Only ever call this when nothing is being pushed, or the stream
  # that is running gets pointed at an orphan and TikTok shows "live will
  # start shortly" forever.
  return @{
    ok = $true; streamKey = [string]$key; streamUrl = [string]$url
    broadcastId = [string](Get-Prop $r "id")
    title = $title; category = $category
  }
}

function Get-SlobsCategories($term) {
  if (-not $term) { $term = "" }
  $q = [uri]::EscapeDataString($term)
  $r = Invoke-Slobs "GET" "$SLOBS_API/tiktok/info?category=$q" $null
  if (-not $r) { return @{ ok = $false; error = "no response" } }
  $cats = @(Get-Prop $r "categories")
  $list = @()
  foreach ($c in $cats) {
    if (-not $c) { continue }
    $name = Get-Prop $c "full_name"
    if (-not $name) { continue }
    $list += @{ name = [string]$name; id = [string](Get-Prop $c "game_mask_id") }
  }
  return @{ ok = $true; query = $term; categories = $list }
}

# ---------------------------------------------------------------------------
# Self-update plumbing.
#
# The dock cannot do this on its own: it is a page on file:// inside OBS, so
# it can neither read version.txt off the disk nor hold a GitHub token. The
# helper can do both, so the dock asks the helper and the helper reports the
# same two files the updater (update.ps1) reads and writes:
#
#   version.txt        what is installed right now
#   update-state.json  what the last check found (latest, when, any error)
#
# GET  /update/info    instant, no network - reads those two files
# GET  /update/check   starts update.ps1 -Check in the background
# GET  /update/apply   installs it (update.ps1 -Apply) and restarts this bridge
#
# Checking never blocks this server: the fetching happens in update.ps1's own
# process, so a slow or dead network cannot stall the live feed or TikFinity.
# ---------------------------------------------------------------------------

function Get-UpdateState {
  $st = @{}
  $sf = Join-Path $PSScriptRoot "update-state.json"
  if (Test-Path $sf) {
    try {
      $j = Get-Content $sf -Raw | ConvertFrom-Json
      foreach ($p in $j.PSObject.Properties) { $st[$p.Name] = $p.Value }
    } catch { }
  }
  return $st
}

function Get-InstalledVersion {
  $vf = Join-Path $PSScriptRoot "version.txt"
  if (-not (Test-Path $vf)) { return "" }
  try { return (Get-Content $vf -Raw).Trim() } catch { return "" }
}

function Get-UpdateInfo {
  $cur = Get-InstalledVersion
  $st = Get-UpdateState
  $latest = [string]$st["latest"]
  $appliedAt = [string]$st["appliedAt"]
  $checkedAt = [string]$st["checkedAt"]
  $err = [string]$st["lastError"]
  $needsToken = $false
  try { $needsToken = [bool]$st["needsToken"] } catch { }
  # How the last check read GitHub: "git" (a clone, so no token needed),
  # "http" (the plain download route). Empty means it has not got that far.
  $transport = [string]$st["transport"]
  # Reachable repo, but nothing on it to compare against yet. Worded apart
  # from a real failure because the fix is one push, not a debug session.
  $noVersion = $false
  try { $noVersion = [bool]$st["noVersion"] } catch { }
  $updaterHere = Test-Path (Join-Path $PSScriptRoot "update.ps1")
  # A folder that is a git clone can always reach its own remote, so the
  # dock can say so before anything is even checked.
  $isClone = Test-Path (Join-Path $PSScriptRoot ".git")
  return @{
    ok              = $true
    current         = $cur
    latest          = $latest
    updateAvailable = [bool]($latest -and ($latest -ne $cur))
    appliedAt       = $appliedAt
    checkedAt       = $checkedAt
    lastError       = $err
    needsToken      = $needsToken
    noVersion       = $noVersion
    transport       = $transport
    isClone         = $isClone
    updaterPresent  = $updaterHere
  }
}

function Start-Updater($mode) {
  $upd = Join-Path $PSScriptRoot "update.ps1"
  if (-not (Test-Path $upd)) {
    return @{ ok = $false; error = "update.ps1 is missing from this folder - get the newest copy before updating" }
  }
  # -BridgePort is this helper's own port, so the updater restarts THIS one and
  # leaves any other bridge (another OBS instance, another dock folder) alone.
  $a = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
         "-File", "`"$upd`"", "-BridgePort", "$Port")
  if ($mode -eq "apply") { $a += @("-Apply", "-Yes", "-Quiet") }
  else { $a += @("-Check", "-Quiet") }
  try {
    Start-Process powershell.exe -ArgumentList $a -WindowStyle Hidden | Out-Null
    Write-Log "updater started ($mode)"
    return @{ ok = $true; running = $true; mode = $mode }
  } catch {
    Write-Log "could not start the updater: $($_.Exception.Message)"
    return @{ ok = $false; error = $_.Exception.Message }
  }
}

function Read-Query($path) {
  $q = @{}
  if ($path -and $path.Contains("?")) {
    $qs = $path.Substring($path.IndexOf("?") + 1)
    foreach ($pair in ($qs -split "&")) {
      if (-not $pair) { continue }
      $kv = $pair -split "=", 2
      $k = [uri]::UnescapeDataString($kv[0])
      $v = if ($kv.Count -gt 1) { [uri]::UnescapeDataString(($kv[1] -replace "\+", " ")) } else { "" }
      $q[$k] = $v
    }
  }
  return $q
}

# ---------------------------------------------------------------------------
#  Was TikTok actually fed?
#
#  The Aitum plugin reports `streaming: true` the moment Go Live is pressed and
#  keeps saying so while its RTMP output sits in a reconnect loop, so that flag
#  cannot tell a working push from a refused one. OBS does say, in its own log,
#  exactly what the output did - so read that instead of guessing.
#
#  Reads only the tail of the newest log: enough to judge the current attempt,
#  cheap enough to poll every second.
# ---------------------------------------------------------------------------
function Get-ObsPushState {
  $dir = Join-Path $env:APPDATA "obs-studio\logs"
  if (-not (Test-Path $dir)) {
    return @{ ok = $false; error = "no OBS log folder" }
  }
  $log = $null
  try {
    $log = Get-ChildItem -Path $dir -Filter "*.txt" -File |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1
  } catch { }
  if (-not $log) { return @{ ok = $false; error = "no OBS log file" } }

  $tail = ""
  try {
    $fs = [System.IO.File]::Open($log.FullName, "Open", "Read", "ReadWrite")
    try {
      $len = [Math]::Min(262144, $fs.Length)
      $fs.Seek(-$len, "End") | Out-Null
      $buf = New-Object byte[] $len
      $read = $fs.Read($buf, 0, $len)
      if ($read -gt 0) { $tail = [System.Text.Encoding]::UTF8.GetString($buf, 0, $read) }
    } finally { $fs.Close() }
  } catch {
    return @{ ok = $false; error = "could not read the OBS log: $($_.Exception.Message)" }
  }
  if (-not $tail) { return @{ ok = $false; error = "OBS log is empty" } }

  # Only the vertical canvas' own RTMP output matters here.
  $mark = "vertical_canvas_stream"
  $lines = @($tail -split "`r?`n" | Where-Object { $_.Contains($mark) -or $_.Contains("Start output") })

  # Everything since the most recent Go Live is the attempt being judged.
  $cut = -1
  for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    if ($lines[$i].Contains("Start output")) { $cut = $i; break }
  }
  if ($cut -lt 0) {
    return @{ ok = $true; started = $false; connected = $false; reconnects = 0
              frames = 0; droppedPct = 0; note = "Aitum has not been started this log" }
  }
  $attempt = $lines[$cut..($lines.Count - 1)]

  $connected = $false
  $reconnects = 0
  $stopped = $false
  $framesOut = 0
  $droppedPct = 0
  foreach ($l in $attempt) {
    # A stop we asked for is not a refusal, and it is checked first because
    # OBS writes "User stopped the stream" for the dock's own End button.
    if ($l.Contains("User stopped the stream")) {
      $stopped = $true
      $connected = $false
      continue
    }
    if ($l.Contains("Connection to") -and $l.Contains("successful")) { $connected = $true }
    if ($l.Contains("Disconnected from") -or $l.Contains("send error") -or
        $l.Contains("Reconnecting in")) {
      if ($connected) { $reconnects++ }
      $connected = $false
    }
    # OBS only prints frame counts once an output stops.
    if ($l.Contains("Total frames output:")) {
      if ($l -match "Total frames output:\s*(\d+)") { $framesOut = [int]$Matches[1] }
    }
    if ($l.Contains("Number of dropped frames")) {
      if ($l -match "\(([0-9.]+)%\)") { $droppedPct = [double]$Matches[1] }
    }
  }

  $note = ""
  if ($reconnects -gt 0) {
    $note = "TikTok dropped the connection $reconnects time(s) - the broadcast was refused"
  } elseif ($connected) {
    $note = "connected and pushing"
  } elseif ($stopped) {
    $note = "stopped"
  }
  return @{
    ok = $true; started = $true; connected = $connected
    reconnects = $reconnects; frames = $framesOut; droppedPct = $droppedPct
    note = $note; log = $log.Name
  }
}

function Handle-HelperRequest($path, $body) {
  $q = Read-Query $path
  if ($path -like "*/obs/push*") { return Get-ObsPushState }
  if ($path -like "*/key/info*")  { return Get-SlobsInfo }
  if ($path -like "*/key/categories*") {
    $term = if ($q["q"]) { $q["q"] } else { "" }
    return Get-SlobsCategories $term
  }
  if ($path -like "*/key/logintatus*") { return Get-SlobsLoginStatus }
  if ($path -like "*/key/login*")      { return Start-SlobsLogin }
  if ($path -like "*/key/token*")      { return Connect-SlobsAccount $body }
  if ($path -like "*/key/disconnect*") { return Disconnect-SlobsAccount }
  if ($path -like "*/key/start*") {
    $title = if ($q["title"]) { $q["title"] } else { "" }
    $cat = if ($q["category"]) { $q["category"] } else { "Gaming" }
    $aud = if ($q["audience"]) { $q["audience"] } else { "0" }
    return Start-SlobsStream $title $cat $aud
  }
  if ($path -like "*/update/info*")  { return Get-UpdateInfo }
  if ($path -like "*/update/check*") { return Start-Updater "check" }
  if ($path -like "*/update/apply*") { return Start-Updater "apply" }
  if ($path -like "*/key/end*") {
    # There is no way to close a Streamlabs session over the API - the
    # tiktok/stream/end route answers every method except OPTIONS with 405.
    # TikTok closes the broadcast when the RTMP client disconnects, so the
    # dock ends a stream by stopping Aitum instead. Reported honestly rather
    # than the "ok" this route used to return while nothing happened.
    return @{ ok = $false; error = "Streamlabs has no end-session API. The broadcast closes when the RTMP client disconnects, so stop it in Aitum." }
  }
  return @{ ok = $false; error = "unknown helper route" }
}

while ($true) {
  try {
    # 1. accept new connections
    while ($listener.Pending()) {
      $tcp = $listener.AcceptTcpClient()
      $tcp.NoDelay = $true
      $client = @{ Tcp = $tcp; Stream = $tcp.GetStream(); Buf = (New-Object System.Collections.Generic.List[byte]); Open = $true; Name = "" }
      if (Complete-Handshake $client) {
        $clients.Add($client)
        Write-Log "client connected ($($clients.Count) total)"
      } else {
        try { $tcp.Close() } catch { }
      }
    }

    # 1b. the Streamlabs sign-in callback lands on its own throwaway port
    Pump-LoginCallback

    # 2. read + process existing clients
    for ($i = $clients.Count - 1; $i -ge 0; $i--) {
      $client = $clients[$i]
      if (-not $client.Tcp.Connected -or -not $client.Open) {
        try { $client.Tcp.Close() } catch { }
        $clients.RemoveAt($i)
        Write-Log "client disconnected ($($clients.Count) total)"
        continue
      }
      foreach ($text in (Drain-Frames $client)) {
        $msg = $null
        try { $msg = $text | ConvertFrom-Json } catch { }
        if (-not $msg) { continue }

        if ($msg.action -eq "sendChatbotMessage" -or $msg.event -or ($msg.data -and $msg.data.action -eq "sendChatbotMessage")) {
          # Accept BOTH the dock's bare {action,args} and a full Streamer.bot
          # event envelope {event:{...},data:{...}} - normalise to bare, then
          # re-wrap on the way out (TikFinity's Streamer.bot client only
          # processes messages that arrive wrapped in the event envelope).
          $inner = $msg
          if ($msg.data -and $msg.data.action) { $inner = $msg.data }
          if ($inner.action -ne "sendChatbotMessage") { continue }
          $out = [string]$inner.args.message
          if ([string]::IsNullOrWhiteSpace($out)) { continue }
          if ($out.Length -gt 300) { $out = $out.Substring(0, 300) }
          # Say who it went to, and say so BEFORE the send. The old line here
          # printed "chat -> TikFinity" no matter what happened next, so a
          # message with nowhere to go read exactly like one that landed.
          $recipients = 0
          foreach ($other in $clients) {
            if ($other -ne $client -and $other.Open) { $recipients++ }
          }
          Write-Log ("chat from dock (" + ($out | ConvertTo-Json -Compress) +
            ") - $recipients other client(s) connected")
          if ($recipients -eq 0) {
            Write-Log "  NOT RELAYED: nothing else is connected. TikFinity must connect as a Streamer.bot client (Settings > Integrations > Streamer.bot, 127.0.0.1 port $Port) - or it is not running."
          }
          # Full Streamer.bot broadcast-event envelope. TikFinity v2 checks
          # event.source=="General" && event.type=="Custom" and then reads
          # data.action=="sendChatbotMessage" / data.args.message.
          $relay = $utf8.GetBytes((ConvertTo-Json -InputObject @{
            event = @{ source = "General"; type = "Custom" }
            data  = @{ action = "sendChatbotMessage"; args = @{ message = $out } }
          } -Compress -Depth 5))
          $frame = New-Frame $relay 1
          $delivered = 0
          foreach ($other in $clients) {
            if ($other -ne $client) { if (Send-Frame $other $frame) { $delivered++ } }
          }
          # Ack back to whoever pressed send. The dock cannot otherwise tell
          # "handed to TikFinity" from "thrown away", and a local chat bar that
          # shrugs is how this stayed broken for so long.
          $ackWhy = ""
          if ($delivered -eq 0) {
            $ackWhy = "Nothing received it - TikFinity is not connected to the bridge. Turn on Settings > Integrations > Streamer.bot (127.0.0.1, port $Port) and restart its live connection."
          }
          $ack = $utf8.GetBytes((ConvertTo-Json -InputObject @{
            action = "chatAck"
            args   = @{ ok = ($delivered -gt 0); delivered = $delivered; error = $ackWhy }
          } -Compress -Depth 4))
          Send-Frame $client (New-Frame $ack 1) | Out-Null
        }
        elseif ($msg.id) {
          # Streamer.bot-compatible replies so TikFinity's Test Connection and
          # any request handshake it attempts are satisfied
          $reply = @{ status = "ok"; id = $msg.id }
          if ($msg.request -eq "GetInfo") {
            $reply.info = @{ name = "TikFinity Dock Chat Bridge"; version = "1.1.0"; os = "windows"; source = "websocketServer" }
          }
          if ($msg.request -eq "GetActions") { $reply.actions = @() }
          if ($msg.request -eq "GetEvents")  { $reply.events = @{ general = @("Custom") } }
          Send-Text $client ($reply | ConvertTo-Json -Compress -Depth 5) | Out-Null
        }
      }
    }
  } catch {
    Write-Log "loop error: $($_.Exception.Message)"
  }
  Start-Sleep -Milliseconds 30
}
