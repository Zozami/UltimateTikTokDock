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

## ⚡ Quick start

```bat
git clone https://github.com/Zozami/UltimateTikTokDock.git C:\TikFinity-Dock
cd C:\TikFinity-Dock
SETUP.bat
```

*(or download the ZIP, extract, double-click `SETUP.bat` — no admin rights)*

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

## 👍 Like engine (optional)

SETUP.bat offers it: logs a **second** TikTok account in on this PC and taps Like on your own stream while you're live — the PC version of a phone auto-clicker. Speed dial from Calm (~5/min) to Turbo (~75/min), randomized so it never looks mechanical.

> ⚠️ **Honest risk note:** automated liking breaks TikTok's ToS. Account 2 carries the risk — never your main.

## 📌 Good to know

- **Everything is manual by design.** Nothing connects or starts on its own — one click (Reconnect / Start stream) does the whole job.
- **Local only.** Settings live in your browser storage, the Streamlabs token is a gitignored file, and the repo ships zero personal data.
- **Chat sending rides TikFinity.** The dock's Event API is read-only; posting as you goes through TikFinity's own login — no cookies, no bot account.
- Not affiliated with TikTok or TikFinity.

## 📚 Docs & uninstall

Everything else — troubleshooting, chat-send internals, the Streamlabs API caveats — lives in **[SETUP.md](SETUP.md)**.
**Uninstall:** double-click `UNINSTALL.bat`. It removes everything it installed and never touches OBS, TikFinity or your accounts.
