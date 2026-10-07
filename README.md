# UltimateTikTokDock

A custom OBS dock for TikFinity that shows what actually matters while
you're live: chat, gifts, likes, follows, joins and viewer stats — in the
original dark palette, built to be read at a glance mid-stream.

It only LISTENS to TikFinity's local Event API (read-only). It cannot
break or change anything in TikFinity.

>>> Full setup guide with troubleshooting: see SETUP.md <<<

QUICK START (three steps, one file)
-----------------------------------
1. Copy this folder to  C:\TikFinity-Dock\  (any location works, but the
   OBS URL below is written for that one).
2. Double-click  SETUP.bat  ONE time.
   It installs everything, checks it, and prints the last clicks for you.
   Nothing needs admin rights. Safe to run again if something is missing.
3. In OBS: View > Docks > Custom Browser Docks...
   Name: TikFinity      URL: file:///C:/TikFinity-Dock/index.html

That is the whole install. Two clicks inside TikFinity (Streamer.bot
connection + chatbot toggle) are listed at the end of SETUP.bat's output.

REMOVING IT
-----------
Double-click  UNINSTALL.bat  once. It undoes everything SETUP.bat did:
removes both Startup-folder launchers, stops the chat bridge and the like
engine, and deletes the like engine's downloads, its logged-in TikTok
session folder, your Streamlabs token and the log files. It never touches
OBS, TikFinity or your settings - it tells you the two things only you can
undo. Use UNINSTALL.bat -KeepFiles to stop everything but keep the files.

Endpoint
--------
ws://localhost:21213/  (fallback ws://127.0.0.1:21213/)
TikFinity Desktop must be running on the same PC (TikFinity docs, "Event API").

OBS setup
---------
1. Keep this folder at C:\TikFinity-Dock\ (or move it and update the URL).
2. OBS > View > Docks > Custom Browser Docks...
3. Name: TikFinity   URL: file:///C:/TikFinity-Dock/index.html
4. Apply. Click Reconnect in the dock header whenever TikFinity Desktop starts.

Optional controls dock (recommended for wide layouts):
   Name: TikFinity Controls
   URL:  file:///C:/TikFinity-Dock/index.html?panel=controls
It puts every control (chat poll, gift alert, feed visibility, session
summary, demo/clear) in its own dock. Settings sync to the feed dock
instantly — start a poll there and it appears in the feed dock live.

Reconnect behaviour
-------------------
One automatic connection attempt when the dock loads, then nothing runs
in the background — no repeated retry spam. If it fails, click the
Reconnect button (or the status dot) whenever TikFinity Desktop is
running. Each attempt alternates between localhost and 127.0.0.1.

What you get
-------------
Twitch-style uncluttered chrome: a title, one status dot, one ⋮ button —
the rest is pure content.

- Status dot (red/gold/green). The dock tries to connect once when OBS
  opens; if TikFinity isn't running, a Reconnect button appears in the
  header — click it (or the dot) once TikFinity Desktop is up.
- Settings sheet (⋮): full-height panel with grouped sections — chat poll,
  feed visibility, leaderboards, gift alert, session summary (duration,
  peak viewers, likes, diamonds, followers gained, top gifters,
  copy-to-clipboard).
- Chat poll: viewers vote by typing 1/2/3 in chat; live tally bars above
  the feed; End & announce posts the winner as a feed row.
- Gift alert sounds: soft blip per gift, rising fanfare above your diamond
  threshold (dock-only audio, off switch included).
- Survives reloads: settings and session numbers restore after OBS restarts
  (expires 12h after the last event; Clear resets everything).
- One quiet stat line: viewers · likes · diamonds, with proper icons
  (no emoji anywhere — every icon is a crisp stroke icon). While the
  dock is connected to TikFinity the numbers read 0 rather than a dash,
  because counting has started and there is simply nothing to count yet.
- OBS numbers in the footer, right after "live": the same fps, bitrate
  and dropped-frames + percent that OBS prints on its own status bar,
  read live over the websocket. Green when nothing is being dropped,
  amber on the first dropped frame, red past 5%. Hover it for the
  frame totals. It hides itself entirely when OBS is not reachable —
  it never shows a made-up zero.
