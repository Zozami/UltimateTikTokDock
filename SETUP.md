# TikFinity Event Dock — Setup

A custom browser dock for OBS that shows TikTok LIVE activity (chat, gifts, likes, follows, leaderboards, goals and more) using **TikFinity Desktop** as the data source. No build step, no dependencies — just HTML/JS files.

---

## Quick start

1. **Download / copy this whole folder** anywhere on your PC — e.g. keep it at `C:\TikFinity-Dock\`.
2. **Double-click `SETUP.bat`** — one file, one time. It installs the chat bridge, checks your stream key token, offers to install the like engine, verifies everything, and prints the exact clicks left to do. No admin rights, safe to re-run.
3. **Open OBS** → menu **View → Docks → Custom Browser Docks…**
4. Fill in:
   - **Name:** `TikFinity`
   - **URL:** `file:///C:/TikFinity-Dock/index.html` (SETUP.bat prints the exact URL for your folder)
   - Click **Apply**. The dock appears in OBS.
5. **Open TikFinity Desktop** and go live on TikTok.
   - The dot in the dock's corner turns **green** and chat/gifts/likes/follows stream in.
   - If it stays red once you're live, click **Reconnect** in the dock header.

Skipping step 2 still works — you just get the read-only dock (no chat sending, no stream keys).

**Changed your mind?** Double-click `UNINSTALL.bat`. It removes both Startup launchers, stops the chat bridge and like engine, deletes the like engine's downloads, its logged-in TikTok session folder, your Streamlabs token and the logs — then tells you the two things only you can undo (uncheck the dock in OBS, clear the Streamer.bot settings in TikFinity). It never touches OBS or TikFinity itself, and never deletes the dock files: use `UNINSTALL.bat -KeepFiles` if you only want the processes stopped.

That's it — everything read-only works with zero further setup: live stats, leaderboards, chat feed, session panel.

**Optional second dock** (controls on a second monitor, recommended for wide layouts):
- Name: `TikFinity Controls` — URL: `file:///C:/TikFinity-Dock/index.html?panel=controls`
- It mirrors settings instantly (polls, goals, sounds) and has its own chat bar.

---

## Sending chat from the dock (one-time, ~3 minutes)

TikFinity's local Event API is **read-only** — a web page cannot send chat through it. TikFinity *can* send chat for you, through its documented Streamer.bot connection. This repo ships a tiny bridge script that speaks exactly that protocol. No cookies, no bot account, no installs — TikFinity's own login does the authenticating.

1. **Double-click `SETUP.bat`** (once, ever) — already done if you followed Quick start.
   - It copies a hidden auto-start launcher into your Windows Startup folder and starts the bridge immediately. It auto-starts with Windows from now on. No admin rights needed.
2. **TikFinity Desktop → Setup → Streamer.bot Connection:**
   - IP: `127.0.0.1`
   - Port: `8080`
   - Click **Test Connection** → should say connected.
3. **TikFinity Desktop → Chatbot:** tick **"Allow Streamer.bot to push messages to TikFinity"**.
4. **Verify:** type in the dock's chat bar and press Enter. The message appears in your dock feed and in your TikTok live chat as you.

> Requirements: Windows 10/11 (PowerShell is built in). No Node.js, nothing to install.

**Day to day:** nothing. Bridge auto-starts, dock auto-reconnects, TikFinity does the sending.

---

## What's in the box

| File | Purpose |
|---|---|
| `index.html`, `style.css`, `app.js` | The dock itself — the only files OBS loads |
| `chat-bridge.ps1` | The chat bridge (PowerShell, zero dependencies) |
| `SETUP.bat` | The one installer — double-click it. Runs `setup.ps1`, which installs the bridge, checks your stream key token, optionally installs the like engine, verifies everything and prints the remaining clicks |
| `UNINSTALL.bat` | The mirror image — double-click it to cleanly revert everything `SETUP.bat` installed |
| `README.md` | Short feature notes |

