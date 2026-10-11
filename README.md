# UltimateTikTokDock

**A custom OBS dock for TikTok LIVE** — chat, gifts, likes, leaderboards and stream control in one dark, glanceable panel. Built to be read mid-stream, not studied.

![Windows 10+](https://img.shields.io/badge/Windows-10%2B-blue?logo=windows&logoColor=white)
![OBS Studio](https://img.shields.io/badge/OBS%20Studio-28%2B-302E31?logo=obsstudio&logoColor=white)
![TikTok LIVE](https://img.shields.io/badge/TikTok-LIVE-black?logo=tiktok&logoColor=white)
![Data stays local](https://img.shields.io/badge/data-stays%20local-success)

It only **listens** to TikFinity's local API — it can't change or break anything in TikFinity, TikTok or OBS.

## ✨ What you get

| 👀 See everything | 🎮 Run the stream | ⚙️ Under the hood |
|---|---|---|
| Chat with avatars, badges, emotes | Chat bar → TikTok **as you** | One-click Streamlabs sign-in |
| Gifts with artwork + diamond totals | Title & category → **Start stream** | Pushes the key to Aitum vertical |
| Likes, follows, joins, shares | Start/stop Aitum from the dock | OBS status bar in the footer: fps · bitrate · dropped % |
| Top gifters / top likers boards | Gift alert sounds | Chat polls with live tally bars |
| Viewers · likes · diamonds stat line | Session summary + follower milestones | Survives OBS restarts, demo mode |
| One settings sheet, grouped by job | **Updates** panel: one click, no re-downloading | Keeps your tokens, logs and settings |

## ⚡ Quick start

```bat
git clone https://github.com/Zozami/UltimateTikTokDock.git C:\TikFinity-Dock
cd C:\TikFinity-Dock
SETUP.bat
```

*(or download the ZIP, extract, double-click `SETUP.bat` — no admin rights)*

That is the only download. After this, updates are **one click** — see below.

Add the docks in **OBS → View → Docks → Custom Browser Docks…**:

```
Feed:     file:///C:/TikFinity-Dock/index.html
Controls: file:///C:/TikFinity-Dock/index.html?panel=controls
```

## 🔌 TikFinity (two toggles, once)

TikFinity Desktop is the event source — the dock needs it running to show anything.

1. **Settings → Integrations → Streamer.bot → ON** · `127.0.0.1` · `8080` · `/`
2. **Setup → Chatbot → ON** — with it off, TikFinity accepts your chat messages and silently drops them. The dock reads this toggle and refuses the send up front instead.

## 🎬 Going live

1. **Stream key → Connect…** — one click, your browser opens, sign in with Streamlabs. No key-generator apps, nothing to copy.
2. Type a title, pick a category, hit **Start stream** — it pushes the key into the Aitum vertical canvas, waits until TikTok is *actually* receiving, then attaches TikFinity. One button, full go-live.
3. **End stream** stops Aitum and clears the key. Keys are per-stream, so it's deliberately never automatic.

## 🔄 Updating (no more re-downloading)

Once installed, the dock updates itself from this repo. Either:

- **In the dock:** Settings (⋮) → **Updates** → *Check for updates*, then **Install** — or
- **In the folder:** double-click **`UPDATE.bat`**.

The dock checks when it opens and puts a **green dot on the ⋮ button** when a new version is waiting, so you never have to go looking.

What an update touches, and what it does not:

| Replaced | Kept |
|---|---|
| The dock's own files (`app.js`, `style.css`, the bridge, the updater…) | `slobs-token.txt`, logs, `node_modules/`, `like-engine-profile/`, anything of your own |

It only ever writes files that exist in the new version — **nothing is deleted** — restarts the chat bridge for you, bumps the dock's cache numbers, and reloads the page. If you are live it warns you first, because the bridge restart interrupts chat sending for a few seconds.

> **Private repo?** If the folder is a **git clone**, no token is needed at all — the updater fetches over git, using the same credentials you push with. A folder downloaded as a ZIP has no `.git`, so it needs either a public repo or a read-only (Contents: read) token in `update-token.txt` next to `chat-bridge.ps1` (or the `TF_UPDATE_TOKEN` variable). That file is gitignored — never commit or share it.

Releasing an update is one line: bump `version.txt`, commit, and push. Everything else (cache-bust numbers, the bridge restart, the dock reload) happens on the installer's machine.

## 👍 Like engine (optional)

SETUP.bat offers it: logs a **second** TikTok account in on this PC and taps Like on your own stream while you're live — the PC version of a phone auto-clicker. Speed dial from Calm (~5/min) to Turbo (~75/min), randomized so it never looks mechanical.

> ⚠️ **Honest risk note:** automated liking breaks TikTok's ToS. Account 2 carries the risk — never your main.

## 📌 Good to know

- **Everything is manual by design.** Nothing connects or starts on its own — one click (Reconnect / Start stream) does the whole job.
- **Local only.** Settings live in your browser storage, the Streamlabs token is a gitignored file, and the repo ships zero personal data. The updater is the only thing that talks outward, and only to GitHub.
- **Chat sending rides TikFinity.** The dock's Event API is read-only; posting as you goes through TikFinity's own login — no cookies, no bot account.
- Not affiliated with TikTok or TikFinity.

## 📚 Docs & uninstall

Everything else — troubleshooting, chat-send internals, the Streamlabs API caveats — lives in **[SETUP.md](SETUP.md)**.
**Uninstall:** double-click `UNINSTALL.bat`. It removes everything it installed and never touches OBS, TikFinity or your accounts.