- Chat as real messages: avatar, colored name, MOD/SUB/HOST badges.
- Gifts: avatar, gift name, x-count, giver, diamond total, real gift
  artwork inline.
- Top gifters / Top likers leaderboards: up to 6 entries each in compact
  vertical lists, always fully visible (no scrolling). Rank 1/2/3 get
  gold/silver/bronze discs — crowns for gifters, hearts for likers —
  with the name and total (diamonds or likes). The ⋮ menu lets you show
  gifters only, likers only, or both.
- Feed rank chips: whoever is currently #1, #2 or #3 in diamonds wears a
  small crown next to their name on every row; the same goes for the top
  likers with a small heart. Ranks update automatically when someone
  overtakes them.
- One-line rows for likes, follows, joins, shares and subs.
- Reading mode: scroll up and the feed pauses; a pill shows how many events
  arrived while you read and resumes with one click.
- Click any nickname to copy it (handy for shoutouts); hover to see their
  follower count (@handle · 12.3K followers) — spot big accounts mid-stream.
- Followers gained: the Session panel shows "+N today" for this stream, and
  when the streamer crosses a round follower milestone (1K, 5K, 10K, 25K…)
  the feed posts a quiet "crossed 10,000 followers" row you can screenshot.
- Click a leaderboard pill to isolate that person: the feed shows only their
  events until you click the pill (or the X in the filter bar) again.
- Type in chat from the dock: the chat bar at the bottom sends messages to
  your TikTok chat AS YOUR ACCOUNT (via TikFinity's own login — no cookies,
  no bot account, nothing to install). See "Chat sending setup" below.
- Demo replay from the ⋮ menu lets you preview the dock without being live.

Chat sending setup (once ever)
-----------------------------
The dock cannot post to TikTok by itself (TikFinity's Event API is
read-only). It uses TikFinity's documented Streamer.bot connection instead.
No installs needed — the bridge is a PowerShell script, and Windows can
run it out of the box:

1. Double-click SETUP.bat ONE time (that is the only installer now — it
   does the bridge, the stream key token check and the like engine in one
   pass). It installs the chat bridge to
   start automatically with Windows (a hidden script in your Startup
   folder — no admin rights, nothing runs per-stream) and starts it now.
   If it is already installed from an older version, re-run SETUP.bat
   once to pick up the fixed bridge, then log out of Windows and back in
   (or end the old chat-bridge process in Task Manager) so the new one runs.
2. TikFinity Desktop: Settings -> Integrations -> Streamer.bot -> ENABLE
      IP 127.0.0.1   Port 8080   Endpoint /
   Then restart your live connection in TikFinity (stop + start the
   connection) so it connects to the bridge.
3. TikFinity Desktop: Chatbot must be ENABLED — messages are sent as
   chatbot messages through TikFinity's own TikTok login. This one is the
   easiest to get wrong and the hardest to diagnose: with the Chatbot OFF,
   TikFinity still accepts the message, relays it, and then drops it with
   only a toast saying "Streamer.bot sent a chat message, but your chatbot
   is switched off" — the message simply never appears in chat. The dock
   now reads TikFinity's own Chatbot toggle and refuses the send up front
   ("chatbot off in TikFinity"), so you cannot lose a message to this
   again. Your message is kept in the box, not thrown away.

That's it, forever: from then on, just add the dock in OBS and type in
the chat bar whenever TikFinity is open. Messages appear in your feed
instantly; if TikTok echoes them back, the dock hides the duplicate.
The dock also tells you when a message did NOT go out, instead of
quietly drawing it and losing it:
  - "You are not live, so there is no TikTok chat to post into" - TikTok
    only has a chat room while a broadcast is actually running.
  - "Nothing received it - TikFinity is not connected to the bridge" -
    the Streamer.bot integration in step 2 is off, or TikFinity needs
    its live connection restarted.
  - "TikFinity's Chatbot is switched off..." - step 3 above.
Troubleshooting: open chat-bridge.log next to this file. When you send
it now logs how many clients the message actually reached, e.g.
  chat from dock ("hello") - 2 other client(s) connected
0 clients means it went nowhere; 1 means only the other dock got it.