### Dock features

- **Live feed** — chat (with inline sub-emotes), gifts (real gift artwork, streak coalescing), likes, follows, joins, shares
- **At a glance** — viewers, total likes, diamonds earned
- **Top gifters / top likers** — clickable pills: click one to filter the feed to just that person
- **Goal bar** — progress toward a followers/likes/diamonds target (Settings → Goal bar)
- **Follower tooltips** — hover a username to see their follower count; click to copy the handle
- **Chat poll** — viewers vote by typing 1/2/3… in chat
- **Followers-gained counter + milestone celebrations** — automatic system rows at 1K/5K/10K… followers
- **Gift alert sounds** — soft blip for gifts, rising fanfare over your big-gift threshold
- **Session panel** — uptime, peak viewers, likes, diamonds, followers gained, top gifter; one-click copy summary
- **Settings sync** — both docks stay in sync automatically; state survives OBS restarts (12h)

---

## Connecting a Streamlabs account (only needed to go live from the dock)

Everything in the dock works without this — it only unlocks **Stream key → Start stream**.

1. In the dock: **Settings → Stream key → Connect…**. That is the whole click — your browser opens on Streamlabs straight away.
2. Sign in with TikTok (or with Streamlabs, if you already have it) and approve.
3. The browser lands on a small "Signed in" page — close it and go back to OBS. The dock has already updated by itself: the dot goes green, **Connected as @yourhandle**, and **Start stream** lights up.

There is no token to copy and no third-party app to install. The sign-in is a standard one-time-code exchange: Streamlabs sends your browser back to a throwaway port on this PC, the dock swaps that code for a token, and the token is saved as `slobs-token.txt` next to the dock (gitignored — never share it). It is sent to Streamlabs and nowhere else.

If your browser is blocked from opening, the button says so, hands you the address to paste in yourself, and reveals a field where you can paste a token you already have instead.

To switch accounts, or to sign out on a shared PC, press **Disconnect**. That only deletes the token from this machine; your Streamlabs and TikTok accounts are untouched.

