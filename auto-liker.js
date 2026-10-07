/*
 * TikFinity Dock — Like Engine (PC auto-liker, second account)
 * ------------------------------------------------------------
 * Drives your real Chrome/Edge, logged in as your SECOND TikTok
 * account, and taps Like on your own live stream at a slow,
 * randomized, human-ish cadence while your stream is live.
 *
 *   node auto-liker.js            → normal start (hidden browser)
 *   node auto-liker.js --login    → ONE-TIME visible login window:
 *                                   log in as account 2. It watches for
 *                                   the session cookie and says so, so
 *                                   there is nothing to press. Session
 *                                   is saved in .\like-engine-profile\
 *                                   (NEVER share that folder or push it
 *                                   to GitHub.)
 *
 * Control API (dock talks to this):
 *   GET  http://127.0.0.1:8787/status   → {"on":bool,"live":bool,"likes":n,...}
 *   POST http://127.0.0.1:8787/on       → start tapping
 *   POST http://127.0.0.1:8787/off      → stop tapping
 *
 * It discovers your live stream by listening to TikFinity's local API
 * (ws://localhost:21213) for roomUser/ liveStatusChange events, so it
 * never taps when you're offline.
 *
 * Risk note (be honest with yourself): this automates your second
 * account from the same IP as the stream. Keep the cadence slow, keep
 * using your phone auto-clicker too, and accept that automated liking
 * is against TikTok ToS — account 2 carries the risk.
 */

const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const PORT = 8787;
const PROFILE_DIR = path.join(__dirname, "like-engine-profile");
const LOG = path.join(__dirname, "like-engine.log");
// Whose stream to tap. Left blank on purpose: it is learned from TikFinity's
// own events (the anchor's chat messages carry their handle), so every creator
// gets their own. Set TF_STREAMER=@yourhandle to override or to pre-seed it.
let STREAMER = (process.env.TF_STREAMER || "").replace(/^@/, "");