Uninstall: double-click UNINSTALL.bat (see "REMOVING IT" at the top).

Stream key (sign in with Streamlabs, no external app)
-----------------------------------------------------
TikTok only hands out OBS stream keys to established accounts, which
rules a lot of small streamers out of OBS. The Stream key section in the
dock gets you one anyway, by signing you in to Streamlabs from inside
the dock - no key-generator app, no token to copy. Keys are per-stream,
so press Start stream once per broadcast - it is deliberately never
automatic.

SETUP (once):
  1. Settings -> Stream key -> Connect... . That is the whole click -
     your normal browser opens on Streamlabs. Sign in with TikTok, and
     the browser lands back on a tiny "Signed in" page. The dock updates
     by itself: the dot goes green and Start stream lights up. The token
     is saved as slobs-token.txt next to chat-bridge.ps1 - gitignored,
     never share it. Nothing is typed into the dock and the token goes to
     Streamlabs and nowhere else.
  2. In OBS: Tools -> WebSocket Server -> tick "Enable WebSocket
     server", set a password (default port 4455). Put that port and
     password in the Stream key panel - the dock pushes the key to Aitum
     over it. Click-to-copy still works without any of this.

USING IT:
  1. Dock -> Settings -> Stream key -> Check account. It shows your
     username and whether TikTok will let you go live.
  2. Type a title, pick a category from the dropdown -> Start stream.
     That one button follows the session: it starts it, turns into
     "Title locked while live" once you are up, and End stream next to
     it only works while there is something to end.
     The title really cannot change mid-stream. Every Streamlabs
     stream/start mints a BRAND NEW broadcast, and there is no update
     route, so "updating the title" would start a second broadcast and
     leave the running output pushing the old key to nobody - which is
     what makes TikTok sit on "live will start shortly" forever. So the
     button says so instead, and keeps what you typed for next time.
  3. Start stream pushes the key into the Aitum vertical canvas by
     itself - there is no separate send button. Two ticks sit above it
     and each does one job on its own:
       "Start Aitum stream" presses Go Live in Aitum
         so TikTok starts receiving output.
       "Open TikFinity" opens the desk and attaches the chat bridge and
         the event API, so the broadcast has chat and events behind it
         without touching Reconnect.
     Tick both for the full one-button go-live. Tick only Aitum when you
     want the vertical stream up with nothing else attached, and only
     "Open TikFinity" when Aitum is already pushing. The desk tick waits
     for Aitum to actually report streaming before it opens, because
     TikFinity refuses to attach to a broadcast that is not arriving. If
     Aitum will not take the key the session stays live and the reason
     is printed under the fields, so you can still click Server and Key
     to copy them by hand. Both ticks remember themselves, so after a
     dock reload or an OBS restart you only press Start stream.
     After Go Live the dock does not take Aitum's word for it - that flag
     reads "streaming" straight through a push TikTok is refusing. It
     reads OBS's own log instead, and if the socket is being dropped it
     stops Aitum and retries once with a fresh broadcast. If that still
     fails it says so plainly rather than claiming a stream you cannot
     see.
  4. End stream stops the Aitum canvas and wipes the key off the screen.
     That stop is what actually closes the broadcast: Streamlabs has no
     end-session API (the route answers every method but OPTIONS with 405),
     so the broadcast ends when the RTMP client disconnects. Title and
     category are kept - they survive an End and a dock reload, and only
     clear when you clear them.

  This is Streamlabs' private API, the same one behind the tool you were
  using, so it can change without warning. If it ever breaks, only this
  section is affected - the rest of the dock is untouched.

Starting up — everything is manual, by design
-------------------------------------------
The dock NEVER connects or starts anything on its own. Not when OBS
opens, not after a connection drop, not when you go live. On load it
sits at "not started — click Reconnect".

One click does the whole job:
  1. the dock asks the chat bridge to start TikFinity Desktop
     (minimised) — a browser page can't spawn processes itself
  2. it keeps trying the Event API on port 21213 while the app boots
     (up to 90 seconds, showing "waiting for TikFinity…")
  3. it attaches to the chat bridge so chat sending works