---

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Header dot red / Reconnect button shows | TikFinity Desktop isn't running or you're not live yet. Open it, go live, click **Reconnect**. |
| Chat bar shakes, nothing sends | The bridge isn't running. Run `SETUP.bat` again, or check `chat-bridge.log` in this folder. |
| Bridge log says "cannot listen on port 8080" | Something else owns 8080 (e.g. real Streamer.bot). Settings (⋮) → **Chat sending** → change the port (e.g. 8090), then update TikFinity's Streamer.bot Connection port to match. |
| TikFinity "Test Connection" fails | Bridge not running (step 1 above), or wrong IP/port — must be exactly `127.0.0.1` + the dock's configured port. |
| Messages relay but never reach TikTok chat | The Chatbot toggle (step 3 above) is off, or you're not live. |
| Dock shows old features after updating files | OBS caches dock pages. Right-click the dock title → **Refresh**, or close/reopen the dock. Also make sure `index.html` points at the current `?v=` number for `app.js` / `style.css` — if you publish an update yourself, bump those two numbers so OBS cannot serve the previous cached copies. |
| Viewer count goes blank after pressing "Clear feed" | Fixed in v15+. If you still see it, your dock is running cached files — Refresh the dock. |
| "Start stream" says no token found | No account is connected. Use **Connect…** in the Stream key section instead of hand-editing files — it validates the token with Streamlabs before saving it. |
| Category dropdown shows nothing | You need at least 2 characters, and `chat-bridge.ps1` must be running (it asks TikTok's category list). Free-typing still works — the dropdown just makes the category exact. |
| "Start stream" is greyed out | No account is connected. Press **Connect…** in the Stream key section and paste your Streamlabs token — see "Connecting a Streamlabs account" below. |
| Want to change title/category while live? | You cannot, and that is TikTok's doing, not the dock's. Every Streamlabs `stream/start` mints a **brand new broadcast**, and there is no update route (all of them answer 405), so changing the title mid-stream would start a second broadcast and cut the first. The button says **Title locked while live** and your text is kept for the next stream. Press **End stream**, change it, press **Start stream**. |
| Start stream says **Aitum not updated** | OBS's WebSocket Server is off, or the password in the panel is wrong. Tools → WebSocket Server → enable it, set a password, and put that password (and port 4455) in the Stream key panel. The broadcast session is still live — click **Server** and **Key** to copy them by hand. |
| Aitum says the plugin isn't there, but it is | The plugin only registers its obs-websocket vendor requests if the websocket server was already loaded when OBS started. **Restart OBS once** (or toggle the plugin off/on in Extensions) and try again. |
| Vertical streaming with the **Aitum Vertical** plugin | That is what the dock pushes to. The plugin runs its own RTMP service for the 9:16 canvas with its own server + key, so OBS's main Stream settings are never touched. Aitum must be enabled in OBS → Extensions. |
| Stream key fails with an approval/eligibility error | That's TikTok's answer, not a dock bug — the account isn't allowed to broadcast yet. The **Check account** button shows the same status before you try. |
| Live page says **"live will start shortly"** and never plays | TikTok is refusing the broadcast: the RTMP socket connects and is then dropped, and OBS sits in a reconnect loop. The dock now reads OBS's own log to catch this and retries once with a fresh broadcast. If it still says that, press **End stream**, wait about a minute (so TikTok finalises the old one), then **Start stream**. A quick check is OBS's log: healthy pushing means one `Connection to … successful` line and no `Reconnecting in` after it. |
| Any Stream key button says **helper out of date** | The chat bridge is an older copy than the dock's files — normal after pulling an update, because the old bridge kept the port. Re-run **`SETUP.bat`**; it now detects the old build, swaps it out and restarts it. |
| Reconnect doesn't open TikFinity | The **chat bridge must be running** — the dock asks it to launch the app (a browser page can't start programs itself). Look at the footer line: if it says `chat bridge not running — run SETUP.bat`, that's the cause. Double-click `SETUP.bat` once more, then Reconnect. |
| Nothing happens when I open OBS | By design — the dock is manual now. Click **Reconnect** (or the header dot) and it starts TikFinity and connects. If the launch fails, check `chat-bridge.log`; if the exe moved, set the `TF_TIKFINITY_EXE` environment variable to its full path. |
| Clicked Reconnect but still "waiting for TikFinity…" | Give it a moment — the dock retries for 90s while TikFinity boots. If it never connects, start TikFinity yourself, click **Connect to live** in it, then click Reconnect again. |
| Want to undo chat sending | Delete `tikfinity-chat-bridge.vbs` from the Startup folder (Win+R → `shell:startup`) and close the `chat-bridge` PowerShell process. The dock keeps working read-only. |
| Dock shows events but you never clicked "Connect to live" | The dock can't do that for you — it's a native button inside TikFinity. You still click it once per stream; Reconnect only opens the app and attaches to it. |
| Like engine toggle does nothing | The engine isn't running. Start it (`node auto-liker.js`) and check its status line in Settings → Like engine shows "tapping" or "waiting for live". |
| Like engine stopped liking after I restarted the PC | Run `SETUP.bat` once so it starts with Windows (hidden). |

---

## Privacy / security

- The dock talks only to `localhost` — TikFinity's Event API on port 21213 and the chat bridge on 8080. Nothing leaves your PC except through TikFinity itself.
- The bridge listens only on `127.0.0.1`, stores no passwords, and holds no credentials. Sending is authenticated by *your own* TikFinity login, using TikFinity's officially documented Streamer.bot integration.
- Session data (counters, leaderboards, settings) lives in your browser's localStorage on your PC only.