let state = {
  // Which run of the engine this is. Two dock windows (feed + controls)
  // share ONE engine and both re-assert their own tick every poll, which
  // makes them alternate the engine off and on forever. The dock now only
  // pushes its intent when the engine is a DIFFERENT run than the one it
  // last spoke to, so the newest human decision is the one that sticks.
  startedAt: Date.now(),
  on: false,          // master switch (dock toggle)
  live: false,        // stream currently live (from 21213)
  tapping: false,     // on && live && browser ready
  likes: 0,           // taps actually delivered this session
  tapsFail: 0,        // click attempts that did not land
  tapTarget: "",      // which selector/page we were actually on
  lastError: "",
  loggedIn: false,
  // delay between taps — dock-tunable via POST /config
  speed: { minMs: 3000, maxMs: 8000 }
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// One place to learn whose stream to tap, from four possible sources:
//   - TF_STREAMER, set by the creator
//   - the last handle learned, saved next to the login profile so a reboot
//     does not leave the engine tapping nothing until the host chats
//   - the dock, which parses TikFinity far better than we can and pushes
//     the anchor's handle it already knows
//   - the events themselves, as a fallback for a dock that is not running
const HANDLE_FILE = path.join(__dirname, "like-streamer.txt");

function setStreamer(handle, source) {
  const h = String(handle || "").replace(/^@/, "").trim();
  if (!h || h === STREAMER) return false;
  STREAMER = h;
  log("streaming handle: " + h + " (from " + source + ")");
  try {
    fs.writeFileSync(HANDLE_FILE, h, "utf8");
  } catch { }
  // do not wait for the next tap tick to find out we can finally navigate
  if (page && !/\/@[^/]+\/live/.test(page.url() || "")) goLive().catch(() => {});
  return true;
}

// Read the handle saved by a previous run. like-streamer.txt is gitignored
// like the rest of this creator's own data.
try {
  if (!STREAMER && fs.existsSync(HANDLE_FILE)) {
    STREAMER = fs.readFileSync(HANDLE_FILE, "utf8").trim().replace(/^@/, "");
  }
} catch { }

function log(msg) {
  const line = `${new Date().toLocaleTimeString()} - ${msg}`;
  try { fs.appendFileSync(LOG, line + "\n"); } catch {}
  console.log(line);
}

/* ---------------- control API ---------------- */

function readBody(req) {
  return new Promise(resolve => {
    let b = "";
    req.on("data", d => { b += d; if (b.length > 4096) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  // CORS preflight: the dock's speed change POSTs JSON, and browsers
  // demand this exact answer — without it the POST never reaches us
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
    res.statusCode = 204;
    res.end();
    return;
  }
  const done = body => { res.end(JSON.stringify(body)); };
  if (req.url === "/status") return done(statusSnapshot());
  if (req.url === "/on" && req.method === "POST") {
    state.on = true; syncTapping(); log("ON (dock)");
    return done(statusSnapshot());
  }
  if (req.url === "/off" && req.method === "POST") {
    state.on = false; syncTapping(); log("OFF (dock)");
    return done(statusSnapshot());
  }
  if (req.url === "/config" && req.method === "POST") {
    const b = await readBody(req);
    const min = Number(b.minMs), max = Number(b.maxMs);
    let changed = false;
    if (Number.isFinite(min)) {
      const v = Math.max(250, Math.min(60000, min));
      if (v !== state.speed.minMs) { state.speed.minMs = v; changed = true; }
    }
    if (Number.isFinite(max)) {
      const v = Math.max(state.speed.minMs + 200, Math.min(120000, max));
      if (v !== state.speed.maxMs) { state.speed.maxMs = v; changed = true; }
    }
    // The dock sends the handle on every config push; only say something
    // when it is actually new, or the log fills with identical lines.
    if (b.streamer) setStreamer(String(b.streamer), "dock");
    if (changed) log(`speed set: ${(state.speed.minMs / 1000).toFixed(1)}-${(state.speed.maxMs / 1000).toFixed(1)}s between taps`);
    return done(statusSnapshot());
  }
  res.statusCode = 404; done({ error: "not found" });
});

function statusSnapshot() {
  const perMin = state.speed.maxMs > 0
    ? Math.round(60000 / ((state.speed.minMs + state.speed.maxMs) / 2)) : 0;
  return {
    startedAt: state.startedAt,
    on: state.on, live: state.live, tapping: state.tapping,
    likes: state.likes, tapsFail: state.tapsFail, tapTarget: state.tapTarget,
    loggedIn: state.loggedIn,
    error: state.lastError, streamer: STREAMER, port: PORT,
    speed: { ...state.speed }, perMin
  };
}

/* ---------------- stream liveness via TikFinity 21213 ---------------- */

function watchTikFinity() {
  let ws, retry;
  const connect = () => {
    try {
      ws = new WebSocket("ws://localhost:21213/");
      ws.on("open", () => log("listening to TikFinity 21213"));
      ws.on("message", raw => {
        let m; try { m = JSON.parse(raw.toString()); } catch { return; }
        const ev = typeof m.event === "string" ? m.event : (m.data && m.data.event) || "";
        if (ev === "liveStatusChange" || ev === "roomUser" || ev === "webcast/roomuser" || ev === "member") {
          const d = m.data && typeof m.data === "object" ? m.data : {};
          // Learn the broadcaster's handle from their own events. TikFinity
          // puts the anchor under d.userInfo.user / d.user / d.userDetails
          // depending on the event and version - the old code only looked at
          // the top level, so it never found it and the engine reported
          // "tapping" while tapping nothing at all.
          if (!STREAMER) {
            const u = d.userInfo && typeof d.userInfo === "object" ? d.userInfo : {};
            const anchor = (d.userIdentity && d.userIdentity.isAnchor) ||
                           u.isAnchor || (d.user && d.user.isAnchor) || false;
            const candidate =
              d.uniqueId || d.userId ||
              (u.user && (u.user.uniqueId || u.user.displayId)) || u.uniqueId ||
              (d.user && (d.user.uniqueId || d.user.displayId)) ||
              (d.userDetails && (d.userDetails.uniqueId ||
                (d.userDetails.user && (d.userDetails.user.uniqueId || d.userDetails.user.displayId))));
            // only the ANCHOR's handle counts: a viewer's roomUser event is
            // far more common than the host's and must never win
            if (candidate && (anchor || ev === "liveStatusChange")) {
              setStreamer(candidate, "events");
            }
          }
          // heuristic, mirrors the dock's own parser
          let live = state.live;
          if (ev === "liveStatusChange") {
            const st = d.status ?? d.liveStatus ?? d.state;
            live = st === undefined ? true : !(String(st).toLowerCase().includes("end") || String(st).toLowerCase().includes("off") || st === 0 || st === false);
          } else if (d.viewerCount != null || d.totalUser != null) {
            live = true;
          }
          if (live !== state.live) {
            state.live = live;
            log("stream " + (live ? "LIVE — will tap if ON" : "offline — pausing"));
            syncTapping();
          }
        }
      });
      ws.on("close", () => { state.live = false; syncTapping(); retry = setTimeout(connect, 5000); });
      ws.on("error", () => {});
    } catch { retry = setTimeout(connect, 5000); }
  };
  connect();
  return () => clearTimeout(retry);
}

/* ---------------- the browser driver ---------------- */

let browser = null;
let page = null;
let tapLoop = null;

async function launch() {
  if (browser) return;
  const exe = findChrome();
  if (!exe) throw new Error("Chrome/Edge not found — install Chrome or set CHROME_PATH");
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  // launchPersistentContext = cookies/session REALLY persist into
  // PROFILE_DIR, so --login is needed exactly once ever
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: exe,
    headless: !process.argv.includes("--login"),
    viewport: { width: 430, height: 760 },
    locale: "en-US",
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"]
  });
  browser = ctx;   // a persistent context IS the browser
  page = ctx.pages()[0] || await ctx.newPage();
  if (STREAMER) await goLive();
  else log("no handle yet — going live once tells me it (or set TF_STREAMER)");
  state.loggedIn = await hasLoginCookie(ctx);
  log(`browser up — loggedIn=${state.loggedIn} (use --login once if false)`);
}

// Open the broadcaster's live room, once we know who they are.
async function goLive() {
  await page.goto(`https://www.tiktok.com/@${STREAMER}/live`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || null;
}

async function hasLoginCookie(ctx) {
  const cookies = await ctx.cookies("https://www.tiktok.com");
  return cookies.some(c => c.name === "sessionid" || c.name === "sessionid_ss");
}

// TikTok changes the web live room's markup regularly, so try the known
// shapes in order and remember which one worked. A tick that finds none of
// them says so instead of quietly doing nothing - that silence is exactly
// how the engine looked broken for a week.
const LIKE_SELECTORS = [
  '[data-e2e="like-icon"]',
  '[data-e2e="browser-live-like-icon"]',
  '[data-e2e="live-like-icon"]',
  '[data-e2e="likeButton"]',
  'button[aria-label*="like" i]',
  '[role="button"][aria-label*="like" i]'
];

let workedSelector = null;      // learned once, reused
let reportedMissing = false;    // log the "not found" diagnosis only once

async function describePage() {
  // Evidence beats guessing: if every selector misses, say what the page
  // actually offers so the next fix is a one-line change.
  try {
    const e2es = await page.$$eval("[data-e2e]", els =>
      Array.from(new Set(els.map(e => e.getAttribute("data-e2e")))).slice(0, 25)).catch(() => []);
    return `url=${page.url()} data-e2e=[${e2es.join(",")}]`;
  } catch {
    return `url=${(page && page.url()) || "?"}`;
  }
}

async function tapLike() {
  if (!page) return false;
  const list = workedSelector ? [workedSelector, ...LIKE_SELECTORS] : LIKE_SELECTORS;
  for (const sel of list) {
    try {
      const btn = page.locator(sel).first();
      if (!(await btn.count())) continue;
      await btn.click({ timeout: 2500, force: true });
      if (workedSelector !== sel) {
        workedSelector = sel;
        log("like button found: " + sel);
      }
      return true;
    } catch (e) {
      state.lastError = String(e.message || e).slice(0, 160);
    }
  }
  // No button matched. The L key still works on web live when the player has
  // focus, but say plainly which situation we are in.
  if (!reportedMissing) {
    reportedMissing = true;
    log("no like button matched any selector - " + await describePage());
  }
  try { await page.keyboard.press("l"); return true; }
  catch (e) { state.lastError = String(e.message || e).slice(0, 160); return false; }
}

async function tapLoopTick() {
  if (!state.tapping) return;
  // The handle can arrive after the browser opened (first stream of the
  // session, or the dock pushing it a moment later) - make sure we are on
  // the live room before tapping.
  if (!STREAMER) {
    if (!state.lastError) {
      state.lastError = "waiting for the broadcaster's handle (set TF_STREAMER)";
    }
    scheduleNext();
    return;
  }
  const url = page.url();
  if (!/\/@[^/]+\/live/.test(url)) {
    await goLive();
    // give the room a moment to render before hunting for its buttons
    await sleep(2500);
  }
  const ok = await tapLike();
  if (ok) {
    state.likes++;
    state.lastError = "";
    if (state.likes === 1) log("first tap landed on " + STREAMER);
    // one line a minute is enough to tell "tapping" from "doing nothing"
    else if (state.likes % Math.max(1, Math.round(60000 / ((state.speed.minMs + state.speed.maxMs) / 2))) === 0) {
      log("taps so far: " + state.likes + " (" + state.tapsFail + " failed)");
    }
  } else {
    state.tapsFail++;
  }
  state.tapTarget = STREAMER;
  scheduleNext();
}

function scheduleNext() {
  // randomized gap between taps (dock-tunable); each tap also takes a
  // moment of real click time, so effective rate is slightly below this
  const next = state.speed.minMs + Math.random() * Math.max(200, state.speed.maxMs - state.speed.minMs);
  tapLoop = setTimeout(tapLoopTick, next);
}

function syncTapping() {
  const should = state.on && state.live;
  if (should && !state.tapping) {
    state.tapping = true;
    log("tapping STARTED" + (STREAMER ? " (@" + STREAMER + ")" : " - but NO HANDLE yet, nothing will be tapped"));
    tapLoopTick();
  } else if (!should && state.tapping) {
    state.tapping = false;
    clearTimeout(tapLoop);
    log("tapping STOPPED after " + state.likes + " taps");
  }
}

/* ---------------- login flow ---------------- */

async function loginFlow() {
  console.log("");
  console.log("  Logging in the SECOND TikTok account for the like engine");
  console.log("  ---------------------------------------------------");
  console.log("  A browser window is opening. Log in THERE as account 2.");
  console.log("  This console needs nothing from you - it watches for the");
  console.log("  login and saves it by itself. Leave this window open.");
  console.log("");
  await launch();
  await page.goto(`https://www.tiktok.com/login`, { waitUntil: "domcontentloaded" }).catch(() => {});

  // Watch for the session cookie instead of asking for an Enter keypress.
  // The whole work happens in the browser; a prompt sitting in a console
  // nobody is looking at is what made a successful login look like a
  // failed one. Enter still works for anyone who wants to confirm by hand.
  let pressedEnter = false;
  try { process.stdin.resume(); process.stdin.once("data", () => { pressedEnter = true; }); } catch { }

  const deadline = Date.now() + 5 * 60 * 1000;
  process.stdout.write("  waiting for the login");
  while (Date.now() < deadline && !pressedEnter) {
    if (await hasLoginCookie(browser).catch(() => false)) break;
    process.stdout.write(".");
    await sleep(2000);
  }
  process.stdout.write("\n");

  state.loggedIn = await hasLoginCookie(browser).catch(() => false);
  if (state.loggedIn) {
    console.log("");
    console.log("  LOGIN SAVED. You can close the browser window.");
    console.log("  It is stored in .\\like-engine-profile\\ - you never need");
    console.log("  --login again, and never share that folder.");
    console.log("");
    if (STREAMER) await goLive();
  } else {
    console.log("");
    console.log("  NO LOGIN DETECTED. Nothing was saved.");
    console.log("  Log in as account 2 in the browser window, then run");
    console.log("  SETUP.bat again (or: node auto-liker.js --login).");
    console.log("");
  }
  console.log("  The engine is now running. Keep this window open while");
  console.log("  streaming, and tick the toggle in the dock.\n");
  await pump();
}

/* ---------------- main ---------------- */

async function pump() {
  server.listen(PORT, "127.0.0.1", () => log(`control API on http://127.0.0.1:${PORT}`));
  watchTikFinity();
  if (!process.argv.includes("--login-only")) {
    await launch().catch(e => { state.lastError = e.message; log("launch failed: " + e.message); });
  }
  // keep alive
  setInterval(() => {}, 1 << 30);
}

if (process.argv.includes("--login")) loginFlow();
else pump().catch(e => { log("fatal: " + e.message); process.exit(1); });