If it can't reach TikFinity in that time, the Reconnect button comes
back and you can click it again.

Still one click you do yourself: "Connect to live" inside TikFinity.
That button calls a native function in TikFinity's own window which
nothing outside the app can trigger — verified against v2's code, its
local API only accepts toggles, actions, sounds, song requests, timers
and coin widgets. And the dock can't run without TikFinity at all: all
live data comes from the connection TikFinity makes with your
logged-in TikTok account.

Like engine (PC auto-liker, OPTIONAL — read the risk note)
----------------------------------------------------------
Automates your SECOND TikTok account on this PC to tap Like on your
own live stream while you're live (the PC version of a phone
auto-clicker). The dock's Settings -> Like engine toggle drives it;
tapping auto-starts when you go live and pauses when you end.

SETUP (once): it is all inside SETUP.bat — it asks whether you want the
like engine, installs the dependencies (needs Node.js from nodejs.org,
one-time, ~20 seconds), logs it in and sets it to autostart with Windows.
  1. Double-click SETUP.bat and answer Y to "Install the like engine now?"
  2. In the browser that opens, log in as account 2. The setup window
     waits by itself and prints "LOGIN SAVED" - there is nothing to press.
  3. In the dock: Settings -> Like engine -> tick the toggle. The header
     says "not running" if the engine is down, so a dead engine can never
     look like a tick that quietly does nothing.
  Manual alternative: node auto-liker.js --login, then node auto-liker.js
     Status shows "tapping" / "waiting for live" / likes sent.

WHOSE STREAM IT TAPS: the engine has to know your @handle to open your
live room. It learns it from the dock the first time you go live with
the dock open, then remembers it in like-streamer.txt (gitignored, no
personal data in the repo). To skip that entirely, set TF_STREAMER to
your handle before starting it.

WHEN IT SAYS "tapping" BUT NOTHING HAPPENS: it now says so in red
rather than clicking quietly at nothing. Two honest states:
  "tapping - no handle"  it does not know whose stream to tap yet.
  "Tapping is failing"   TikTok moved the like button and the engine
                          cannot find it. like-engine.log prints the page
                          it actually saw so it can be fixed in one line.
The first successful tap, and a running total every minute, are logged
too — check like-engine.log to confirm it is really working.

BOTH DOCKS: the feed and the controls window each have a copy of the
toggle but they share one engine. A tick in either window reaches the
other within 10 seconds, and an explicit click always wins.

SPEED: same section has a Speed dropdown —
     Calm ~5/min · Normal ~11/min · Fast ~29/min · Turbo ~75/min.
The gap between taps is randomized inside each range so it never
looks metronomic. Anything above Fast lights a warning: higher
rates = higher chance account 2 gets restricted.

RISK NOTE (honest): automated liking breaks TikTok's ToS. This runs
account 2 from the SAME IP as your stream with a browser fingerprint,
which is more detectable than your phone auto-clicker (real device,
mobile IP). The engine keeps cadence slow and randomized (one tap
every 3-8 s) to stay human-ish, but account 2 carries the risk —
never point it from your main account, and accept it could be
restricted. Keep using your phone clicker too; this is a supplement.

The login session lives in the like-engine-profile folder next to
these files. NEVER share that folder or push it to GitHub.

Uninstall: double-click UNINSTALL.bat - it removes the like engine's
launcher, its downloads and its logged-in browser session too.

Files: chat-bridge.ps1 is the bridge itself (logs to chat-bridge.log
next to it if anything goes wrong); SETUP.bat is the one installer a
creator ever runs, with setup.ps1 doing the work behind it.

Both docks can type (the controls dock has the same bar in its settings).
This is TikFinity's officially documented send path — nothing here touches
your TikTok password or session.

Data notes
----------
- Streakable gifts (giftType 1) count their diamonds once, when the streak
  ends (repeatEnd true) — one row per streak, not one per tick.
- Payloads verified live for chat, like, follow, member, roomUser, config,
  state_update. Gift/subscribe/share follow the documented
  TikTok-Live-Connector structure and render defensively if fields differ.
- Feed keeps the newest 250 items; totals and top-gifters are unaffected.
- Nothing is written to disk. Clear resets everything.
