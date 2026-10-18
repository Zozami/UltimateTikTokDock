(() => {
  "use strict";

  // Controls dock mode: index.html?panel=controls turns the settings sheet
  // into a standalone OBS dock that drives the main feed dock.
  const CONTROLS = new URLSearchParams(location.search).get("panel") === "controls";
  if (CONTROLS) document.body.classList.add("controls");

  /* ------------------------------------------------------------------ *
   *  Config
   * ------------------------------------------------------------------ */

  const ENDPOINTS = ["ws://localhost:21213/", "ws://127.0.0.1:21213/"];
  const MAX_ITEMS = 2000;         // DOM nodes kept in the feed — high on purpose:
                                  // a whole session stays visible; safety cap only
                                  // (a 2000-row feed is still trivial for OBS CEF)

  const GROUPS = {
    gift:     new Set(["gift"]),
    chat:     new Set(["chat"]),
    like:     new Set(["like"]),
    follow:   new Set(["follow"]),
    social:   new Set(["social", "subscribe", "share"]),
    member:   new Set(["member"]),
    roomUser: new Set(["roomUser"])
  };

  const ICONS = {
    like: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    follow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg>',
    social: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
    member: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    roomUser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>',
    other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/></svg>',
    live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/></svg>',
    gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/></svg>',
    diamond: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12l4 6-10 12L2 9z"/><path d="M6 3l6 6 6-6M2 9h20M12 9v12"/></svg>'
  };

  /* rank icons worn by this session's top-3 (crowns = gifters, hearts = likers) */
  const crownSvg = c => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"><path d="M3 17l-1-9 5.5 4L12 5l4.5 7L22 8l-1 9z"/><path d="M4 21h16"/></svg>`;
  const heartSvg = c => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>`;
  const RANK_ICON = {
    gifter: { 1: crownSvg("#e8b54a"), 2: crownSvg("#9aa0a8"), 3: crownSvg("#a9683d"), muted: crownSvg("#5a5b63") },
    liker:  { 1: heartSvg("#ff6b85"), 2: heartSvg("#ff6b85"), 3: heartSvg("#ff6b85"), muted: heartSvg("#5a5b63") }
  };
  // the crown/heart icon alone identifies the board — no text needed
  const CAP_ICON = { gifters: crownSvg("currentColor"), likers: heartSvg("currentColor") };

  /* ------------------------------------------------------------------ *
   *  DOM
   * ------------------------------------------------------------------ */

  const feedEl     = document.getElementById("feed");
  const emptyEl    = document.getElementById("empty");
  const statusDot  = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const countEl    = document.getElementById("count");
  const demoInfo   = document.getElementById("demoInfo");
  const demoSep    = document.getElementById("demoSep");
  const obsStatsEl = document.getElementById("obsStats");
  const endpointEl = document.getElementById("endpoint");
  const tgEl       = document.getElementById("topGifters");
  const tlEl       = document.getElementById("topLikers");
  const pausePill  = document.getElementById("pausePill");

  const menuBtn  = document.getElementById("menuBtn");
  const sheetEl  = document.getElementById("sheet");
  const sheetClose = document.getElementById("sheetClose");
  const demoBtn  = document.getElementById("demoBtn");
  const clearBtn = document.getElementById("clearBtn");
  const retryBtn = document.getElementById("retryBtn");
  const pollStatusEl = document.getElementById("pollStatus");
  // Session is one button now, not six rows: the summary is built on demand
  // and the only thing left on screen is how long this session has run.
  const sessStatusEl = document.getElementById("sessStatus");
  const summaryText = document.getElementById("summaryText");
  const sessSay = document.getElementById("sessSay");
  const SESS_SAY = sessSay ? sessSay.textContent : "";

  const statViewers  = document.getElementById("statViewers");
  const statLikes    = document.getElementById("statLikes");
  const statDiamonds = document.getElementById("statDiamonds");

  const filterChecks = {
    gift:     document.getElementById("fGift"),
    chat:     document.getElementById("fChat"),
    like:     document.getElementById("fLike"),
    follow:   document.getElementById("fFollow"),
    social:   document.getElementById("fSocial"),
    member:   document.getElementById("fMember"),
    other:    document.getElementById("fOther")
  };

  const boardChecks = {
    gifters: document.getElementById("fBoardGifters"),
    likers:  document.getElementById("fBoardLikers")
  };

  const soundCheck = document.getElementById("fSound");
  const soundBigInput = document.getElementById("soundBig");
  const pollQ = document.getElementById("pollQ");
  const pollOpts = document.getElementById("pollOpts");
  const pollStartBtn = document.getElementById("pollStart");
  const pollEndBtn = document.getElementById("pollEnd");
  const pollBox = document.getElementById("pollBox");
  const userFilterBar = document.getElementById("userFilterBar");
  const userFilterNameEl = document.getElementById("userFilterName");
  const userFilterClear = document.getElementById("userFilterClear");

  const chatBar = document.getElementById("chatBar");
  const chatInput = document.getElementById("chatInput");
  const chatStatus = document.getElementById("chatStatus");
  const chatHint = document.getElementById("chatHint");
  const bridgePortInput = document.getElementById("bridgePort");

  const goalBarEl = document.getElementById("goalBar");
  const goalLabelEl = document.getElementById("goalLabel");
  const goalFillEl = document.getElementById("goalFill");
  const goalNumsEl = document.getElementById("goalNums");
  const goalStatusEl = document.getElementById("goalStatus");
  const goalOnCheck = document.getElementById("goalOn");
  const goalTypeSel = document.getElementById("goalType");
  const goalTargetInput = document.getElementById("goalTarget");
  const welcomeEl = document.getElementById("welcome");
  const welcomeCloseBtn = document.getElementById("welcomeClose");
  const bridgeRetryBtn = document.getElementById("bridgeRetry");
  const bridgeHint = document.getElementById("bridgeHint");
  const cDot = document.getElementById("cDot");

  // Updates
  const menuBadge = document.getElementById("menuBadge");
  const updStatusEl = document.getElementById("updStatus");
  const updCurrentEl = document.getElementById("updCurrent");
  const updLatestEl = document.getElementById("updLatest");
  const updLatestRow = document.getElementById("updLatestRow");
  const updCheckBtn = document.getElementById("updCheckBtn");
  const updApplyBtn = document.getElementById("updApplyBtn");
  const updAutoCheck = document.getElementById("updAuto");
  const updHintEl = document.getElementById("updHint");
  const updProblemEl = document.getElementById("updProblem");

  /* ------------------------------------------------------------------ *
   *  State
   * ------------------------------------------------------------------ */

  let socket = null;
  let endpointIndex = 0;
  let demoMode = false;
  let demoTimers = [];
  let demoViewers = 0;      // the heartbeat's current (fake) room size

  let itemCount = 0;
  let sessionTotal = 0;
  const filters = { gift: true, chat: true, like: true, follow: true, social: true, member: true, roomUser: true, other: true };

  let viewers = null;
  let totalLikes = null;
  let diamonds = 0;
  const gifterTotals = new Map();
  const likerTotals = new Map();     // uniqueId -> { name, likes }
  const rankByUser = new Map();      // uniqueId -> { rank } for feed chips
  const rankByLiker = new Map();     // uniqueId -> { rank } for feed chips
  const pendingStreaks = new Map();   // in-progress streakable gifts
  const boardShow = { gifters: true, likers: true };
  

  // Rapid-like coalescing window: same person's likes inside this many ms
  // grow one row instead of stacking rows (TikTok batches ~15 taps/event)
  const LIKE_MERGE_MS = 12000;
  const likeRows = new Map();   // uid -> { el, at, total, bursts }

  // true while a row is still in the top slice of the feed — deeper rows
  // are too far back to be "still visible", so those start a new row
  function nearTop(el) {
    let n = el, i = 0;
    while (n && n.previousElementSibling && i < 24) { n = n.previousElementSibling; i++; }
    return n === feedEl.firstElementChild;
  }
  let peakViewers = 0;
  let firstEventAt = 0;
  let lastEventAt = 0;       // newest event SINCE THIS PAGE LOADED — never
                             // restored, so it can't make an offline dock
                             // believe a stream just ended
  let paused = false;
  let pendingCount = 0;
  let lastLiveState = null;      // null | true | false — for liveStatusChange
  // Are we actually receiving from TikFinity? Once the socket is open the
  // audience numbers are being tracked, so a missing count means zero, not
  // "unknown" — otherwise viewers/likes sit on a dash all stream long.
  let tracking = false;
  // TikFinity's own Chatbot toggle, read from its state_update frame:
  // null = we have not been told yet (never block on that), true = on,
  // false = off, and a send would be silently dropped.
  let chatbotOn = null;

  // followers gained this session + streamer's own follower count (for
  // milestone celebrations)
  let followsGained = 0;
  let streamerFollowers = 0;
  let milestoneHit = 0;          // highest milestone already announced
  let streamerName = "";
  let streamerAvatar = "";        // the streamer's own pfp, from anchor events —
                                  // reused for optimistic rows of sent messages
  const MILESTONES = [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];

  // click-a-pill filter: when set, the feed shows only that person's events
  let userFilter = null;         // { uid, name } or null

  // chat sending: the dock talks to a tiny local bridge (chat-bridge.js) that
  // TikFinity also connects to; TikFinity relays our messages to TikTok chat
  let bridgePort = 8080;
  let bridgeSocket = null;

  // like engine: PC auto-liker (auto-liker.js) exposing a local control API
  // on :8787. ONE button starts and stops it, so the control shows which state
  // it is in; it stays disabled until the stream is really live, because a like
  // control only exists on a live room. Nothing auto-starts any more: the
  // engine still stops itself when the stream ends, which is the guard that
  // matters, but starting is a deliberate press.
  const LIKE_PORT = 8787;
  let likePoll = null;
  // The tap cadence is NOT a dock setting any more: auto-liker.js owns it, at
  // about 2 taps a second. The dock asks for nothing and reads the real figure
  // back from /status (perMin), so the two can never disagree. The presets and
  // the /config speed push that used to live here are what left the engine at
  // one tap per 15 seconds when a saved preset went stale.
  let likeConfigPushed = false;   // engine already has our handle
  const likeToggleBtn = document.getElementById("likeToggle");
  const likeStatusEl = document.getElementById("likeStatus");
  const likeHint = document.getElementById("likeHint");

  // goal bar: a progress strip in the top panel (followers gained / likes /
  // diamonds vs a target). Toggleable; synced across docks like other settings.
  const goal = { on: true, type: "followers", target: 500 };

  // first-run: the welcome card shows once, ever, until dismissed
  let welcomed = false;
  let bridgeState = "bad";       // ok | busy | bad
  let updAuto = true;            // check GitHub when the dock opens
  let bridgeTimer = null;
  let streamerUid = "";          // set from anchor events, used to dedupe echoes
  const recentOwnSends = new Map();  // text -> timestamp, kills TikTok echo dupes

  /* ------------------------------------------------------------------ *
   *  Persistence — survive OBS dock reloads (settings + session numbers)
   *  Restored on boot; Clear wipes it; live for 12h after last event.
   * ------------------------------------------------------------------ */

  const LS_KEY = "tikfinity-dock-v1";
  const LS_TTL = 12 * 60 * 60 * 1000;   // 12h

  function saveState() {
    try {
      const prev = (() => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { return null; } })();
      localStorage.setItem(LS_KEY, JSON.stringify({
        t: Date.now(),
        // session numbers belong to the feed dock; the controls dock must
        // not clobber them with its own (possibly empty) counters
        settings: {
          filters: { ...filters },
          boardShow: { ...boardShow },
          soundOn: soundOn,
          soundBig: soundBig,
          bridgePort: bridgePort,
          goal: { ...goal },
          welcomed,
          updAuto,
        },
        // session numbers belong to the feed dock; the controls dock must
        // not clobber them with its own (possibly empty) counters
        session: CONTROLS ? (prev && prev.session) || undefined : {
          diamonds,
          totalLikes,
          viewers,
          firstEventAt,
          peakViewers,
          followsGained,
          streamerFollowers,
          milestoneHit,
          streamerName,
          // NOTE: streamerUid is deliberately NOT saved. It is the handle the
          // like engine taps, and a demo replay (or a mistyped run) must not be
          // able to survive a restart as "who you are". The dock now only ever
          // tells the engine about a handle the real connector announced while
          // this page was open.
          gifterTotals: [...gifterTotals],
          likerTotals: [...likerTotals]
        }
      }));
    } catch { /* storage full/blocked — never break the dock over this */ }
  }

  function restoreState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s || Date.now() - s.t > LS_TTL) { localStorage.removeItem(LS_KEY); return; }
      if (s.settings) {
        Object.assign(filters, s.settings.filters || {});
        Object.assign(boardShow, s.settings.boardShow || {});
        if (typeof s.settings.soundOn === "boolean") soundOn = s.settings.soundOn;
        if (Number.isFinite(+s.settings.soundBig)) soundBig = +s.settings.soundBig;
        if (Number.isFinite(+s.settings.bridgePort)) bridgePort = Math.max(1, Math.floor(+s.settings.bridgePort));
        if (s.settings.goal && typeof s.settings.goal === "object") {
          if (typeof s.settings.goal.on === "boolean") goal.on = s.settings.goal.on;
          if (s.settings.goal.type === "followers" || s.settings.goal.type === "likes" || s.settings.goal.type === "diamonds") goal.type = s.settings.goal.type;
          if (Number.isFinite(+s.settings.goal.target) && +s.settings.goal.target >= 1) goal.target = Math.floor(+s.settings.goal.target);
        }
        if (typeof s.settings.welcomed === "boolean") welcomed = s.settings.welcomed;
        if (typeof s.settings.updAuto === "boolean") updAuto = s.settings.updAuto;

        if (Array.isArray(s.settings.filters)) { filters.clear(); s.settings.filters.forEach(x => filters.add(x)); }
        // NOTE: sheet-accordion state (which sections are expanded) is
        // deliberately NOT persisted — every load starts fully collapsed.
      }
      if (s.session) {
        if (Number.isFinite(s.session.diamonds)) diamonds = s.session.diamonds;
        if (Number.isFinite(s.session.totalLikes)) totalLikes = s.session.totalLikes;
        if (Number.isFinite(s.session.viewers)) viewers = s.session.viewers;
        if (Number.isFinite(s.session.firstEventAt)) firstEventAt = s.session.firstEventAt;
        if (Number.isFinite(s.session.peakViewers)) peakViewers = s.session.peakViewers;
        if (Number.isFinite(s.session.followsGained)) followsGained = s.session.followsGained;
        if (Number.isFinite(s.session.streamerFollowers)) streamerFollowers = s.session.streamerFollowers;
        if (Number.isFinite(s.session.milestoneHit)) milestoneHit = s.session.milestoneHit;
        if (typeof s.session.streamerName === "string") streamerName = s.session.streamerName;
        for (const [k, v] of s.session.gifterTotals || []) gifterTotals.set(k, v);
        for (const [k, v] of s.session.likerTotals || []) likerTotals.set(k, v);
      }
    } catch { /* corrupt blob — start fresh */ }
  }

  // Debounced save: bursts of events shouldn't hammer localStorage
  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; saveState(); }, 1000);
  }

  /* ------------------------------------------------------------------ *
   *  Sound pings — WebAudio, generated locally, zero files, dock-only
   *  (they play inside this browser instance; OBS captures dock audio
   *  only if the user routes it — default is operator-only)
   * ------------------------------------------------------------------ */

  let soundOn = true;
  let soundBig = 99;
  let audioCtx = null;

  // Lazily create the AudioContext inside a user gesture (menu open) so the
  // browser's autoplay policy doesn't block later gift pings.
  function ensureAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch { /* audio unavailable — pings silently disabled */ }
  }

  function ping(freqs, ms = 140, vol = 0.06) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const t0 = audioCtx.currentTime;
      freqs.forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        g.gain.setValueAtTime(0, t0 + i * ms / 1000);
        g.gain.linearRampToValueAtTime(vol, t0 + i * ms / 1000 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * ms / 1000 + ms / 1000);
        o.connect(g).connect(audioCtx.destination);
        o.start(t0 + i * ms / 1000);
        o.stop(t0 + i * ms / 1000 + ms / 1000 + 0.05);
      });
    } catch { /* no audio ctx — ignore */ }
  }

  const pingSmallGift = () => ping([880]);                      // soft blip
  const pingBigGift = () => ping([660, 880, 1320], 110, 0.09);  // rising fanfare

  /* ------------------------------------------------------------------ *
   *  Chat poll — viewers vote by typing 1/2/3 in chat
   * ------------------------------------------------------------------ */

  const poll = { active: false, q: "", opts: [], votes: new Map() };

  function pollStart() {
    const q = pollQ.value.trim();
    const opts = pollOpts.value.split(",").map(s => s.trim()).filter(Boolean).slice(0, 6);
    if (!q || opts.length < 2) {
      pollOpts.classList.add("bad");
      setTimeout(() => pollOpts.classList.remove("bad"), 1200);
      return;
    }
    pollQ.value = "";
    pollOpts.value = "";
    beginPoll(q, opts);
    sendCmd({ type: "poll_start", q, opts });   // reach the other dock, if open
  }

  function beginPoll(q, opts) {
    poll.active = true;
    poll.q = q;
    poll.opts = opts;
    poll.votes.clear();
    renderPoll();
    renderPollMenuState();
  }

  function pollEnd(announce = true, broadcast = true) {
    if (!poll.active && !pollBox.hidden) { pollBox.hidden = true; return; }
    poll.active = false;
    if (announce && poll.opts.length) {
      const counts = poll.opts.map((o, i) => ({ o, n: countVotes(i + 1) }));
      const top = Math.max(...counts.map(c => c.n));
      const winners = counts.filter(c => c.n === top && top > 0).map(c => c.o);
      // A poll nobody voted in has no winner, so "→ (0 votes)" was a dangling
      // arrow announcing nothing. It says what actually happened instead.
      addEvent("system", {
        message: top
          ? `Poll result — ${isoRtl(poll.q)} → ${winners.map(isoRtl).join(" / ")} (${top} vote${top === 1 ? "" : "s"})`
          : `Poll closed with no votes — ${isoRtl(poll.q)}`
      }, true);
    }
    poll.opts = [];
    poll.q = "";
    poll.votes.clear();
    pollBox.hidden = true;
    renderPollMenuState();
    if (broadcast) sendCmd({ type: "poll_end" });   // reach the other dock, if open
  }

  function countVotes(optIdx) {
    let n = 0;
    for (const v of poll.votes.values()) if (v === optIdx) n++;
    return n;
  }

  function pollHandleChat(d, comment) {
    if (!poll.active) return;
    const uid = pick(d, "uniqueId") || pick(d, "userId");
    if (!uid) return;
    const m = /^\s*([1-9])\s*$/.exec(comment);
    if (!m) return;
    const opt = parseInt(m[1], 10);
    if (opt > poll.opts.length) return;
    poll.votes.set(String(uid), opt);   // one vote per viewer, latest wins
    renderPoll();
  }

  function renderPoll() {
    if (!poll.active) return;
    pollBox.hidden = false;
    const total = poll.votes.size;
    const counts = poll.opts.map((o, i) => ({ o, n: countVotes(i + 1) }));
    const max = Math.max(1, ...counts.map(c => c.n));
    pollBox.innerHTML = `
      <div class="pollQ">${esc(poll.q)}</div>
      ${counts.map((c, i) => `
        <div class="pollRow">
          <span class="pollLabel"><b>${i + 1}</b> ${esc(c.o)}</span>
          <span class="pollBar"><i style="width:${Math.round((c.n / max) * 100)}%"></i></span>
          <span class="pollN">${c.n}</span>
        </div>`).join("")}
      <div class="pollMeta">${total} vote${total === 1 ? "" : "s"} · type 1–${poll.opts.length} in chat</div>`;
    renderPollMenuState();
  }

  function renderPollMenuState() {
    pollQ.disabled = poll.active;
    pollOpts.disabled = poll.active;
    pollStartBtn.disabled = poll.active;
    pollEndBtn.disabled = !poll.active;
    pollStatusEl.textContent = poll.active
      ? `Running · ${poll.votes.size} vote${poll.votes.size === 1 ? "" : "s"}`
      : "";
  }

  /* ------------------------------------------------------------------ *
   *  Small helpers
   * ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ *
   *  Small helpers
   * ------------------------------------------------------------------ */

  function groupOf(eventName) {
    for (const [group, set] of Object.entries(GROUPS)) {
      if (set.has(eventName)) return group;
    }
    return "other";
  }

  function fmtNum(n) {
    return Number(n).toLocaleString("en-US");
  }

  // Compact follower counts for tooltips: 12345 -> "12.3K", 1200000 -> "1.2M"
  function fmtCompact(n) {
    n = Number(n);
    if (!isFinite(n) || n < 0) return "?";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  // liveStatusChange payloads vary; decide live vs ended from whatever field
  // carries the state. UNKNOWN shapes return null on purpose — guessing
  // "went live" here produced a bogus row for a payload we simply didn't
  // understand. When in doubt we say nothing rather than lie.
  function liveStatusOf(d) {
    const st = pick(d, "status", "liveStatus", "state", "live");
    if (st === undefined || st === null || st === "") return null;
    if (typeof st === "boolean") return st;
    if (typeof st === "number") {
      if (st === 0 || st === 2 || st === 4) return false;
      if (st === 1 || st === 3) return true;
      return null;
    }
    const s = String(st).toLowerCase();
    if (s.includes("end") || s.includes("off") || s.includes("close") || s === "0" || s === "false") return false;
    if (s.includes("live") || s === "1" || s === "true") return true;
    return null;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* Some text has to stay one plain string — a feed row's message, which is
     stored, searched and copied as text, so it cannot hold elements the way a
     name can hold <bdi>. A handle or a poll question typed in Arabic carries
     its own direction into the digits and dashes beside it, and the sentence
     reads as if the dock mis-counted. Pinching just that value between an FSI
     and a PDI keeps it a single run and leaves the rest of the line in order.

     Applied only when the value really holds right-to-left script, so ordinary
     ASCII text never picks up invisible characters. */
  const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
  function isoRtl(s) {
    const v = String(s);
    return RTL_RE.test(v) ? "\u2068" + v + "\u2069" : v;
  }

  /* Emotes: subscriber chat carries an emoteList[] of {position/emojiPlace,
     imageUrl…} — TikFinity gives us the text AND the sticker images. We
     splice the images inline at their positions so chat looks like real
     TikTok chat. Every shape the connector family uses is covered. */
  const emoteCache = new Map();   // imageUrl -> true once confirmed loading

  function emoteImg(url, alts) {
    if (!url || typeof url !== "string") return "";
    return `<img class="emote" src="${esc(url)}"${alts && alts.length ? ` data-urls="${esc(alts.join("|"))}"` : ""} alt="" referrerpolicy="no-referrer" title="emote">`;
  }

  // Every https URL anywhere inside the emote entry — connector shapes vary
  // (imageUrl, emote.imageUrl, imageSizes[].url, …), and signed CDN URLs can
  // 403, so we keep ALL of them as an error-fallback chain.
  function emoteCandidates(e) {
    const urls = [];
    // https in the wild; data: only ever in demo mode (so the demo can
    // exercise the real emote-splice path without a network)
    const add = u => { if (typeof u === "string" && (/^(https?|data):/.test(u)) && !urls.includes(u)) urls.push(u); };
    const walk = obj => {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) { obj.forEach(walk); return; }
      for (const v of Object.values(obj)) {
        if (typeof v === "string") add(v);
        else walk(v);
      }
    };
    walk(e);
    return urls;
  }

  function emoteListImages(d) {
    const out = [];
    const list = Array.isArray(d.emoteList) ? d.emoteList : [];
    for (const e of list) {
      if (!e || typeof e !== "object") continue;
      emoteCandidates(e).forEach(u => { if (!out.includes(u)) out.push(u); });
    }
    return out;
  }

  // Rebuild a chat message with emote images spliced in. emoteList entries
  // either carry the character position of the emote in the comment, or just
  // appear in order — we handle both, plus plain fallback if positions clash.
  function chatHtmlWithEmotes(d, text) {
    const urls = emoteListImages(d);
    if (!urls.length || !text) return esc(text);

    // collect {pos, urls} using whatever position fields exist
    const list = Array.isArray(d.emoteList) ? d.emoteList : [];
    const marks = [];
    for (const e of list) {
      if (!e || typeof e !== "object") continue;
      const urls = emoteCandidates(e);
      if (!urls.length) continue;
      let pos = null;
      for (const k of ["position", "emojiPlace", "place", "index", "start"]) {
        const v = Number(e[k]);
        if (Number.isFinite(v) && v >= 0) { pos = v; break; }
      }
      marks.push({ pos, urls });
    }
    if (!marks.length) return esc(text);

    // positions known: splice by index into the string (code-point safe enough
    // for this use; positions refer to UTF-16 indexes in TikTok payloads)
    if (marks.every(m => m.pos != null)) {
      marks.sort((a, b) => a.pos - b.pos);
      let html = "";
      let at = 0;
      for (const m of marks) {
        if (m.pos > text.length) return esc(text) + marks.map(x => emoteImg(x.urls[0], x.urls.slice(1))).join(""); // bogus positions → append
        html += esc(text.slice(at, m.pos)) + emoteImg(m.urls[0], m.urls.slice(1));
        at = m.pos + 1;          // the emote replaces one character in the text
      }
      return html + esc(text.slice(at));
    }
    // no positions: append stickers after the text (still better than dropping)
    return esc(text) + marks.map(m => emoteImg(m.urls[0], m.urls.slice(1))).join("");
  }

  function pick(obj, ...keys) {
    for (const k of keys) {
      if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
    }
    return undefined;
  }

  function deepPick(obj, ...paths) {
    for (const p of paths) {
      let cur = obj;
      let ok = true;
      for (const seg of p) {
        if (cur && typeof cur === "object" && cur[seg] !== undefined && cur[seg] !== null && cur[seg] !== "") {
          cur = cur[seg];
        } else { ok = false; break; }
      }
      if (ok) return cur;
    }
    return undefined;
  }

  // Header state text — spells out what the dot colour means, whenever the
  // dock is wide enough to show it (CSS hides it below 300px).
  const DOT_TEXT = {
    disconnected: "Not connected",
    connecting: "Connecting…",
    connected: "Connected",
    demo: "Demo"
  };

  function setDot(mode, tooltip) {
    statusDot.className = `dot ${mode}`;
    statusDot.title = tooltip;
    cDot.className = `dot ${mode}`;
    cDot.title = tooltip;
    // connected + stream actually live reads better as "Live"
    const label = (mode === "connected" && lastLiveState === true) ? "Live" : (DOT_TEXT[mode] || "");
    statusText.textContent = label;
    statusText.className = `statusText t-${mode}`;
    // The one place that knows we are attached to TikFinity. Viewers/likes
    // switch from "–" (nothing is counting) to 0 (counting, nothing yet).
    const nowTracking = mode === "connected";
    if (nowTracking !== tracking) { tracking = nowTracking; updateHud(); }
  }

  function textOf(d) {
    return pick(d, "nickname", "uniqueId", "userId") || "Unknown";
  }

  // An OBS browser dock is a CEF page on file://, where navigator.clipboard
  // is frequently blocked outright - and a streamer who cannot copy the
  // stream key is stuck. So try the modern API first, fall back to the old
  // synchronous textarea trick, and only give up if both fail.
  // Split out from copyText because not every caller has a button to flash:
  // the session summary is its own copy target and reports through a hint.
  function writeClipboard(text) {
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch (e) {
        return false;
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => fallback());
    }
    return Promise.resolve(fallback());
  }

  function copyText(text, btn, restore) {
    const prev = btn ? btn.textContent : "";
    writeClipboard(text).then(ok => {
      if (!btn) return;
      btn.textContent = ok ? "✓" : "✗";
      setTimeout(() => { btn.textContent = restore || prev; }, 800);
    });
  }

  const initialCache = new Map();
  function initialOf(name) {
    let letter = initialCache.get(name);
    if (letter === undefined) {
      letter = [...String(name).trim().toUpperCase()][0] || "?";
      initialCache.set(name, letter);
    }
    return esc(letter);
  }

  /* ------------------------------------------------------------------ *
   *  Restore saved settings/session BEFORE first render
   * ------------------------------------------------------------------ */
  restoreState();

  /* ------------------------------------------------------------------ *
   *  Media slot — avatar, event icon, or REAL gift image
   * ------------------------------------------------------------------ */

  function avatarMedia(d, name) {
    // TikTok sends several CDN mirrors for every avatar:
    // profilePictureUrl + userDetails.profilePictureUrls[]
    const urls = [];
    const first = pick(d, "profilePictureUrl");
    if (first) urls.push(first);
    if (d.userDetails && Array.isArray(d.userDetails.profilePictureUrls)) {
      for (const u of d.userDetails.profilePictureUrls) {
        if (u && !urls.includes(u)) urls.push(u);
      }
    }
    if (urls.length) {
      return `<img src="${esc(urls[0])}" data-urls="${esc(urls.slice(1).join("|"))}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
    }
    return `<span class="m-avatar">${initialOf(name)}</span>`;
  }

  // Gift image candidates, in priority order (per TikTok-Live-Connector docs
  // that TikFinity mirrors):
  //   1. giftPictureUrl            — top level, documented, always present
  //   2. giftImage.giftImageurlList[] / .url — newer connector shape
  //   3. giftDetails.giftImage…    — alternate nesting
  //   4. extendedGiftInfo.gift_image_url / .image — legacy extended info
  const giftImageCache = new Map();   // giftId -> [urls]

  function giftImageUrls(d) {
    const id = pick(d, "giftId");
    if (id && giftImageCache.has(id)) return giftImageCache.get(id);

    const urls = [];
    const add = u => { if (typeof u === "string" && u && !urls.includes(u)) urls.push(u); };
    add(pick(d, "giftPictureUrl"));
    add(deepPick(d, ["giftImage", "url"]));
    const list1 = deepPick(d, ["giftImage", "giftImageurlList"]);
    if (Array.isArray(list1)) list1.forEach(add);
    add(deepPick(d, ["giftDetails", "giftImage", "url"]));
    const list2 = deepPick(d, ["giftDetails", "giftImage", "giftImageurlList"]);
    if (Array.isArray(list2)) list2.forEach(add);
    add(deepPick(d, ["extendedGiftInfo", "gift_image_url"]));
    add(deepPick(d, ["extendedGiftInfo", "image"]));
    add(deepPick(d, ["giftDetails", "extendedGiftInfo", "gift_image_url"]));

    if (id) giftImageCache.set(id, urls);
    return urls;
  }

  function giftMedia(d) {
    const urls = giftImageUrls(d);
    if (urls.length) {
      return `<img class="gifto" src="${esc(urls[0])}" data-urls="${esc(urls.slice(1).join("|"))}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
    }
    return `<span class="gifto"><i class="i gift">${ICONS.gift}</i></span>`;
  }

  // Image load failures walk a candidate list (CDN mirrors) before giving up:
  // gift art → gift icon inline, avatars → initial letter.
  feedEl.addEventListener("error", e => {
    const img = e.target;
    if (!img || img.tagName !== "IMG") return;

    const rest = (img.dataset.urls || "").split("|").filter(Boolean);
    if (rest.length) {
      img.dataset.urls = rest.slice(1).join("|");
      img.src = rest[0];
      return;
    }

    if (img.classList.contains("gifto")) {
      // inline gift art failed entirely → neutral gift glyph
      img.outerHTML = `<span class="gifto"><i class="i gift">${ICONS.gift}</i></span>`;
      return;
    }

    if (img.classList.contains("emote")) {
      // emote sticker failed → remove it quietly; a console trail stays for
      // diagnosing CDN problems on live streams
      console.warn("[dock] emote image failed to load:", img.src);
      img.remove();
      return;
    }

    const media = img.parentElement;
    if (media && media.classList.contains("media")) {
      media.innerHTML = `<span class="m-avatar">${initialOf(media.dataset.name || "?")}</span>`;
    }
  }, true);

  /* ------------------------------------------------------------------ *
   *  Unified item builder — same anatomy for every event type
   * ------------------------------------------------------------------ */

  function buildItem({ group, mediaClass, mediaHtml, who, what, giftD }) {
    const item = document.createElement("div");
    item.className = `item g-${group}`;

    // Two-row anatomy for every event:
    //   row 1: username + badges
    //   row 2: what happened (message / gift / action)
    // right column: diamond total on gifts — nothing else, so text gets
    // every pixel of width (no timestamps, like TikFinity's own dock)
    const side = giftD != null ? `<div class="side"><span class="giftD">${giftD}</span></div>` : "";

    item.innerHTML = `
      <div class="media ${mediaClass}">${mediaHtml}</div>
      <div class="itemBody">
        ${who ? `<div class="l1">${who}</div>` : ""}
        ${what ? `<div class="l2">${what}</div>` : ""}
      </div>
      ${side}`;

    for (const nameEl of item.querySelectorAll("[data-copy]")) {
      const nm = nameEl.dataset.copy;
      nameEl.classList.add("name");
      const fc = nameEl.dataset.followers;
      const uid = nameEl.dataset.uid;
      nameEl.title = fc != null
        ? `${nm} · ${fmtCompact(fc)} follower${Number(fc) === 1 ? "" : "s"} — click to open their TikTok profile`
        : `${nm} — click to open their TikTok profile`;
      nameEl.addEventListener("click", () => {
        if (uid) {
          // OBS browser docks open these in the system browser
          window.open(`https://www.tiktok.com/@${encodeURIComponent(uid)}`, "_blank");
        } else {
          copyText(nm, nameEl);
        }
      });
    }
    return item;
  }

  function followerCountOf(d) {
    const fc = d && d.followInfo && d.followInfo.followerCount;
    const n = Number(fc);
    return fc != null && isFinite(n) ? n : null;
  }

  function nameHtml(d) {
    const name = textOf(d);
    const fc = followerCountOf(d);
    const badges = [];
    const uid = pick(d, "uniqueId") || null;
    if (uid && rankByUser.has(uid)) {
      const r = rankByUser.get(uid).rank;
      badges.push(`<span class="rchip" title="Top gifter #${r}">${RANK_ICON.gifter[r] || RANK_ICON.gifter.muted}</span>`);
    }
    if (uid && rankByLiker.has(uid)) {
      const r = rankByLiker.get(uid).rank;
      badges.push(`<span class="rchip" title="Top liker #${r}">${RANK_ICON.liker[r] || RANK_ICON.liker.muted}</span>`);
    }
    if (d.isModerator) badges.push('<span class="bchip mod">MOD</span>');
    if (d.isSubscriber) badges.push('<span class="bchip sub">SUB</span>');
    if (d.userIdentity && d.userIdentity.isAnchor) badges.push('<span class="bchip anchor">HOST</span>');
    return `<span data-copy="${esc(name)}"${uid ? ` data-uid="${esc(uid)}"` : ""}${fc != null ? ` data-followers="${fc}"` : ""}>${esc(name)}</span>${badges.join("")}`;
  }

  /* ------------------------------------------------------------------ *
   *  Per-type content: { line1: who, line2: what }
   * Every event renders the username on row 1 and the action/message on row 2.
   * ------------------------------------------------------------------ */

  function contentFor(eventName, d) {
    const who = nameHtml(d);

    switch (groupOf(eventName)) {
      case "chat":
        pollHandleChat(d, String(pick(d, "comment") ?? ""));
        return { who, what: `<span class="msg">${chatHtmlWithEmotes(d, String(pick(d, "comment") ?? ""))}</span>` };
      case "gift": {
        const gName = pick(d, "giftName") ?? (d.giftDetails && pick(d.giftDetails, "giftName", "name")) ?? "Gift";
        const rc = Number(pick(d, "repeatCount") ?? 1);
        return { who, what: `sent <b>${esc(gName)}${rc > 1 ? ` ×${rc}` : ""}</b>` };
      }
      case "like": {
        const n = pick(d, "likeCount");
        return { who, what: `tapped <b>${n != null ? esc(n) : "?"} likes</b>`, likes: Number(n) || 0 };
      }
      case "follow":
        return { who, what: `followed you` };
      case "social": {
        const what = eventName === "subscribe" ? "subscribed"
          : eventName === "share" ? "shared the stream"
          : esc(String(pick(d, "displayType", "action") ?? "social action"));
        return { who, what };
      }
      case "member":
        return { who, what: `joined` };
      default: {
        if (eventName === "system") return { who: null, what: `<span class="act">${esc(String(pick(d, "message") ?? "Connected"))}</span>` };
        return { who: null, what: `<span class="act">${esc(eventName)} event</span>` };
      }
    }
  }

  /* ------------------------------------------------------------------ *
   *  Leaderboards — top gifters (diamonds) and top likers (likes)
   * ------------------------------------------------------------------ */

  function addGiftToTotals(d) {
    const rc = Number(pick(d, "repeatCount") ?? 1);
    const dc = Number(pick(d, "diamondCount") ?? (d.giftDetails && pick(d.giftDetails, "diamondCount")) ?? 0);
    const streakDone = d.repeatEnd === true || d.giftType !== 1;
    if (!streakDone) return;
    const coins = dc * rc;
    const key = pick(d, "uniqueId") || pick(d, "nickname") || "unknown";
    const entry = gifterTotals.get(key) || { name: pick(d, "nickname") || key, coins: 0, uid: pick(d, "uniqueId") || null };
    if (!entry.uid && d.uniqueId) entry.uid = d.uniqueId;
    entry.coins += coins;
    gifterTotals.set(key, entry);
    renderTopGifters();
  }

  // celebrate round follower crossings with a quiet system row (no sound,
  // no confetti — the number itself is the moment). Jumping several rungs
  // at once announces only the highest one.
  function checkMilestone() {
    if (!streamerFollowers) return;
    let best = 0;
    for (const m of MILESTONES) if (streamerFollowers >= m && m > milestoneHit) best = m;
    if (!best) return;
    milestoneHit = best;
    addEvent("system", { message: `${isoRtl(streamerName || "Stream")} crossed ${fmtNum(best)} followers` }, true);
  }

  function addLikeToTotals(d) {
    const n = Number(pick(d, "likeCount") ?? 0);
    if (n <= 0) return;
    const uid = pick(d, "uniqueId") || pick(d, "userId") || null;
    if (!uid) return;
    const key = String(uid);
    const entry = likerTotals.get(key) || { name: pick(d, "nickname") || key, likes: 0, uid: key };
    entry.likes += n;
    likerTotals.set(key, entry);
    renderTopGifters();
  }

  function boardRows(totals, valueKey) {
    return [...totals.values()].sort((a, b) => b[valueKey] - a[valueKey]).slice(0, 3);
  }

  function boardHtml(entries, valueKey, capClass) {
    if (!entries.length) return "";
    return `<div class="bdCap ${capClass}" title="${capClass === "gifters" ? "Top gifters" : "Top likers"}">${CAP_ICON[capClass]}</div>` +
      entries.map((t, i) => `
        <div class="bd r${i + 1}${userFilter && userFilter.uid && String(t.uid) === userFilter.uid ? " on" : ""}" data-uid="${esc(String(t.uid ?? ""))}" data-name="${esc(t.name)}" title="${esc(t.name)} — click to show only their events">
          <span class="bdRank r${i + 1}">${i + 1}</span>
          <span class="bdName">${esc(t.name)}</span>
          <span class="bdVal">${fmtNum(t[valueKey])}</span>
        </div>`).join("");
  }

  function renderTopGifters() {
    const topG = boardRows(gifterTotals, "coins");
    const topL = boardRows(likerTotals, "likes");

    // uniqueId -> rank, so feed rows can badge this session's top people
    rankByUser.clear();
    topG.forEach((t, i) => { if (i < 3 && t.uid) rankByUser.set(t.uid, { rank: i + 1 }); });
    rankByLiker.clear();
    topL.forEach((t, i) => { if (i < 3 && t.uid) rankByLiker.set(t.uid, { rank: i + 1 }); });

    tgEl.classList.toggle("has", boardShow.gifters && topG.length > 0);
    tgEl.innerHTML = (boardShow.gifters && topG.length) ? boardHtml(topG, "coins", "gifters") : "";
    tlEl.classList.toggle("has", boardShow.likers && topL.length > 0);
    tlEl.innerHTML = (boardShow.likers && topL.length) ? boardHtml(topL, "likes", "likers") : "";
  }

  /* ------------------------------------------------------------------ *
   *  Feed intake
   * ------------------------------------------------------------------ */

  // O(1) trimming: track the oldest row so hitting the cap never re-scans
  // the whole feed (the old version ran querySelectorAll on every insert).
  let oldestItem = null;
  function trimFeed() {
    while (itemCount > MAX_ITEMS) {
      let last = oldestItem && oldestItem.isConnected ? oldestItem : feedEl.lastElementChild;
      while (last && !last.classList.contains("item")) last = last.previousElementSibling;
      if (last && last.dataset && last.dataset.uid) likeRows.delete(last.dataset.uid);
      if (!last) break;
      oldestItem = last.previousElementSibling;
      last.remove();
      itemCount--;
    }
  }

  function prependItem(el) {
    if (emptyEl && emptyEl.style.display !== "none") emptyEl.style.display = "none";
    feedEl.prepend(el);
    itemCount++;
    trimFeed();

    if (!paused) {
      feedEl.scrollTop = 0;
    } else {
      pendingCount++;
      pausePill.style.display = "inline-flex";
      pausePill.textContent = `${pendingCount} new while reading — resume`;
    }
  }

  // Viewer count ingestion — roomUser is the main carrier, but the count also
  // rides along on other events, so ANY event with a count refreshes it. That
  // makes the number self-correcting (it snaps back to truth after missed or
  // dropped events) instead of only ever going up from its first value.
  function ingestViewerCount(d) {
    if (!d || typeof d !== "object") return false;
    const src = d.roomUser && typeof d.roomUser === "object" ? d.roomUser : d;
    const vc = Number(pick(src, "viewerCount", "totalUser", "userCount", "totalUserCount", "viewer_count"));
    if (!Number.isFinite(vc) || vc <= 0) return false;
    const changed = viewers !== vc;
    viewers = vc;
    if (viewers > peakViewers) { peakViewers = viewers; scheduleSave(); }
    return changed;
  }

  function addEvent(eventName, data, demo = false) {
    const group = groupOf(eventName);
    const now = Date.now();
    if (!firstEventAt) firstEventAt = now;
    lastEventAt = now;
    sessionTotal++;

    // read the count off every event before any early return below
    const vcChanged = ingestViewerCount(data);

    // roomUser carries rankings, not feed content: the ranking itself lives
    // in the Top gifters strip, so no rows — just keep the count fresh.
    if (eventName === "roomUser") {
      if (vcChanged) scheduleSave();
      updateHud();
      return;
    }

    // housekeeping events: not worth a feed row
    if (eventName === "config" || eventName === "state_update") {
      // TikFinity broadcasts its own toggle states on state_update. The one
      // that matters to us is the chatbot: when it is off, TikFinity accepts
      // our sendChatbotMessage and then silently throws it away with the
      // toast "Streamer.bot sent a chat message, but your chatbot is
      // switched off". Reading it lets the dock refuse BEFORE sending and
      // name the exact switch, instead of reporting a success that vanished.
      if (eventName === "state_update" && data && typeof data === "object") {
        const st = data.state || data;
        if (st && "chatbot_toggle_state" in st) {
          const on = Number(st.chatbot_toggle_state) !== 0;
          if (on !== chatbotOn) {
            chatbotOn = on;
            renderChatSendState();
          }
        }
      }
      updateHud();
      return;
    }

    if (eventName === "like" && data.totalLikeCount != null) totalLikes = data.totalLikeCount;
    if (group === "like") { addLikeToTotals(data); scheduleSave(); }

    // streamer follower total: any event from the anchor (their chats, gifts,
    // likes…) carries followInfo.followerCount = the STREAMER's follower count.
    // That rising number is what milestones watch.
    if (data.userIdentity && data.userIdentity.isAnchor) {
      streamerUid = String(pick(data, "uniqueId") || pick(data, "userId") || streamerUid);
      // avatar: profilePictureUrl first, then the userDetails mirror list —
      // some TikFinity event shapes only populate the latter
      let av = pick(data, "profilePictureUrl");
      if (!av && data.userDetails && Array.isArray(data.userDetails.profilePictureUrls)) {
        av = data.userDetails.profilePictureUrls.find(u => typeof u === "string" && u);
      }
      if (av) streamerAvatar = String(av);
      const fc = Number(data.followInfo && data.followInfo.followerCount);
      if (Number.isFinite(fc)) {
        streamerName = String(pick(data, "nickname", "uniqueId") || streamerName);
        if (fc > streamerFollowers) {
          streamerFollowers = fc;
          checkMilestone();
          scheduleSave();
        }
      }
    }

    // own-message echo dedupe: TikTok sends the streamer's own chat back
    // through the Event API; we already rendered it optimistically on send.
    // Runs AFTER the anchor block so streamerUid is known by now.
    if (group === "chat") {
      const text = String(pick(data, "comment") ?? "");
      if (data.__ownSend) {
        // our own optimistic row: start the dedupe window, never dedupe it
        delete data.__ownSend;
        recentOwnSends.set(text, Date.now());
      } else {
        const uid = String(pick(data, "uniqueId") || pick(data, "userId") || "");
        const sent = recentOwnSends.get(text);
        const isOurs = sent != null && Date.now() - sent < 10000 &&
          ((streamerUid && uid === streamerUid) || (data.userIdentity && data.userIdentity.isAnchor === true));
        if (isOurs) {
          recentOwnSends.delete(text);
          updateHud();
          return;
        }
      }
    }

    // followers gained: count every follow event this session
    if (group === "follow") {
      followsGained++;
      scheduleSave();
    }

    // stream went live / ended → one clear row with a green/red circle, not
    // "liveStatusChange event" gibberish. A NEW stream also wipes the feed
    // (only on a true offline → live transition, so reconnects mid-stream
    // can't eat an active session).
    if (eventName === "liveStatusChange") {
      const live = liveStatusOf(data);

      // Unrecognised payload: keep whatever we believed before and stay
      // quiet. No row, no state change, no header lie.
      if (live === null) {
        updateHud();
        return;
      }

      const prev = lastLiveState;
      // Repeats of the state we're already in add nothing — one row per
      // actual transition, never a stack of identical "went live" rows
      if (live === prev) {
        if (socket && socket.readyState === WebSocket.OPEN) {
          setDot("connected", live ? "Live now" : "Connected to TikFinity");
        }
        updateHud();
        return;
      }

      if (live && prev !== true) {
        // offline → live is a DEFINITE new stream: audience numbers belong
        // to the old stream, so reset them. A first sighting while the dock
        // already has session data means a mid-stream reconnect (TikFinity
        // replays its current state) — never wipe a live session for that.
        if (prev === false || (prev == null && !firstEventAt)) clearAll(true);
      }
      lastLiveState = live;
      // keep the header text honest: "Connected" -> "Live" / back again
      if (socket && socket.readyState === WebSocket.OPEN) {
        setDot("connected", live ? "Live now" : "Connected to TikFinity");
      }
      const item = buildItem({
        group: live ? "live" : "offline",
        mediaClass: live ? "m-live" : "m-offline",
        mediaHtml: ICONS.live,
        who: null,
        what: `<span class="act">${live ? "Stream went live" : "Stream ended"}</span>`
      });
      item.dataset.group = "other";
      applyVisibility(item);
      prependItem(item);
      updateHud();
      return;
    }

    let mediaClass;
    let mediaHtml;
    let giftD = null;

    let giftData = data;

    // Streak coalescing: TikTok fires repeatable gifts (giftType 1) repeatedly
    // with growing repeatCount until repeatEnd:true. Showing each tick would
    // spam the feed and make "x1" rows that later become "x5". So: hold
    // in-progress streaks silently and emit ONE row when the streak ends,
    // with the final count. Non-streakable gifts render immediately.
    if (group === "gift" && data.giftType === 1 && data.repeatEnd !== true) {
      const key = `${pick(data, "userId") || pick(data, "uniqueId") || "?"}-${pick(data, "giftId") || "?"}`;
      const held = pendingStreaks.get(key);
      if (!held || Number(data.repeatCount) > Number(held.repeatCount)) {
        pendingStreaks.set(key, data);
      }
      updateHud();
      return;
    }
    if (group === "gift" && data.giftType === 1) {
      const key = `${pick(data, "userId") || pick(data, "uniqueId") || "?"}-${pick(data, "giftId") || "?"}`;
      const held = pendingStreaks.get(key);
      if (held && Number(data.repeatCount) < Number(held.repeatCount)) {
        giftData = { ...data, repeatCount: held.repeatCount };
      }
      pendingStreaks.delete(key);
    }

    if (
      group === "chat" ||
      group === "like" ||
      group === "follow" ||
      group === "social" ||
      group === "member"
    ) {
      // every event made by a person shows that person's profile picture
      mediaClass = "m-avatar";
      mediaHtml = avatarMedia(giftData, textOf(giftData));
    } else if (group === "gift") {
      // avatar of the sender in the circle; the gift artwork goes inline
      // next to the gift name instead
      addGiftToTotals(giftData);
      const dc = Number(pick(giftData, "diamondCount") ?? (giftData.giftDetails && pick(giftData.giftDetails, "diamondCount")) ?? 0);
      const rc = Number(pick(giftData, "repeatCount") ?? 1);
      const streakDone = giftData.repeatEnd === true || giftData.giftType !== 1;
      if (streakDone) {
        diamonds += dc * rc;
        // pings fire once per completed streak/gift, operator-side only
        if (dc * rc >= soundBig) pingBigGift(); else pingSmallGift();
      }
      scheduleSave();
      mediaClass = "m-avatar";
      mediaHtml = avatarMedia(giftData, textOf(giftData));
      giftD = `<i class="i diamond">${ICONS.diamond}</i>${fmtNum(dc * rc)}`;
    } else {
      mediaClass = `m-${group}`;
      mediaHtml = ICONS[group] || ICONS.other;
    }

    const { who, what } = contentFor(eventName, giftData);
    const withIcon = group === "gift"
      ? `<span class="gifto">${giftMedia(giftData)}</span>${what}`
      : what;
    const item = buildItem({
      group,
      mediaClass,
      mediaHtml,
      who,
      what: withIcon,
      giftD
    });

    if (mediaClass === "m-avatar") item.querySelector(".media").dataset.name = textOf(data);

    item.dataset.group = group;
    const evUid = pick(giftData, "uniqueId") ?? pick(giftData, "userId");
    if (evUid != null && evUid !== "") item.dataset.uid = String(evUid);
    applyVisibility(item);

    // Rapid-like coalescing: TikTok sends ONE like event per ~15 taps and
    // spammers fire them back-to-back, which used to bury the feed. When
    // the SAME person likes again within the window and their row is still
    // near the top, grow that row instead of adding another one.
    if (group === "like" && item.dataset.uid) {
      const uid = item.dataset.uid;
      const prev = likeRows.get(uid);
      if (prev && now - prev.at < LIKE_MERGE_MS && prev.el.isConnected && nearTop(prev.el)) {
        const add = Number(pick(giftData, "likeCount")) || 0;
        prev.total += add;
        prev.at = now;
        prev.bursts++;
        const bold = prev.el.querySelector(".l2 b");
        if (bold) bold.textContent = fmtNum(prev.total);
        prev.el.querySelector(".l2")?.classList.add("merged");
        updateHud();
        return;
      }
      likeRows.set(uid, { el: item, at: now, total: Number(pick(giftData, "likeCount")) || 0, bursts: 1 });
    }

    prependItem(item);
    updateHud();
  }

  /* ------------------------------------------------------------------ *
   *  HUD
   * ------------------------------------------------------------------ */

  function updateHud() {
    // While connected, a missing count is a real zero — TikFinity is
    // counting and has nothing to report yet. Only before the first
    // connection is a dash the honest answer.
    const none = tracking ? "0" : "–";
    statViewers.textContent = viewers == null ? none : fmtNum(viewers);
    statLikes.textContent = totalLikes == null ? none : fmtNum(totalLikes);
    statDiamonds.textContent = fmtNum(diamonds);
    countEl.textContent = `${fmtNum(sessionTotal)} events`;
    renderGoal();
  }

  /* Goal bar: current vs target for the chosen metric */

  const GOAL_LABELS = { followers: "Followers", likes: "Likes", diamonds: "Diamonds" };

  function goalValue() {
    if (goal.type === "followers") return followsGained;
    if (goal.type === "likes") return totalLikes == null ? 0 : totalLikes;
    return diamonds;
  }

  function renderGoal() {
    const show = goal.on && !CONTROLS;
    goalBarEl.hidden = !show;
    goalStatusEl.textContent = show ? "shown" : "off";
    if (!show) return;
    const val = goalValue();
    const pct = Math.max(0, Math.min(100, (val / goal.target) * 100));
    goalLabelEl.textContent = GOAL_LABELS[goal.type];
    goalFillEl.style.width = pct + "%";
    goalFillEl.classList.toggle("done", val >= goal.target);
    goalNumsEl.textContent = `${fmtNum(Math.min(val, goal.target))} / ${fmtNum(goal.target)}${val >= goal.target ? " ✓" : ""}`;
  }

  function applyVisibility(el) {
    const g = el.dataset.group;
    let show = filters[g] !== false;
    if (show && userFilter) show = el.dataset.uid === userFilter.uid;
    el.style.display = show ? "" : "none";
  }

  // click a leaderboard pill → the feed shows only that person's events;
  // click the pill (or the bar's clear button) again → everything
  function setUserFilter(f) {
    userFilter = f || null;
    for (const el of feedEl.querySelectorAll("[data-group]")) applyVisibility(el);
    for (const el of document.querySelectorAll(".bd.on")) el.classList.remove("on");
    if (userFilter) {
      userFilterNameEl.innerHTML = `Showing only <b></b>`;
      userFilterNameEl.querySelector("b").textContent = userFilter.name;
      for (const el of document.querySelectorAll(`.bd[data-uid="${CSS.escape(userFilter.uid)}"]`)) el.classList.add("on");
      feedEl.scrollTop = 0;
    }
    userFilterBar.hidden = !userFilter;
  }

  /* ------------------------------------------------------------------ *
   *  Like engine — control + status
   * ------------------------------------------------------------------ */

  async function likeFetch(path, method, body) {
    try {
      const opts = { method: method || "GET", cache: "no-store" };
      if (body) {
        opts.headers = { "Content-Type": "application/json" };
        opts.body = JSON.stringify(body);
      }
      const r = await fetch(`http://127.0.0.1:${LIKE_PORT}${path}`, opts);
      if (!r.ok) throw 0;
      return await r.json();
    } catch { return null; }
  }

  const likeErrEl = document.getElementById("likeErr");
  let likeStateSeen = null;   // last status object the engine reported

  // The button IS the state readout: one press starts, the same press stops,
  // and the label always says which one it will do. There is no saved setting
  // to restore, because the engine's own answer is the truth — a restarted
  // engine is simply off, and the button says so.
  function paintLikeButton(st) {
    if (!likeToggleBtn) return;
    const on = !!(st && st.on);
    const live = !!(st && st.live);
    likeToggleBtn.textContent = on ? "Stop auto-like" : "Start auto-like";
    likeToggleBtn.className = "sheetBtn " + (on ? "keyDanger" : "sheetBtnGo");
    // Stop is always available; start needs a live room, because that is the
    // only place a like button exists at all.
    likeToggleBtn.disabled = !on && !live;
    likeToggleBtn.title = !on && !live
      ? "Go live first — likes only count on a live room"
      : (on ? "Stop tapping likes from account 2" : "Start tapping likes from account 2");
  }

  function renderLikeState(st) {
    likeStateSeen = st;
    paintLikeButton(st);
    if (!st) {
      // Say so in the collapsed header, not only inside the section: an engine
      // that is not running looks exactly like a toggle that does nothing.
      likeStatusEl.textContent = "not running";
      likeStatusEl.className = "sStatus bad";
      likeHint.hidden = false;
      if (likeErrEl) likeErrEl.hidden = true;
      return;
    }
    likeStatusEl.className = "sStatus" + (st.error ? " bad" : "");
    likeHint.hidden = true;
    const bits = [];
    if (st.tapping) bits.push(st.streamer ? "tapping" : "tapping · no handle");
    else if (st.on && !st.live) bits.push("waiting for live");
    else bits.push("idle");
    if (st.likes) bits.push(`${fmtNum(st.likes)} sent`);
    else if (st.tapping && st.streamer && !st.likes) bits.push("0 sent");
    if (st.perMin) bits.push(`~${fmtNum(st.perMin)}/min`);
    if (st.error) bits.push("error");
    likeStatusEl.textContent = bits.join(" · ");

    // "tapping" with no handle used to mean tapping nothing at all, and
    // nothing on screen said so. Spell out why, in full, right here — and put
    // the engine's own sentence first, because it names the room it is on.
    let why = "";
    if (st.tapping && !st.streamer) {
      why = "Ticking a stream it cannot find — the engine has no handle for " +
        "you, so it is clicking nothing. Go live once with this dock open " +
        "(it sends the handle itself), or set TF_STREAMER to your @name.";
    } else if (st.error) {
      why = st.error + (st.tapsFail ? ` (${st.tapsFail} failed attempts)` : "") +
        " — is the stream live, and account 2 still signed in? See like-engine.log for the page it saw.";
    } else if (st.tapping && st.likes === 0 && st.tapsFail > 2) {
      why = "Tapping is failing (" + st.tapsFail + " clicks that did not land). " +
        "See like-engine.log for the page the engine actually saw.";
    }
    if (likeErrEl) {
      likeErrEl.hidden = !why;
      likeErrEl.textContent = why;
    }
  }

  // Only the handle is pushed. The cadence lives in auto-liker.js, so there is
  // no speed to send and nothing for a stale dock to get wrong.
  async function pushLikeConfig() {
    // streamerUid rides along: the dock already knows who the host is from the
    // anchor events, and the engine's own learning has never managed it.
    const st = await likeFetch("/config", "POST", { streamer: streamerUid || undefined });
    likeConfigPushed = !!st;
    if (st) renderLikeState(st);
    return st;
  }

  async function pollLike() {
    const st = await likeFetch("/status");
    renderLikeState(st);
    if (!st) { likeConfigPushed = false; return; }
    // Demo mode reports a scripted stream, and its fake host is not a real
    // handle: pushing it taught the engine to tap @demo.host and saved that to
    // disk, which is why a real stream then looked like a broken like button.
    // While the demo is running, watch the engine but never steer it.
    if (demoMode) return;

    // A handle we know and the engine does not is out of sync — push it right
    // away rather than waiting for the next poll. The engine needs it before
    // the first tap, and the button is gated on the stream being live anyway.
    if (!likeConfigPushed || (streamerUid && st.streamer !== streamerUid)) {
      await pushLikeConfig();
    }
  }

  // Start / stop. Only reachable while the button is enabled, which the engine
  // status controls: no live stream, no start.
  likeToggleBtn.addEventListener("click", async () => {
    const on = !!(likeStateSeen && likeStateSeen.on);
    if (!on && !(likeStateSeen && likeStateSeen.live)) {
      paintLikeButton(likeStateSeen);           // refuses, and shows why on hover
      return;
    }
    const st = await likeFetch(on ? "/off" : "/on", "POST");
    if (st) renderLikeState(st);
    else pollLike();                            // no answer: show the truth
  });

  pollLike();
  likePoll = setInterval(pollLike, 10000);

  /* ------------------------------------------------------------------ *
   *  Connection — strictly manual (see startEverything below)
   * ------------------------------------------------------------------ */

  function unwrapMessage(raw) {
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return { event: "raw", data: raw }; }

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.event === "string") {
      const rest = { ...parsed };
      delete rest.event;
      const data = (rest.data && typeof rest.data === "object" && !Array.isArray(rest.data)) ? rest.data : rest;
      return { event: parsed.event, data };
    }
    return { event: "raw", data: parsed };
  }

  // STRICTLY MANUAL. The dock never connects, retries, or starts TikFinity on
  // its own — not on load, not after a drop, not when the stream looks live.
  // The ONLY entry point is the Reconnect button (or clicking the status dot),
  // which launches TikFinity and then keeps trying for as long as you let it.
  let reconnectAttempts = 0;
  let reconnectTimer = 0;
  let manualConnectRun = 0;

  function showDisconnected() {
    socket = null;
    endpointIndex++;
    clearTimeout(reconnectTimer);
    setDot("disconnected", "Not connected — click Reconnect to start");
    retryBtn.hidden = false;
    setFootStatus("not started — click Reconnect");
  }

  function connect() {
    if (demoMode) return;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

    retryBtn.hidden = true;

    const endpoint = ENDPOINTS[endpointIndex % ENDPOINTS.length];
    setFootStatus(endpoint);
    setDot("connecting", "Connecting…");

    let ws = null;
    try {
      ws = new WebSocket(endpoint);
      socket = ws;
    } catch {
      showDisconnected();
      return;
    }

    ws.addEventListener("open", () => {
      if (socket !== ws) return;
      reconnectAttempts = 0;
      clearTimeout(reconnectTimer);
      setDot("connected", "Connected to TikFinity");
    });

    ws.addEventListener("message", msg => {
      if (socket !== ws) return;
      const { event, data } = unwrapMessage(msg.data);
      addEvent(event, data, false);
    });

    ws.addEventListener("error", () => {
      // close always follows an error; handled there
    });

    ws.addEventListener("close", () => {
      if (demoMode || socket !== ws) return;
      showDisconnected();
    });
  }

  /* ------------------------------------------------------------------ *
   *  Settings sheet — accordion
   *
   *  Every section sits inline under its band label and opens on its own,
   *  so chat sending + poll + goal bar can all be open at once and you can
   *  adjust several things without backing out of anything.
   * ------------------------------------------------------------------ */

  document.querySelector(".sheetBody").addEventListener("click", e => {
    const head = e.target.closest(".sHead");
    if (!head) return;
    const group = head.parentElement;
    group.classList.toggle("closed");
    // Session has no button of its own any more: opening the section is the
    // request for its summary, so it is built fresh right here.
    if (group.id === "gSess" && !group.classList.contains("closed")) renderSessionSummary();
  });

  /* ------------------------------------------------------------------ *
   *  Stream key — get a TikTok stream URL + key without leaving the dock
   *
   *  The dock asks the local helper (chat-bridge.ps1) which calls the same
   *  Streamlabs API the standalone key-generator tool uses, so that app is
   *  no longer needed. Keys change every stream, so this is a button you
   *  press once per broadcast — deliberately never automatic.
   * ------------------------------------------------------------------ */

  const keyStatusEl = document.getElementById("keyStatus");
  const keyTitleInput = document.getElementById("keyTitle");
  const keyCategoryInput = document.getElementById("keyCategory");
  const catSuggest = document.getElementById("catSuggest");
  const keyGetBtn = document.getElementById("keyGet");
  const keyInfoBtn = document.getElementById("keyInfo");
  const keyOut = document.getElementById("keyOut");
  const keyUrlEl = document.getElementById("keyUrl");
  const keyValEl = document.getElementById("keyVal");
  const keyHint = document.getElementById("keyHint");
  const keyEndBtn = document.getElementById("keyEnd");
  const connHintEl = document.getElementById("connHint");
  const obsPortInput = document.getElementById("obsPort");
  const obsPassInput = document.getElementById("obsPass");
  const obsStartToo = document.getElementById("obsStartToo");
  const openTikfinity = document.getElementById("openTikfinity");
  const obsHint = document.getElementById("obsHint");
  const obsConn = document.getElementById("obsConn");

  let streamKey = "";
  let streamUrl = "";
  let categoryId = "";      // TikTok's game_mask_id for the chosen category

  /* ---- session state ------------------------------------------------
   * One Start button and one End button, side by side, that describe the
   * session rather than the click: idle -> Start stream / End disabled,
   * live -> Title locked while live + End enabled. The state is remembered so
   * a reload does not orphan a broadcast session nobody can end any more. */
  const SESSION_STORE = "tfDock.session.v1";
  let sessionState = "idle";   // idle | starting | live | ending | failed

  function sessionRemember(title, category) {
    try {
      localStorage.setItem(SESSION_STORE, JSON.stringify({
        at: Date.now(), title: title || "", category: category || ""
      }));
    } catch { }
  }
  function sessionForget() { try { localStorage.removeItem(SESSION_STORE); } catch { } }

  /* Title and category are the streamer's own words, so they outlive both the
   * session and a dock reload. Kept apart from SESSION_STORE on purpose:
   * ending a stream must not wipe what they typed, and the only thing that
   * clears this is them clearing the fields. */
  const DRAFT_STORE = "tfDock.draft.v1";
  let draftTimer = 0;
  function draftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_STORE, JSON.stringify({
          title: keyTitleInput.value, category: keyCategoryInput.value
        }));
      } catch { }
    }, 250);
  }
  function draftRestore() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_STORE) || "null");
      if (!d) return;
      if (keyTitleInput.value === "" && d.title) keyTitleInput.value = d.title;
      if (keyCategoryInput.value === "" && d.category) keyCategoryInput.value = d.category;
    } catch { }
  }
  keyTitleInput.addEventListener("input", draftSave);
  keyCategoryInput.addEventListener("input", draftSave);

  /* The two opt-in ticks say how this stream is launched, and that is the same
   * every time - someone who always wants the vertical stream and the desk
   * should never have to tick both again after an OBS restart or a dock
   * reload. Saved the moment they are clicked, which is the only moment there
   * is to catch. Kept in their own store: neither ending a stream nor
   * clearing the fields is a reason to un-tick them. */
  const TICK_STORE = "tfDock.ticks.v1";
  function saveTicks() {
    try {
      localStorage.setItem(TICK_STORE, JSON.stringify({
        aitum: obsStartToo.checked, desk: openTikfinity.checked
      }));
    } catch { }
  }
  function restoreTicks() {
    try {
      const t = JSON.parse(localStorage.getItem(TICK_STORE) || "null");
      if (!t) return;                       // never stored: stay unticked
      if (typeof t.aitum === "boolean") obsStartToo.checked = t.aitum;
      if (typeof t.desk === "boolean") openTikfinity.checked = t.desk;
    } catch { }
  }
  obsStartToo.addEventListener("change", saveTicks);
  openTikfinity.addEventListener("change", saveTicks);
  function sessionRecall() {
    try { return JSON.parse(localStorage.getItem(SESSION_STORE) || "null"); } catch { return null; }
  }

  function setSessionState(next, hint) {
    sessionState = next;
    const live = next === "live";
    const busy = next === "starting" || next === "ending";

    keyGetBtn.textContent =
      next === "starting" ? "Starting…"
        : next === "ending" ? "Ending…"
          : live ? "Title locked while live" : "Start stream";
    // no account connected = nothing to start, so do not offer it
    keyGetBtn.disabled = busy || !accountOn;
    keyEndBtn.textContent = next === "ending" ? "Ending…" : "End stream";
    keyEndBtn.disabled = !live;          // nothing to end unless a session is up

    keyStatusEl.className = "sStatus" + (live ? " ok" : next === "failed" ? " bad" : "");
    syncKeyActions();
    if (hint !== undefined) setKeyHint(hint);
  }

  function clearStreamFields() {
    streamKey = "";
    streamUrl = "";
    setKeyField(keyUrlEl, "");
    setKeyField(keyValEl, "");
    keyOut.hidden = false;
  }

  /* The server and key are the only two things a creator has to paste
   * somewhere else, so the value itself is the button: click it and it is on
   * the clipboard. No separate Copy button to hunt for, and there is nothing
   * left to grey out - the value just goes dim until there is one. */
  function setKeyField(el, value) {
    el.textContent = value || "—";
    el.classList.toggle("keyBlank", !value);
    el.title = value ? `${value}\n\nClick to copy` : "";
    // Before a stream there is no key yet, so two rows reading "—" are just
    // height in the middle of the daily path. They appear the moment there is
    // something to copy. obsConn / obsHint deliberately stay put - reporting
    // on OBS before you press anything is the whole point of them.
    const out = document.getElementById("keyOut");
    if (out) out.classList.toggle("keyIdle", !streamUrl && !streamKey);
  }
  for (const el of [keyUrlEl, keyValEl]) {
    el.addEventListener("click", () => {
      const v = el.textContent;
      if (!v || v === "—") return;
      copyText(v, el);
    });
  }

  /* ---- category autocomplete -------------------------------------------
   * Typing asks the helper for TikTok's own category list (same call the
   * old key-generator tool used). Picking one keeps its mask id, so the
   * stream is filed under the exact category rather than a similar name. */
  let catTimer = null;
  let catToken = 0;

  function closeSuggest() {
    catSuggest.hidden = true;
    catSuggest.textContent = "";
  }

  function renderSuggest(list) {
    catSuggest.textContent = "";
    if (!list || !list.length) { catSuggest.hidden = true; return; }
    for (const c of list.slice(0, 8)) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = c.name;
      b.addEventListener("click", () => {
        keyCategoryInput.value = c.name;
        categoryId = c.id || "";
        closeSuggest();
      });
      catSuggest.appendChild(b);
    }
    catSuggest.hidden = false;
  }

  async function searchCategories(term) {
    const t = String(term || "").trim();
    if (t.length < 2) { closeSuggest(); return; }
    const token = ++catToken;
    const res = await helperGet(`/key/categories?q=${encodeURIComponent(t)}`);
    if (token !== catToken) return;            // a newer keystroke won
    if (!res || res.ok === false || !res.categories) { closeSuggest(); return; }
    renderSuggest(res.categories);
    // a lone exact match can be used straight away
    if (res.categories.length === 1 && res.categories[0].name.toLowerCase() === t.toLowerCase()) {
      categoryId = res.categories[0].id || categoryId;
    }
  }

  keyCategoryInput.addEventListener("input", () => {
    categoryId = "";                            // typed by hand -> no mask id
    clearTimeout(catTimer);
    catTimer = setTimeout(() => searchCategories(keyCategoryInput.value), 250);
  });
  keyCategoryInput.addEventListener("blur", () => setTimeout(closeSuggest, 150));
  keyCategoryInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !catSuggest.hidden) {
      const first = catSuggest.querySelector("button");
      if (first) { e.preventDefault(); first.click(); }
    } else if (e.key === "Escape") { closeSuggest(); }
  });

  // Start (or re-apply) the Streamlabs session. Streamlabs treats a second
  // call as an update to the live session, so this doubles as "change the
  // title/category while I'm live". Button state belongs to setSessionState.
  async function applyStreamStart() {
    const title = keyTitleInput.value.trim();
    const category = categoryId || keyCategoryInput.value.trim() || "Gaming";
    setKeyHint("");
    return helperGet(
      `/key/start?title=${encodeURIComponent(title)}&category=${encodeURIComponent(category)}`);
  }

  // The key/OBS fields are always on screen (empty) rather than appearing
  // from nowhere after a fetch. Nothing needs greying out any more: Start
  // stream pushes the key to Aitum by itself.
  function syncKeyActions() {
    keyEndBtn.disabled = !(sessionState === "live");
  }
  syncKeyActions();

  // localStorage-backed OBS websocket settings
  const OBS_STORE = "tfDock.obs.v1";
  let obsPort = 4455;
  let obsPass = "";

  function saveObs() {
    try { localStorage.setItem(OBS_STORE, JSON.stringify({ port: obsPort, pass: obsPass })); } catch { }
  }
  function loadObs() {
    try {
      const raw = localStorage.getItem(OBS_STORE);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (Number.isFinite(+o.port)) obsPort = Math.max(1, Math.min(65535, Math.floor(+o.port)));
      if (typeof o.pass === "string") obsPass = o.pass;
    } catch { }
  }

  function setKeyStatus(text) { keyStatusEl.textContent = text; }
  function setKeyHint(text) {
    keyHint.hidden = !text;
    keyHint.textContent = text;
    // The same sentence, in whichever place the user is looking. Connecting
    // happens in Connections, but the failure that matters ("TikTok will not
    // let this account go live") belongs on the go-live path - so both get it
    // rather than either becoming a dead end.
    if (connHintEl) {
      connHintEl.hidden = !text;
      connHintEl.textContent = text;
    }
  }
  // The sheet is a full screen overlay, so the header's status words are
  // covered while it is open - that is the one job of this line. The raw
  // websocket URL is a diagnostic, not a status, so when everything is fine
  // the line gets out of the way instead of trailing under the last section.
  function setFootStatus(text) {
    const url = /^wss?:\/\//.test(String(text || ""));
    endpointEl.hidden = !text || url;
    endpointEl.textContent = url ? "" : String(text || "");
  }

  function setObsHint(text) {
    if (!text) { obsHint.hidden = true; return; }
    obsHint.hidden = false;
    obsHint.textContent = text;
  }

  // Every helper answer carries the helper's own build stamp (checked with
  // staleHelper), so an older chat-bridge.ps1 answers can be spotted without
  // asking a second time.
  async function helperGet(route) {
    try {
      const r = await fetch(`http://127.0.0.1:${bridgePort}${route}`, { cache: "no-store" });
      if (!r.ok) throw 0;
      const j = await r.json();
      return j;
    } catch { return null; }
  }

  // text/plain keeps this a CORS-simple request, so the dock's file:// page
  // needs no preflight - and the token never rides in a URL or the log.
  async function helperPost(route, text) {
    try {
      const r = await fetch(`http://127.0.0.1:${bridgePort}${route}`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "text/plain" },
        body: String(text || "")
      });
      if (!r.ok) throw 0;
      return await r.json();
    } catch { return null; }
  }

  keyInfoBtn.addEventListener("click", async () => {
    setKeyStatus("checking…");
    setKeyHint("");
    const info = await helperGet("/key/info");
    if (!info) {
      setKeyStatus("");
      setKeyHint("Chat bridge not running — double-click SETUP.bat, then reload this page.");
      return;
    }
    if (staleHelper(info)) {
      setKeyStatus("bridge out of date");
      setKeyHint("The chat bridge is an older copy than this dock — run SETUP.bat again, then reload this page.");
      return;
    }
    paintAccount(info);
    if (!info.username) {
      setKeyStatus("no account");
      setKeyHint("Connect a Streamlabs account to use Start stream.");
      return;
    }
    if (!info.canGoLive) {
      setKeyStatus("blocked");
      setKeyHint(`${info.username}: status "${info.status || "?"}" — TikTok won't allow this account to go live.`);
      return;
    }
    setKeyStatus(info.username || "ready");
    setKeyHint("");
  });

  /* ---- account connect / disconnect ------------------------------------ */
  // Must match $script:helperVer in chat-bridge.ps1. If the running helper
  // answers with anything else it is an older copy, so the routes this page
  // expects simply are not there - say that, instead of "failed".
  const HELPER_VER = "2026.10.11-2";

  const acctDot = document.getElementById("acctDot");
  const acctName = document.getElementById("acctName");
  const acctBtn = document.getElementById("acctBtn");
  const acctForm = document.getElementById("acctForm");
  const acctToken = document.getElementById("acctToken");
  const acctSave = document.getElementById("acctSave");
  const acctHint = document.getElementById("acctHint");
  // The account is reported in two places on purpose: the short line on the
  // go-live path (so you can tell at a glance whether Start stream will work)
  // and the same line beside the controls in Connections (so switching
  // accounts does not mean guessing whether one is already signed in). One
  // painting function drives both.
  const acctDot2 = document.getElementById("acctDot2");
  const acctName2 = document.getElementById("acctName2");
  const acctFix = document.getElementById("acctFix");
  let accountOn = false;

  function staleHelper(res) {
    return !!(res && res.helperVer && res.helperVer !== HELPER_VER);
  }

  function paintAccount(info) {
    accountOn = !!(info && info.username);
    const dot = "acctDot" + (accountOn ? (info.canGoLive ? " ok" : " warn") : "");
    const text = accountOn
      ? `Connected as @${info.username}${info.canGoLive ? "" : ' (not allowed to go live)'}`
      : "No account connected";
    acctDot.className = dot;
    acctName.textContent = text;
    if (acctDot2) acctDot2.className = dot;
    if (acctName2) acctName2.textContent = text;
    // The jump button is the only thing on the go-live path that points at
    // the one-time settings, so it shows up exactly when it is needed.
    if (acctFix) acctFix.hidden = accountOn;
    acctBtn.textContent = accountOn ? "Disconnect" : "Connect…";
    acctBtn.className = "sheetBtn" + (accountOn ? " keyDanger" : " sheetBtnGo");
    acctBtn.disabled = false;
    if (accountOn) acctForm.hidden = true;
    setSessionState(sessionState);
  }

  async function refreshAccount() {
    const info = await helperGet("/key/info");
    if (info) paintAccount(info);
    else {
      accountOn = false;
      acctDot.className = "acctDot";
      acctName.textContent = "Chat bridge not running";
      if (acctDot2) acctDot2.className = "acctDot";
      if (acctName2) acctName2.textContent = "Chat bridge not running";
      if (acctFix) acctFix.hidden = false;
      acctBtn.disabled = true;
    setSessionState(sessionState);
    }
    return info;
  }

  acctBtn.addEventListener("click", async () => {
    // One click, straight to Streamlabs - no second button to find.
    if (!accountOn) { waitForStreamlabsLogin(); return; }
    if (!confirm("Disconnect this Streamlabs account?\n\nThis only removes the saved token from this PC. Your Streamlabs and TikTok accounts are untouched.")) return;
    const res = await helperGet("/key/disconnect");
    if (!res || res.ok === false) {
      setKeyStatus("disconnect failed");
      setKeyHint(res && res.error ? String(res.error) : "Chat bridge not running — double-click SETUP.bat");
      return;
    }
    setKeyStatus("disconnected");
    setKeyHint("Account removed from this PC. Start stream is unavailable until you connect again.");
    await refreshAccount();
  });

  // One click from the go-live path to the setting that unblocks it: opens
  // Setup → Connections and scrolls to it. Shown only while no account is
  // connected, so it never sits in the way of a normal stream start.
  acctFix.addEventListener("click", () => openSection("gConn"));

  acctSave.addEventListener("click", async () => {
    const token = acctToken.value.trim();
    if (!token) { setKeyStatus("no token"); return; }
    acctSave.disabled = true;
    setKeyStatus("connecting…");
    const res = await helperPost("/key/token", token);
    acctSave.disabled = false;
    acctToken.value = "";              // never leave a secret sitting in the field
    if (!res || res.ok === false) {
      setKeyStatus("connect failed");
      setKeyHint(res && res.error ? String(res.error) : "Chat bridge not running — double-click SETUP.bat");
      return;
    }
    setKeyStatus("connected");
    setKeyHint(`Connected as @${res.username}. Tokens are saved to slobs-token.txt next to this dock.`);
    acctForm.hidden = true;
    await refreshAccount();
  });

  // Streamlabs signs you in over a PKCE code flow: the helper opens their
  // login page in your real browser, Streamlabs sends that browser back to a
  // local port with a one-time code, and the helper swaps the code for a
  // token. Nothing is typed here and no token is ever pasted - Connect...
  // opens the browser straight away and the dock just waits, polling until
  // that browser comes back.
  let loginPoll = null;
  const ACCT_HINT_IDLE = acctHint.textContent;

  function stopLoginPoll() {
    if (loginPoll) { clearInterval(loginPoll); loginPoll = null; }
    acctBtn.disabled = false;
    acctBtn.textContent = accountOn ? "Disconnect" : "Connect…";
  }

  function setAcctHint(text) {
    acctHint.textContent = text || ACCT_HINT_IDLE;
  }

  async function waitForStreamlabsLogin() {
    stopLoginPoll();
    acctBtn.disabled = true;
    acctBtn.textContent = "Signing in…";
    setKeyStatus("sign in…");
    setKeyHint("Finish signing in with TikTok in your browser - this updates by itself.");
    const res = await helperGet("/key/login");
    if (!res || res.ok === false) {
      stopLoginPoll();
      setKeyStatus("could not open browser");
      if (!res) setKeyHint("Chat bridge not running — double-click SETUP.bat, then reload this page.");
      else if (staleHelper(res)) setKeyHint("The chat bridge is an older copy than this dock. Run SETUP.bat again, then reload the dock.");
      else setKeyHint(res.error ? String(res.error) : "The chat bridge would not start the sign-in.");
      // Last resort: let them paste a token they already have.
      acctForm.hidden = false;
      return;
    }
    loginPoll = setInterval(async () => {
      const st = await helperGet("/key/logintatus");
      if (!st) return;                         // helper asleep; keep waiting
      if (st.ok === false) {
        stopLoginPoll();
        setKeyStatus("sign in failed");
        setKeyHint(st.error ? String(st.error) : "The sign-in did not complete. Try again.");
        acctForm.hidden = false;
        return;
      }
      if (st.state === "connected") {
        stopLoginPoll();
        setKeyStatus("connected");
        setKeyHint(`Connected as @${st.username}. Start stream is ready.`);
        acctToken.value = "";
        acctForm.hidden = true;
        await refreshAccount();
      }
    }, 1500);
  }

  // One button, two meanings: it starts the broadcast when there is none, and
// while one is running it refuses to touch it (see the guard below).
keyGetBtn.addEventListener("click", async () => {
    // While a broadcast is live this button must NOT ask Streamlabs for a key
    // again. Measured against the live API, every tiktok/stream/start returns
    // 201 with a brand new broadcast id AND a new ingest server - even while a
    // publisher is connected and healthy. So "updating the title" used to mint
    // an orphan broadcast, leave the running output on the old key, and leave
    // TikTok watching a stream nothing ever feeds: "live will start shortly",
    // forever, with the dock reporting success throughout. There is no update
    // route to use instead (every /tiktok/stream/* variant answers 405).
    if (sessionState === "live") {
      setKeyStatus("live · title locked");
      setKeyHint("Already live, and nothing is sent to this stream. TikTok only " +
        "accepts a title when a broadcast starts, and asking for a new one " +
        "would start a second broadcast and cut this one. Your text is kept " +
        "for the next stream - End stream first if you want it to change now.");
      return;
    }
    // Ticking "Start Aitum stream" is a promise that this button will push the
    // key into OBS and go live. Without the websocket password it cannot, and
    // half a stream is worse than none: TikTok would sit there saying
    // "streaming" with no output and nobody would know why. So refuse before
    // opening a session, not after. Opening the desk alone needs no password,
    // so this gate follows the Aitum tick only.
    if (obsStartToo.checked && !obsOk) {
      await checkObs();                       // one retry, in case it just came up
      if (!obsOk) {
        setKeyStatus("needs OBS password");
        setKeyHint("That tick means Aitum will stream, so Start cannot run until " +
          "the OBS WebSocket password is in the field below. " +
          "Find it in OBS under Tools > WebSocket Server.");
        return;
      }
    }
setSessionState("starting", "");
    setKeyStatus("starting…");
    const res = await applyStreamStart();
    if (!res || res.ok === false) {
      setSessionState("failed", res && res.error
        ? String(res.error).slice(0, 300)
        : "Chat bridge not running — double-click SETUP.bat");
      setKeyStatus("failed");
      return;
    }
    streamKey = String(res.streamKey || streamKey || "");
    streamUrl = String(res.streamUrl || streamUrl || "");
    setKeyField(keyUrlEl, streamUrl);
    setKeyField(keyValEl, streamKey);
    keyOut.hidden = false;

    const title = res.title || keyTitleInput.value.trim();
    const cat = keyCategoryInput.value.trim() || res.category || "";
    sessionRemember(title, cat);
    setSessionState("live",
      `Live as "${title || "(no title)"}"${cat ? " · " + cat : ""}. ` +
      "The title cannot change until the stream ends.");
    // Start stream does the whole job: Streamlabs hands over a key, and the
    // dock pushes it straight into the Aitum canvas. No second button.
    setKeyStatus("sending to Aitum…");
    const sent = await pushKeyToAitum();
    setKeyStatus(sent.ok
      ? "LIVE · sent to Aitum" + sent.extra
      : "LIVE · Aitum not updated");
    // Two separate ticks, so do two separate jobs.
  //  "Start Aitum stream" means press Go Live there and push to TikTok.
  //  "Open TikFinity" means open the desk and attach the chat bridge and the
  //  event API. Either one can be used without the other, so neither implies
  //  the other any more.
    // startEverything is not awaited - it retries for 90s and paints its own
    // progress in the header, and blocking here would freeze the button for a
    // minute.
    const alreadyOn = socket && socket.readyState === WebSocket.OPEN;
    const wantOpen = openTikfinity.checked;
    // Anything that claims to be live has to be backed by Aitum actually
    // pushing, so wait for it: either we just started it, or the desk tick
    // needs proof that output has landed on TikTok before it will attach.
    // Gated on "am I already attached", not on "is this a new session": after
    // an OBS restart the session is restored as live? but nothing is
    // connected, and pressing the button then should still bring the rig up.
    const mustConfirm = sent.ok && !alreadyOn && (sent.started || wantOpen);
    if (mustConfirm && !sent.started) {
      // Desk tick on its own: nothing asked Aitum to start, so if it is not
      // already pushing, TikFinity would open onto "your TikTok LIVE stream
      // appears to be offline". Better to say that than to watch it happen.
      let pushing = false;
      try { pushing = await aitumStatus({ port: obsPort, password: obsPass }); }
      catch { }
      if (!pushing) {
        setKeyStatus("LIVE · Aitum not streaming");
        setKeyHint("TikFinity was not opened: nothing is pushing to TikTok yet, " +
          "so it would only say the stream looks offline. Tick 'Start Aitum " +
          "stream' too, or start the vertical stream in OBS, then press " +
          "this button again.");
        return;
      }
    }
    if (mustConfirm) {
      setKeyHint("Waiting for Aitum to go live…");
      // Trust OBS's own log, not the plugin's flag: that flag reads "streaming"
      // straight through a rejected push, which is how a dead stream used to
      // look perfectly healthy here.
      let live = await waitPushHealthy(20000);
      if (!live) {
        // TikTok refused this broadcast. One clean retry with a fresh one:
        // stop the publisher first, because an abandoned publish is exactly
        // what the next key has to be allowed to replace.
        try { await aitumStopStreaming({ port: obsPort, password: obsPass }); } catch { }
        await new Promise(r => setTimeout(r, 2500));
        const again = await applyStreamStart();
        // after the mint, not before: applyStreamStart clears the hint line.
        setKeyHint("TikTok refused that broadcast. Retrying with a fresh one…");
        if (again && again.ok !== false) {
          streamKey = String(again.streamKey || "");
          streamUrl = String(again.streamUrl || "");
          setKeyField(keyUrlEl, streamUrl);
          setKeyField(keyValEl, streamKey);
          const sent2 = await pushKeyToAitum();
          if (sent2.ok) live = await waitPushHealthy(20000);
        }
      }
      if (!live) {
        setKeyStatus("LIVE · TikTok not receiving");
        setKeyHint("Aitum is pushing but TikTok is dropping the connection, so " +
          "the live page keeps saying it will start shortly. That is TikTok " +
          "refusing this broadcast, not a fault in the dock. End stream, wait " +
          "about a minute, then press Start stream again." +
          (wantOpen ? " TikFinity was not opened." : ""));
        return;
      }
    }
    if (sent.ok && wantOpen && !alreadyOn) {
      setKeyHint("Aitum is live. Opening TikFinity and attaching chat + events…");
      startEverything();
    } else if (sent.ok && sent.started && !alreadyOn) {
      // Aitum tick only: say plainly that the desk was left shut, so the
      // leftover "waiting…" line cannot read like something is still happening.
      setKeyHint("Aitum is live and pushing to TikTok. Tick \"Open TikFinity\" " +
        "as well if you want the desk, chat and events attached too.");
    }
  });

  // Pushes the key the dock is already holding into the Aitum vertical canvas
  // over the OBS websocket, and optionally starts it going. Never throws: if
  // OBS or the plugin will not take it, the Streamlabs session is still live
  // and the key is still on screen, so a failure is reported as a hint only.
  async function pushKeyToAitum() {
    if (!streamKey || !streamUrl) return { ok: false, extra: "", started: false };
    setObsHint("");
    try {
      await obsSetAitumStream({ port: obsPort, password: obsPass, url: streamUrl, key: streamKey });
      let extra = "";
      let started = false;
      if (obsStartToo.checked) {
        await aitumStartStreaming({ port: obsPort, password: obsPass });
        extra = " · vertical stream started";
        started = true;
      }
      return { ok: true, extra, started };
    } catch (e) {
      const why = String(e.message || e);
      // say the likely cause, not just OBS's raw words
      setObsHint(/vendor/i.test(why)
        ? `${why} — if OBS has been running since before you installed Aitum, restart OBS once.`
        : why);
      return { ok: false, extra: "", started: false };
    }
  }

  /* ---- OBS / Aitum connection ------------------------------------------
   * A wrong or missing websocket password used to fail silently halfway
   * through: Streamlabs opened the session, TikTok showed "streaming, no
   * output", and nothing said why. Check up front and say so plainly. */
  let obsOk = false;
  let obsWhy = "";

  function setObsConn(ok, why, soft) {
    obsOk = ok;
    obsWhy = ok ? "" : (why || "");
    obsConn.hidden = !!ok;          // nothing to say when it is all fine
    obsConn.className = "hintLine" + (soft ? "" : " obsBad");
    obsConn.textContent = why || "";
    // The footer numbers come from the same socket, so they follow it.
    obsStatsKick();
  }

  /* ---- footer: OBS status-bar numbers -------------------------------
   * The dock's own copy of what OBS prints along its bottom bar, so a
   * viewer watching the dock sees frame drops without alt-tabbing:
   *   59 fps · 6.1 Mbps · 0 dropped (0.0%)
   *
   * read live from obs-websocket GetStats rather than the log file,
   * because OBS only writes frame counts when an output STOPS - the log
   * can never tell you what is happening right now.
   * ------------------------------------------------------------------ */

  let obsStatsTimer = null;

  function renderObsStats(s) {
    if (!obsStatsEl) return;
    if (!s) { obsStatsEl.hidden = true; obsStatsEl.textContent = ""; return; }
    const sep = '<span class="oSep">·</span>';
    const fps = Math.round(s.fps || 0);
    const rate = s.kbps > 0 ? `${(s.kbps / 1000).toFixed(1)} Mbps` : "0 Mbps";
    const drops = `${fmtNum(s.droppedFrames)} dropped (${(s.droppedPct || 0).toFixed(1)}%)`;
    obsStatsEl.innerHTML =
      `${fps} fps${sep}${rate}${sep}${drops}`;
    obsStatsEl.hidden = false;
    obsStatsEl.className = "obsStats" + (!s.active ? " idle"
      : s.droppedPct > 5 ? " bad"
      : s.droppedFrames > 0 ? " warn" : "");
    // hover detail, so the short line still answers "is it actually live?"
    obsStatsEl.title = s.active
      ? `OBS output active${s.output ? " (" + s.output + ")" : ""} — ` +
        `${fmtNum(s.totalFrames)} frames out, ${fmtNum(s.droppedFrames)} dropped (${(s.droppedPct || 0).toFixed(2)}%)`
      : "OBS is reachable but no output is running yet";
  }

  async function pollObsStats() {
    clearTimeout(obsStatsTimer);
    // Nothing to show without a working password, and the loop self-heals:
    // checkObs() calls obsStatsKick() again once OBS answers.
    if (!obsOk || !obsStatsEl) { renderObsStats(null); return; }
    try { renderObsStats(await obsStats({ port: obsPort, password: obsPass })); }
    catch { renderObsStats(null); }
    obsStatsTimer = setTimeout(pollObsStats, 3000);
  }

  function obsStatsKick() { clearTimeout(obsStatsTimer); pollObsStats(); }

  async function checkObs() {
    if (!obsPass) {
      setObsConn(false,
        "No OBS password yet. Start stream needs it to push the key into Aitum - " +
        "Tools > WebSocket Server in OBS, then add that password under " +
        "Settings (⋮) > Setup > Connections.", true);
      return false;
    }
    try {
      await obsVersion({ port: obsPort, password: obsPass });
      setObsConn(true, "");
      return true;
    } catch (e) {
      // OBS's own message already names the port it could not reach, so the
      // old "OBS not reachable on port N: Cannot reach OBS on port N" said it
      // twice. Keep whichever sentence exists rather than both.
      setObsConn(false, String(e.message || e) || `OBS not reachable on port ${obsPort}`);
      return false;
    }
  }

  // Aitum's Go Live only asks it to connect; RTMP takes a second or two to
  // land. TikFinity refuses to attach while TikTok still reports no output,
  // so wait for the canvas to actually say it is streaming before opening it.
  // Is TikTok actually being fed? The Aitum plugin's own `streaming` flag is
  // set when Go Live is pressed and stays set through a reconnect loop, so it
  // cannot tell a working push from a refused one. The helper reads OBS's log
  // instead: healthy means the RTMP socket is up and has not cycled since the
  // last Go Live.
  async function waitPushHealthy(timeoutMs) {
    const until = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < until) {
      const st = await helperGet("/obs/push");
      if (st && st.ok) {
        last = st;
        if (st.connected && !st.reconnects) return true;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    return !!(last && last.connected && !last.reconnects);
  }

  keyEndBtn.addEventListener("click", async () => {
    if (sessionState !== "live") return;
    setSessionState("ending", "");
    setKeyStatus("ending…");

    // Streamlabs has no end-session API — tiktok/stream/end answers every
    // method except OPTIONS with 405, so an End button that called it just
    // looked like it worked while the broadcast stayed up. What actually
    // closes a broadcast is the RTMP client disconnecting, so stop Aitum.
    clearStreamFields();
    sessionForget();
    let note;
    try {
      if (await aitumStatus({ port: obsPort, password: obsPass })) {
        await aitumStopStreaming({ port: obsPort, password: obsPass });
        note = "Aitum stopped pushing, so TikTok closes the broadcast. " +
          "Start again whenever you are ready.";
      } else {
        note = "Nothing was pushing in Aitum, so the broadcast was already closed.";
      }
    } catch (e) {
      note = "Aitum could not be reached (" + String(e.message || e) +
        "). Press Stop in Aitum by hand - until then it keeps pushing a dead key.";
    }
    setSessionState("idle", note);
    setKeyStatus("ended");
  });

  obsPortInput.addEventListener("change", () => {
    const v = Math.max(1, Math.min(65535, Math.floor(+obsPortInput.value || 4455)));
    obsPort = v;
    obsPortInput.value = v;
    saveObs();
    checkObs();
  });
  obsPassInput.addEventListener("change", () => {
    obsPass = obsPassInput.value;
    saveObs();
    checkObs();
  });

  loadObs();
  obsPortInput.value = obsPort;
  obsPassInput.value = obsPass;
  checkObs();               // say straight away if Aitum cannot be reached
  obsStatsKick();           // footer numbers, once checkObs says OBS is up
  refreshAccount();          // paints "Connected as @you" / "No account connected"

  // A session we started earlier and never ended must not be forgotten: a
  // reload would otherwise leave a broadcast session open with no way to close
  // it. Put the last title/category back too, so one tap re-uses them.
  (function restoreSession() {
    draftRestore();
    restoreTicks();
    const saved = sessionRecall();
    if (!saved || !saved.at) return;
    if (keyTitleInput.value === "" && saved.title) keyTitleInput.value = saved.title;
    if (keyCategoryInput.value === "" && saved.category) keyCategoryInput.value = saved.category;
    const when = new Date(saved.at);
    const hhmm = isNaN(when) ? "" : when.toTimeString().slice(0, 5);
    setSessionState("live",
      `A broadcast was started at ${hhmm} and never ended here. Press End stream to ` +
      `close it - starting a new one now would only leave TikTok watching an ` +
      `orphan.`);
    setKeyStatus("live?");
  })();

  /* ------------------------------------------------------------------ *
   *  Manual start — the ONE place the whole system comes alive
   * ------------------------------------------------------------------ */
  // Asks the chat bridge to start TikFinity. Uses an <img> request on purpose:
  // the dock is loaded from file:// inside OBS, where fetch() to http:// is
  // cross-origin and can be refused outright — an image request never is.
  // Resolves true when the bridge answered, false when it didn't.
  function requestLaunch() {
    return new Promise(resolve => {
      let settled = false;
      const done = v => { if (!settled) { settled = true; resolve(v); } };
      const img = new Image();
      img.onload = () => done(true);
      img.onerror = () => done(false);
      setTimeout(() => done(false), 4000);
      img.src = `http://127.0.0.1:${bridgePort}/launch?t=${Date.now()}`;
    });
  }

  // Clicking Reconnect (or the status dot) does everything, in order:
  //   1. asks the chat bridge to start TikFinity Desktop
  //   2. keeps trying the Event API (21213) while the app boots
  //   3. attaches to the chat bridge so chat sending works
  // It gives up after 90s and simply shows the Reconnect button again.
  async function startEverything() {
    if (demoMode) return;
    const run = ++manualConnectRun;
    const dead = () => run !== manualConnectRun;

    clearTimeout(reconnectTimer);
    reconnectAttempts = 0;
    endpointIndex = 0;
    socket = null;

    // 1. start TikFinity through the bridge (a browser page can't spawn
    //    processes, and the bridge is already running in the background)
    setFootStatus("starting TikFinity…");
    setDot("connecting", "Starting TikFinity Desktop…");
    const bridgeAlive = await requestLaunch();
    if (dead()) return;

    // 2. attach to the bridge for chat sending
    connectBridge();

    if (!bridgeAlive) {
      // Say WHY, instead of spinning silently for 90s. If TikFinity is
      // already running the Event API will still connect below — so this is
      // a warning, not a stop.
      setDot("connecting", "Chat bridge not running — start it with SETUP.bat (TikFinity can't be launched for you)");
      setFootStatus("chat bridge not running — run SETUP.bat");
    }

    // 3. keep trying the Event API while the app boots
    const deadline = Date.now() + 90000;
    while (!dead() && Date.now() < deadline) {
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        connect();
        // connect() repaints the header on every attempt — re-assert the real
        // reason so the dock doesn't just blink "Connecting…" for 90 seconds
        if (!bridgeAlive) {
          setFootStatus("chat bridge not running — run SETUP.bat");
          setDot("connecting", "Chat bridge not running — start it with SETUP.bat (TikFinity can't be launched for you)");
        } else {
          setFootStatus("waiting for TikFinity…");
        }
      }
      if (socket && socket.readyState === WebSocket.OPEN) {
        setFootStatus(ENDPOINTS[endpointIndex % ENDPOINTS.length]);
        return;
      }
      await new Promise(r => setTimeout(r, 1500));
    }
    if (dead()) return;
    if (!bridgeAlive) {
      setDot("disconnected", "Chat bridge not running — TikFinity can't be started for you. Run SETUP.bat, then Reconnect again.");
      retryBtn.hidden = false;
      setFootStatus("chat bridge not running — run SETUP.bat");
      return;
    }
    showDisconnected();
  }

  /* ------------------------------------------------------------------ *
   *  Demo mode
   * ------------------------------------------------------------------ */

  // Offline-safe demo avatars (real streams use TikTok's CDN URLs
  // via profilePictureUrl + the mirror list in userDetails).
  const AV = (name, bg) => {
    const ch = ([...String(name).trim()][0] || "?").toUpperCase();
    return "data:image/svg+xml," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="${bg || "2b2c32"}"/><text x="24" y="31" font-size="19" text-anchor="middle" fill="#efeff1" font-family="Segoe UI, Arial" font-weight="700">${ch}</text></svg>`
    );
  };

  // Diamond glyph used in event payloads (demo + real streams render the
  // same icon; gift ARTWORK comes from giftPictureUrl on live events).
  const GIFT_PLACEHOLDER = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="6" y="14" width="36" height="26" rx="4" fill="none" stroke="#e8b54a" stroke-width="3"/><rect x="4" y="8" width="40" height="8" rx="2" fill="#e8b54a"/><rect x="21" y="8" width="6" height="32" fill="#372c1c" stroke="#e8b54a" stroke-width="2"/></svg>'
  );
  const GIFT_ROSE = GIFT_PLACEHOLDER;
  const GIFT_FINGER_HEART = GIFT_PLACEHOLDER;
  const GIFT_TIKTOK = GIFT_PLACEHOLDER;

  /* Demo script — payload shapes copied from what TikFinity really sends.
     The point is fidelity: every event here uses the same field names and
     nesting as the live connector, so demo mode exercises the real render
     paths (emote splicing, avatar mirror fallback, like batching/coalescing,
     streak vs non-streak gifts, follower counts, leaderboard maths) instead
     of a prettier-but-different simulation. */
  const DEMO_EMOTE = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><text x="24" y="34" font-size="30" text-anchor="middle">\u2764\uFE0F</text></svg>'
  );

  const DEMO_STREAM = [
    // --- what TikFinity really sends the moment you hit connect: these two
    // --- are housekeeping and the dock must show NO row for them
    [200,   () => addEvent("config", { events: [] }, true)],
    [260,   () => addEvent("state_update", { actions_toggle_state: 1, sounds_toggle_state: 1, tts_toggle_state: 0, chatbot_toggle_state: 0 }, true)],
    [400,   () => addEvent("liveStatusChange", { status: "live" }, true)],

    // --- room settles in: topViewers entries are {user:{...}, coinCount}
    [900,   () => addEvent("roomUser", { topViewers: [], topGifterRank: 0, viewerCount: 3 }, true)],

    // --- the host's own chat: isAnchor + followerCount rides along on every
    // --- event the anchor produces, which is how we learn their name/pfp
    [1300,  () => addEvent("chat", {
              comment: "\u0633\u0644\u0627\u0645 \u0639\u0644\u064a\u0643\u0645",
              contentLanguage: "ar",
              userIdentity: { isAnchor: true },
              userId: "7547", uniqueId: "demo.host", nickname: "Demo Host",
              profilePictureUrl: AV("ZZ", "3a242b"),
              userDetails: { profilePictureUrls: [AV("ZZ", "3a242b")] }
            }, true)],

    // --- a plain viewer joins (member)
    [1800,  () => addEvent("member", { actionId: 1, userId: "6797", uniqueId: "demo.viewer1", nickname: "DemoViewer1", profilePictureUrl: AV("demo.viewer1") }, true)],

    // --- likes arrive BATCHED, like the real connector: one event can carry
    // --- 15 taps from one person, and repeat-fire in quick succession
    [2200,  () => addEvent("like", { likeCount: 15, totalLikeCount: 145, userId: "6797", uniqueId: "demo.viewer1", nickname: "DemoViewer1", profilePictureUrl: AV("demo.viewer1") }, true)],
    [2450,  () => addEvent("like", { likeCount: 15, totalLikeCount: 160, userId: "6797", uniqueId: "demo.viewer1", nickname: "DemoViewer1", profilePictureUrl: AV("demo.viewer1") }, true)],
    [2700,  () => addEvent("like", { likeCount: 14, totalLikeCount: 174, userId: "6797", uniqueId: "demo.viewer1", nickname: "DemoViewer1", profilePictureUrl: AV("demo.viewer1") }, true)],

    // --- subscriber chat carrying emoteList (emotes are a subscriber perk,
    // --- positions are character offsets into the comment)
    [3200,  () => addEvent("chat", {
              comment: "first stream here \u2764\uFE0F\uD83D\uDC4B",
              contentLanguage: "en",
              userId: "6797", uniqueId: "demo.viewer1", nickname: "DemoViewer1",
              profilePictureUrl: AV("demo.viewer1"),
              userDetails: { profilePictureUrls: [AV("demo.viewer1")] },
              isSubscriber: true,
              emoteList: [
                { position: 15, imageUrl: DEMO_EMOTE, emote: { imageUrl: DEMO_EMOTE } },
                { position: 18, imageUrl: DEMO_EMOTE, emote: { imageUrl: DEMO_EMOTE } }
              ]
            }, true)],

    // --- moderator chat
    [3700,  () => addEvent("chat", { comment: "W streamer, welcome!", userId: "111", uniqueId: "fanboy99", nickname: "fanboy99", profilePictureUrl: AV("F", "233246"), isModerator: true }, true)],

    // --- follow: followInfo.followerCount is the STREAMER's follower total
    [4100,  () => addEvent("follow", { userId: "6797", uniqueId: "demo.viewer1", nickname: "DemoViewer1", followInfo: { followingCount: 12, followerCount: 1001 } }, true)],

    // --- avatar mirror fallback: only userDetails.profilePictureUrls has a
    // --- working URL, exactly the live case that used to show a broken image
    [4500,  () => addEvent("chat", {
              comment: "no avatar on this one",
              userId: "222", uniqueId: "quietone", nickname: "quietone",
              profilePictureUrl: "",
              userDetails: { profilePictureUrls: [AV("q", "3b3b44")] }
            }, true)],

    [4900,  () => addEvent("roomUser", {
              topViewers: [{ user: { uniqueId: "demo.viewer1", nickname: "DemoViewer1" }, coinCount: 0 }],
              topGifterRank: 0, viewerCount: 6, totalUser: 6
            }, true)],

    // --- STREAMABLE gift: repeatEnd false -> held, then the streak ends and
    // --- ONE row appears carrying the final count (never one row per tap)
    [5300,  () => addEvent("gift", { giftId: "55", giftName: "Rose", repeatCount: 1, repeatEnd: false, giftType: 1, diamondCount: 1, giftPictureUrl: GIFT_ROSE, userId: "6797", uniqueId: "demo.viewer1", nickname: "DemoViewer1", profilePictureUrl: AV("demo.viewer1") }, true)],
    [5700,  () => addEvent("gift", { giftId: "55", giftName: "Rose", repeatCount: 3, repeatEnd: false, giftType: 1, diamondCount: 1, giftPictureUrl: GIFT_ROSE, userId: "6797", uniqueId: "demo.viewer1", nickname: "DemoViewer1", profilePictureUrl: AV("demo.viewer1") }, true)],
    [6100,  () => addEvent("gift", { giftId: "55", giftName: "Rose", repeatCount: 5, repeatEnd: true, giftType: 1, diamondCount: 1, giftPictureUrl: GIFT_ROSE, userId: "6797", uniqueId: "demo.viewer1", nickname: "DemoViewer1", profilePictureUrl: AV("demo.viewer1") }, true)],

    // --- NON-streakable gift (giftType 0): must render immediately, no hold
    [6600,  () => addEvent("gift", { giftId: "8196", giftName: "Heart", repeatCount: 1, giftType: 0, diamondCount: 1, giftPictureUrl: GIFT_FINGER_HEART, userId: "927", uniqueId: "user927", nickname: "\u0627\u0644\u0037\u0031\u0031\u0645\u0627\u0644\u0643\u064a", profilePictureUrl: AV("\u0627", "5a3a2e") }, true)],

    // --- gift with the giftImage list shape + describe text, first-time gifter
    [7100,  () => addEvent("gift", {
              giftId: "5655", giftName: "Galaxy", repeatCount: 1, repeatEnd: true, giftType: 0, diamondCount: 1000,
              isNewGifter: true, describe: "sent a Galaxy",
              giftImage: { giftImageurlList: [GIFT_TIKTOK] },
              giftDetails: { giftName: "Galaxy", diamondCount: 1000 },
              userId: "927", uniqueId: "user927", nickname: "\u0627\u0644\u0037\u0031\u0031\u0645\u0627\u0644\u0643\u064a",
              profilePictureUrl: AV("\u0627", "5a3a2e")
            }, true)],

    // --- subscribe + share (social group)
    [7600,  () => addEvent("subscribe", { userId: "333", uniqueId: "demo_sub_user", nickname: "Demo Subscriber", profilePictureUrl: AV("D", "2f4a3a") }, true)],
    [7900,  () => addEvent("share", { userId: "6797", uniqueId: "demo.viewer1", nickname: "DemoViewer1", displayType: "pm_main_follow_message_viewer_2" }, true)],

    [8400,  () => addEvent("roomUser", {
              topViewers: [
                { user: { uniqueId: "demo.viewer1", nickname: "DemoViewer1" }, coinCount: 5 },
                { user: { uniqueId: "user927", nickname: "\u0627\u0644\u0037\u0031\u0031\u0645\u0627\u0644\u0643\u064a" }, coinCount: 1001 }
              ],
              topGifterRank: 1, viewerCount: 9, totalUser: 9
            }, true)],

    // --- arabic chat from a top gifter, plus a final rapid like burst from a
    // --- second liker (exercises the coalescer with two independent users)
    [8800,  () => addEvent("chat", { comment: "\u0623\u0633\u062a\u0645\u0631 \u064a\u0627 \u0648\u062d\u0634 \uD83D\uDD25", contentLanguage: "ar", userId: "927", uniqueId: "user927", nickname: "\u0627\u0644\u0037\u0031\u0031\u0645\u0627\u0644\u0643\u064a", profilePictureUrl: AV("\u0627", "5a3a2e") }, true)],
    [9000,  () => addEvent("like", { likeCount: 15, totalLikeCount: 189, userId: "927", uniqueId: "user927", nickname: "\u0627\u0644\u0037\u0031\u0031\u0645\u0627\u0644\u0643\u064a", profilePictureUrl: AV("\u0627", "5a3a2e") }, true)],
    [9300,  () => addEvent("like", { likeCount: 15, totalLikeCount: 204, userId: "927", uniqueId: "user927", nickname: "\u0627\u0644\u0037\u0031\u0031\u0645\u0627\u0644\u0643\u064a", profilePictureUrl: AV("\u0627", "5a3a2e") }, true)]
  ];
  function startDemo() {
    demoMode = true;
    retryBtn.hidden = true;
    if (socket) {
      try { socket.close(); } catch { /* noop */ }
      socket = null;
    }
    demoInfo.textContent = "demo";
    demoInfo.classList.add("demoOn");
    demoInfo.hidden = false;
    if (demoSep) demoSep.hidden = false;
    demoBtn.textContent = "Stop demo";
    setDot("demo", "Demo replay — events are scripted");
    for (const [delay, fn] of DEMO_STREAM) {
      demoTimers.push(setTimeout(fn, delay));
    }
    // Keep a slow viewer heartbeat running for the WHOLE demo, like the real
    // connector does. Without it the script fires once and stops, so after a
    // "Clear feed" (which resets the count so it can relearn) nothing would
    // ever arrive to relearn from and the pill would sit at "–" forever.
    demoViewers = 3;
    demoTimers.push(setInterval(() => {
      // gentle drift up and down, the way a real room behaves
      demoViewers += Math.random() < 0.65 ? 1 : -1;
      if (demoViewers < 1) demoViewers = 1;
      addEvent("roomUser", {
        viewerCount: demoViewers,
        topViewers: [],
        topGifterRank: 0
      }, true);
    }, 4000));
  }

  function stopDemo() {
    demoMode = false;
    for (const t of demoTimers) { clearTimeout(t); clearInterval(t); }
    demoTimers = [];
    demoInfo.hidden = true;
    if (demoSep) demoSep.hidden = true;
    demoInfo.classList.remove("demoOn");
    demoBtn.textContent = "Demo data";
    // Starting the demo closed the real connector, so every row, counter and
    // name on screen while it ran came from the script. Stopping it throws the
    // sample session away rather than letting the first real stream inherit a
    // demo host, 1,001 demo followers and a demo "chatbot is off" flag.
    clearStreamIdentity();
    clearAll(true);
    connect();
  }

  /* ------------------------------------------------------------------ *
   *  Cross-dock command bus — the controls dock drives the feed dock
   *  through localStorage storage events (same file origin).
   * ------------------------------------------------------------------ */

  const CMD_KEY = "tfDock.cmd.v1";
  let lastCmdN = 0;
  let cmdSeq = 0;

  function sendCmd(cmd) {
    try {
      localStorage.setItem(CMD_KEY, JSON.stringify({ n: Date.now() * 100 + (++cmdSeq % 100), ...cmd }));
    } catch { /* storage unavailable */ }
  }

  function handleCmd(m) {
    if (m.type === "poll_start") beginPoll(String(m.q || ""), Array.isArray(m.opts) ? m.opts.slice(0, 6) : []);
    else if (m.type === "poll_end") pollEnd(true, false);
    else if (m.type === "clear") clearAll(false);
    else if (m.type === "demo") { if (!demoMode) startDemo(); }
  }

  function applyRemoteSettings(s) {
    if (s.filters) {
      Object.assign(filters, s.filters);
      for (const [g, c] of Object.entries(filterChecks)) c.checked = filters[g];
      for (const el of feedEl.querySelectorAll("[data-group]")) applyVisibility(el);
    }
    if (s.boardShow) {
      Object.assign(boardShow, s.boardShow);
      for (const [n, c] of Object.entries(boardChecks)) c.checked = boardShow[n];
      renderTopGifters();
    }
    if (typeof s.soundOn === "boolean") { soundOn = s.soundOn; soundCheck.checked = soundOn; }
    if (Number.isFinite(+s.soundBig)) { soundBig = +s.soundBig; soundBigInput.value = soundBig; }
    if (Number.isFinite(+s.bridgePort)) {
      const p = Math.max(1, Math.min(65535, Math.floor(+s.bridgePort)));
      if (p !== bridgePort) {
        bridgePort = p;
        bridgePortInput.value = p;
        if (bridgeSocket) { try { bridgeSocket.close(); } catch { /* noop */ } }
        connectBridge();
      }
    }
    if (s.goal && typeof s.goal === "object") {
      if (typeof s.goal.on === "boolean") goal.on = s.goal.on;
      if (s.goal.type === "followers" || s.goal.type === "likes" || s.goal.type === "diamonds") goal.type = s.goal.type;
      if (Number.isFinite(+s.goal.target) && +s.goal.target >= 1) goal.target = Math.floor(+s.goal.target);
      goalOnCheck.checked = goal.on;
      goalTypeSel.value = goal.type;
      goalTargetInput.value = goal.target;
      renderGoal();
    }
  }

  window.addEventListener("storage", e => {
    if (e.key === CMD_KEY && e.newValue) {
      try {
        const m = JSON.parse(e.newValue);
        if (m && typeof m.n === "number" && m.n > lastCmdN) { lastCmdN = m.n; handleCmd(m); }
      } catch { /* ignore malformed */ }
    } else if (e.key === LS_KEY && e.newValue) {
      try {
        const s = JSON.parse(e.newValue);
        if (s && s.settings) applyRemoteSettings(s.settings);
      } catch { /* ignore */ }
    }
  });

  /* ------------------------------------------------------------------ *
   *  Chat sending — the dock relays lines to a tiny local bridge
   *  (chat-bridge.js). TikFinity ALSO connects to that bridge (Setup →
   *  Streamer.bot Connection) and posts every "sendChatbotMessage" it
   *  receives to TikTok chat as the logged-in account. No cookies, no
   *  bot accounts: TikFinity's own login does the authenticating.
   * ------------------------------------------------------------------ */

  // Declared ABOVE the functions that read it, not beside its only other
// user: setChatState -> renderChatSendState runs from startEverything() and
// restoreState(), both far above here, so a const left down here would be a
// temporal-dead-zone trap for anyone who later moves a call earlier.
const CHATBOT_OFF_MSG = "TikFinity's Chatbot is switched off, so it accepts the " +
    "message and throws it away (it toasts \"Streamer.bot sent a chat message, " +
    "but your chatbot is switched off\"). In TikFinity turn the Chatbot toggle ON - " +
    "Setup > Chatbot - and this sends immediately.";
const CHAT_OK_MSG = "Chat bridge connected - messages will reach TikTok chat";

  function setChatState(mode, tooltip) {
    bridgeState = mode;
    chatStatus.className = `sStatus ${mode}`;
    chatStatus.textContent = mode === "ok" ? "connected"
      : mode === "busy" ? "connecting…"
      : "bridge not running";
    chatStatus.title = tooltip;
    // setup instructions only when something is actually wrong
    if (bridgeHint) bridgeHint.hidden = mode !== "bad";
    renderChatSendState();
  }

  // The bridge being connected is only half the story: TikFinity also drops
  // every send while ITS OWN Chatbot toggle is off, and says so in a toast
  // nobody reads. Show the real answer in the same status line.
  function renderChatSendState() {
    if (!chatStatus) return;
    if (chatbotOn === false && bridgeState === "ok") {
      chatStatus.className = "sStatus bad";
      chatStatus.textContent = "chatbot off in TikFinity";
      chatStatus.title = CHATBOT_OFF_MSG;
      if (bridgeHint) { bridgeHint.hidden = true; }
      return;
    }
    // ...and back again. The warning has a way OUT: flipping the toggle ON in
    // TikFinity (its next state_update says so), or throwing a demo session
    // away, must clear the line. Without this the dock kept accusing you of a
    // switched-off chatbot for the rest of the stream.
    if (bridgeState === "ok") {
      chatStatus.className = "sStatus ok";
      chatStatus.textContent = "connected";
      chatStatus.title = CHAT_OK_MSG;
    }
  }

  function connectBridge() {
    if (bridgeSocket && (bridgeSocket.readyState === WebSocket.OPEN || bridgeSocket.readyState === WebSocket.CONNECTING)) return;
    setChatState("busy", "Connecting to chat bridge…");
    let ws;
    try { ws = new WebSocket(`ws://127.0.0.1:${bridgePort}/`); }
    catch { setChatState("bad", "Chat bridge not reachable — run chat-bridge.js"); return; }
    bridgeSocket = ws;

    ws.addEventListener("open", () => {
      if (bridgeSocket !== ws) return;
      setChatState("ok", CHAT_OK_MSG);
    });
    ws.addEventListener("message", ev => {
      if (bridgeSocket !== ws) return;
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      // another dock sent a chat line — show it here too
      if (m && m.action === "sendChatbotMessage" && m.args && typeof m.args.message === "string") {
        renderOwnChat(String(m.args.message));
      }
      // the bridge's honest answer to "did that go anywhere?"
      if (m && m.action === "chatAck") {
        if (m.args && m.args.ok === false) {
          showChatProblem(m.args.error || "The message was not delivered.");
        }
      }
    });
    ws.addEventListener("close", () => {
      if (bridgeSocket !== ws) return;
      bridgeSocket = null;
      setChatState("bad", "Chat bridge not reachable — run chat-bridge.js, then click here");
    });
    ws.addEventListener("error", () => { /* close event follows */ });
  }

  // optimistic local row: shows instantly, deduped if TikTok echoes it back.
  // Deliberately NOT flagged isAnchor — that flag is reserved for real events
  // from TikTok, and is what lets the echo dedupe recognise our own message.
  function renderOwnChat(text) {
    addEvent("chat", {
      comment: text,
      uniqueId: streamerUid || "me",
      nickname: streamerName || "You",
      profilePictureUrl: streamerAvatar || undefined,
      __ownSend: true
    }, true);
  }

  // Something went wrong with a send, and the user has to be told here.
  // Without this the bar drew the message, cleared the box and said nothing,
  // so a dropped message looked exactly like a delivered one.
  let chatProblemTimer = null;
  function showChatProblem(text) {
    if (!chatBar) return;
    chatBar.classList.add("bad");
    chatBar.title = text || "";
    if (chatHint) {
      chatHint.textContent = text || "That message was not delivered.";
      chatHint.hidden = false;
    }
    clearTimeout(chatProblemTimer);
    chatProblemTimer = setTimeout(() => {
      if (chatHint) chatHint.hidden = true;
      chatBar.classList.remove("bad");
    }, 9000);
  }

  function submitChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    // TikFinity's own Chatbot toggle is off: the send is accepted by the
    // bridge, relayed to TikFinity, and then silently dropped there. Refuse
    // it here with the exact switch to flip, rather than letting the message
    // vanish after the dock has already drawn it.
    if (chatbotOn === false) { showChatProblem(CHATBOT_OFF_MSG); return; }
    // TikTok only has a chat room while a broadcast is actually running, so a
    // message sent when we KNOW the stream is offline is always thrown away.
    // Refuse it and say why, instead of drawing it locally and letting it
    // disappear. (Unknown state still sends: our liveness can lag reality,
    // and the bridge's ack still catches a genuinely undelivered message.)
    if (lastLiveState === false) {
      showChatProblem("You are not live, so there is no TikTok chat to post into " +
        "- this would be dropped. Start the stream, then send it.");
      return;
    }
    if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
      chatBar.classList.add("bad");
      setTimeout(() => chatBar.classList.remove("bad"), 600);
      connectBridge();
      return;
    }
    try {
      bridgeSocket.send(JSON.stringify({ action: "sendChatbotMessage", args: { message: text } }));
    } catch {
      setChatState("bad", "Chat bridge not reachable — run chat-bridge.js");
      return;
    }
    renderOwnChat(text);
    chatInput.value = "";
  }

  chatBar.addEventListener("submit", e => { e.preventDefault(); submitChat(); });
  bridgeRetryBtn.addEventListener("click", connectBridge);

  bridgePortInput.addEventListener("change", () => {
    const v = Math.max(1, Math.min(65535, Math.floor(+bridgePortInput.value || 8080)));
    bridgePort = v;
    bridgePortInput.value = v;
    scheduleSave();
    if (bridgeSocket) { try { bridgeSocket.close(); } catch { /* noop */ } }
    connectBridge();
  });

  setInterval(() => { if (!bridgeSocket || bridgeSocket.readyState === WebSocket.CLOSED) connectBridge(); }, 15000);

  /* ------------------------------------------------------------------ *
   *  Session panel + summary
   * ------------------------------------------------------------------ */

  function fmtDur(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
  }

  // One word in the header, so the section still says something while it is
  // collapsed - the same idiom every other section uses.
  function updateSessionPanel() {
    if (!sessStatusEl) return;
    sessStatusEl.textContent = firstEventAt ? fmtDur(Date.now() - firstEventAt) : "";
  }
  setInterval(updateSessionPanel, 1000);

  // The summary is text, not markup, but a handle still has to be isolated or
  // its own direction drags the count beside it: "1. المالكي (30)" drew as
  // "1. (30) المالكي", which reads as a formatting bug rather than a name.
  // So each line is a list of segments — plain strings, plus { name } for the
  // handles. Drawing puts the names inside <bdi>; copying joins the plain
  // strings only, so no isolate characters ever reach the clipboard.
  function summaryLines() {
    const up = firstEventAt ? fmtDur(Date.now() - firstEventAt) : "–";
    const lines = [
      ["TikTok LIVE summary"],
      [`Live for: ${up}`],
      [`Peak viewers: ${peakViewers ? fmtNum(peakViewers) : "–"}`],
      [`Likes: ${totalLikes == null ? "–" : fmtNum(totalLikes)} · Diamonds: ${fmtNum(diamonds)}`]
    ];
    if (followsGained) lines.push([`New followers: +${fmtNum(followsGained)}`]);
    const board = (label, rows, valueKey) => {
      if (!rows.length) return;
      lines.push([`${label}: `, ...rows.flatMap((t, i) => [
        ...(i ? [" · "] : []),
        `${i + 1}. `,
        { name: t.name },
        ` (${fmtNum(t[valueKey])})`
      ])]);
    };
    board("Top gifters", boardRows(gifterTotals, "coins"), "coins");
    board("Top likers", boardRows(likerTotals, "likes").slice(0, 3), "likes");
    return lines;
  }

  function summaryPlain(lines) {
    return lines.map(segs => segs.map(s => (typeof s === "string" ? s : s.name)).join("")).join("\n");
  }

  /* ------------------------------------------------------------------ *
   *  Settings sheet wiring
   * ------------------------------------------------------------------ */

  menuBtn.addEventListener("click", () => {
    sheetEl.hidden = false;
    ensureAudio();
    renderUpdates();
  });

  sheetClose.addEventListener("click", () => { sheetEl.hidden = true; });

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    
    if (!CONTROLS) sheetEl.hidden = true;
  });

  // The text the summary would copy right now, built alongside its rows so a
  // click never has to read the words back out of the DOM.
  let summaryCopy = "";

  // Opening the Session section is the request for its summary — there is no
  // second button. It is built here, freshly, both on open and on load, so it
  // is a still snapshot of this moment rather than a number that keeps moving
  // while you read or select it.
  function renderSessionSummary() {
    if (!summaryText) return;
    // Nothing has happened yet this load. A block of dashes reads as broken,
    // so it says what it will hold instead.
    const lines = firstEventAt
      ? summaryLines()
      : [["Nothing captured yet — go live and this fills in by itself."]];
    summaryCopy = summaryPlain(lines);
    summaryText.textContent = "";
    for (const segs of lines) {
      const row = document.createElement("div");
      row.className = "sumLine";
      for (const s of segs) {
        if (typeof s === "string") {
          row.appendChild(document.createTextNode(s));
        } else {
          const b = document.createElement("bdi");
          b.textContent = s.name;
          row.appendChild(b);
        }
      }
      summaryText.appendChild(row);
    }
  }
  renderSessionSummary();

  // Copy is still a bonus. Its feedback borrows the caption line for a moment
  // instead of keeping a "tap to copy" hint on screen forever.
  let sessSayTimer = 0;
  function flashSessSay(text) {
    if (!sessSay) return;
    clearTimeout(sessSayTimer);
    sessSay.textContent = text;
    sessSayTimer = setTimeout(() => { sessSay.textContent = SESS_SAY; }, 1500);
  }

  summaryText.addEventListener("click", () => {
    renderSessionSummary();                 // copy the freshest numbers
    const text = summaryCopy;
    if (!text) return;
    writeClipboard(text).then(ok => flashSessSay(ok
      ? "Copied ✓"
      : "Could not copy — select the text by hand"));
  });

  /* ---- updates wiring --------------------------------------------------- */

  updCheckBtn.addEventListener("click", () => runUpdateCheck());
  updApplyBtn.addEventListener("click", () => runUpdateApply());
  updAutoCheck.addEventListener("change", () => {
    updAuto = updAutoCheck.checked;
    scheduleSave();
  });
  // Keep the panel honest while it is on screen: the bridge and the updater
  // both change underneath the dock without telling it.
  setInterval(() => {
    if (sheetEl.hidden) return;
    renderUpdates();
  }, 2500);

    for (const [group, check] of Object.entries(filterChecks)) {
      check.addEventListener("change", () => {
        filters[group] = check.checked;
        for (const el of feedEl.querySelectorAll("[data-group]")) {
          if (el.dataset.group === group) applyVisibility(el);
        }
        scheduleSave();
      });
    }

    for (const [name, check] of Object.entries(boardChecks)) {
      check.addEventListener("change", () => {
        boardShow[name] = check.checked;
        renderTopGifters();
        scheduleSave();
      });
    }

    soundCheck.addEventListener("change", () => {
      soundOn = soundCheck.checked;
      scheduleSave();
    });

    soundBigInput.addEventListener("change", () => {
      const v = Math.max(1, Math.floor(+soundBigInput.value || 99));
      soundBig = v;
      soundBigInput.value = v;
      scheduleSave();
    });

    pollStartBtn.addEventListener("click", pollStart);
    pollEndBtn.addEventListener("click", () => pollEnd(true));

    goalOnCheck.addEventListener("change", () => {
      goal.on = goalOnCheck.checked;
      renderGoal();
      scheduleSave();   // LS_KEY write syncs the other dock via applyRemoteSettings
    });

    goalTypeSel.addEventListener("change", () => {
      goal.type = goalTypeSel.value;
      renderGoal();
      scheduleSave();
    });

    goalTargetInput.addEventListener("change", () => {
      const v = Math.max(1, Math.floor(+goalTargetInput.value || 500));
      goal.target = v;
      goalTargetInput.value = v;
      renderGoal();
      scheduleSave();
    });

    welcomeCloseBtn.addEventListener("click", () => {
      welcomeEl.hidden = true;
      welcomed = true;
      scheduleSave();
    });

  // Clearing the FEED is not the same as ending the stream. Manual clear
  // wipes the rows and feed-derived totals but KEEPS live population facts
  // (current viewers, peak viewers, stream like total, follows) — those
  // describe the stream that is still running. Only a genuine new stream
  // (offline → live) resets those, because then they describe a different
  // stream with a different audience.
  // Forget everything the dock LEARNED about the room: who the streamer is,
  // their follower total, the milestone already announced, the last live /
  // offline state, and TikFinity's chatbot toggle. Used when the whole session
  // is discarded (stop demo), because a value that only ever arrived inside
  // the replay is worse than no value at all: it would leave the next real
  // stream celebrating a demo's follower milestone and the chat panel blocked
  // by a chatbot state nobody set.
  function clearStreamIdentity() {
    streamerUid = "";
    streamerName = "";
    streamerAvatar = "";
    streamerFollowers = 0;
    milestoneHit = 0;
    lastLiveState = null;
    chatbotOn = null;
    likeRows.clear();
    recentOwnSends.clear();
    renderChatSendState();
    updateHud();
  }

  function clearAll(newStream = false) {
    setUserFilter(null);
    recentOwnSends.clear();
    likeRows.clear();
    feedEl.querySelectorAll(".item").forEach(el => el.remove());
    oldestItem = null;
    itemCount = 0;
    sessionTotal = 0;
    diamonds = 0;
    firstEventAt = 0;
    gifterTotals.clear();
    likerTotals.clear();
    rankByUser.clear();
    rankByLiker.clear();
    pendingStreaks.clear();
    poll.active = false;
    poll.opts = [];
    poll.votes.clear();
    pollBox.hidden = true;
    renderPollMenuState();
    renderTopGifters();

    if (newStream) {
      viewers = null;        // fresh stream → wait for its own roomUser
      peakViewers = 0;
      totalLikes = null;
      followsGained = 0;
      milestoneHit = 0;
    } else {
      // Manual clear: forget the audience + stream like total so the dock
      // can't sit on a stale number, then RELEARN from the live feed. Safe
      // now because ingestViewerCount reads the count off ANY event, so the
      // first roomUser (or any event carrying a count) restores it within
      // seconds instead of the pill staying blank for the whole stream.
      viewers = null;
      totalLikes = null;
      // peak stays: it's a high-water mark for the session, not a live value
    }

    saveState();
    pendingCount = 0;
    paused = false;
    pausePill.style.display = "none";
    if (emptyEl) emptyEl.style.display = "";
    updateHud();
  }

  // Clear feed can be pressed in EITHER dock (the button lives in the sheet
  // footer, which is the whole controls dock). The feed dock owns the rows,
  // so broadcast the command — otherwise clicking it in the controls dock
  // cleared nothing at all.
  clearBtn.addEventListener("click", () => {
    clearAll(false);
    sendCmd({ type: "clear" });
  });

  demoBtn.addEventListener("click", () => {
    if (demoMode) stopDemo(); else startDemo();
  });

  statusDot.addEventListener("click", () => {
    if (demoMode) return;
    if (socket && socket.readyState === WebSocket.OPEN) return;
    startEverything();
  });

  retryBtn.addEventListener("click", () => startEverything());

  feedEl.addEventListener("scroll", () => {
    const atTop = feedEl.scrollTop <= 2;
    if (paused && atTop) {
      paused = false;
      pendingCount = 0;
      pausePill.style.display = "none";
    } else if (!atTop && !paused) {
      paused = true;
      pendingCount = 0;
    }
  });

  pausePill.addEventListener("click", () => {
    paused = false;
    pendingCount = 0;
    pausePill.style.display = "none";
    feedEl.scrollTop = 0;
  });

  // vertical mouse wheel scrolls the pill strips sideways; clicking a pill
  // filters the feed to that one person
  for (const strip of [tgEl, tlEl]) {
    strip.addEventListener("wheel", e => {
      if (strip.scrollWidth > strip.clientWidth && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        strip.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });

    strip.addEventListener("click", e => {
      const pill = e.target.closest(".bd");
      if (!pill || !pill.dataset.uid) return;
      if (userFilter && userFilter.uid === pill.dataset.uid) setUserFilter(null);
      else setUserFilter({ uid: pill.dataset.uid, name: pill.dataset.name || pill.dataset.uid });
    });
  }

  userFilterClear.addEventListener("click", () => setUserFilter(null));

  /* ------------------------------------------------------------------ *
   *  Updates — the dock never talks to GitHub itself.
   *
   *  This page is loaded from file:// inside OBS: it cannot read version.txt
   *  off the disk, and it must not hold a token for a private repo. The local
   *  helper does both, so every call here goes through /update/*. Nothing in
   *  this file fetches github.com.
   * ------------------------------------------------------------------ */

  const UPD_POLL_MS = 2500;
  const UPD_POLL_TRIES = 60;     // ~2.5 min: download, bridge restart, reload

  let updState = {
    current: "", latest: "", updateAvailable: false, checkedAt: "", appliedAt: "",
    lastError: "", needsToken: false, noVersion: false, transport: "",
    isClone: false, updaterPresent: true
  };
  let updBusy = false;        // a check or an install is in flight
  let updInfoOk = null;       // did the last /update/info answer at all
  let updNote = "";           // transient line, outranks the derived ones
  let updTimers = [];
  let updAutoTried = false;

  function clearUpdTimers() {
    for (const t of updTimers) clearTimeout(t);
    updTimers = [];
  }

  function fmtWhen(iso) {
    if (!iso) return "never";
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "never";
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    return `${Math.round(hrs / 24)} d ago`;
  }

  // Compact by design: two rows and one button row carry the whole panel,
  // and the "checked when" fact rides at the end of the hint line instead of
  // owning a row of its own.
  function renderUpdates() {
    const cur = updState.current, latest = updState.latest;

    updCurrentEl.textContent = cur || "unknown";
    // "not checked" only when nothing has been asked yet - after a check that
    // found no version, a dash is the honest answer rather than a wrong one.
    // The "Newest" row earns its place only when it says something the
    // Installed row does not: a version that differs, or a check still to run.
    const showLatest = !!latest && !!cur && latest !== cur;
    updLatestEl.textContent = latest || (updState.checkedAt ? "—" : "not checked");
    if (updLatestRow) updLatestRow.hidden = !showLatest;

    let status = "", cls = "";
    if (updBusy) { status = "working…"; cls = "busy"; }
    // A bridge that answers the feed but not /update/info is a bridge from
    // before this feature existed - say that, rather than "not running".
    else if (updInfoOk === false) {
      status = bridgeState === "ok" ? "bridge too old" : "bridge not running";
      cls = "bad";
    }
    else if (!updState.updaterPresent) { status = "no updater"; cls = "bad"; }
    else if (updState.updateAvailable) { status = "update ready"; cls = "ok"; }
    // Not a failure: the repo is reachable but has nothing to compare with,
    // which one `git push` fixes. Amber, and worded as a step to take.
    else if (updState.noVersion) { status = "not on GitHub"; cls = "busy"; }
    else if (updState.lastError) { status = "check failed"; cls = "bad"; }
    else if (updState.checkedAt) { status = "up to date"; cls = "ok"; }
    updStatusEl.textContent = status;
    updStatusEl.className = `sStatus ${cls}`;

    updApplyBtn.hidden = !updState.updateAvailable;
    if (latest) updApplyBtn.textContent = `Install ${latest}`;
    updCheckBtn.disabled = updBusy;

    // The one fact on this whole panel that is invisible everywhere else on
    // screen, so it also rides on the kebab button.
    menuBadge.hidden = !updState.updateAvailable;

    let hint = "";
    if (updInfoOk === false) {
      hint = bridgeState === "ok"
        ? "The chat bridge is running an older copy with no update routes — run SETUP.bat once so it is swapped out, then reload the dock."
        : "The chat bridge is not running, so updates cannot be checked — run SETUP.bat once in the dock folder.";
    } else if (!updState.updaterPresent) {
      hint = "update.ps1 is missing from the dock folder — copy it back in, or re-download the dock once.";
    } else if (updState.noVersion) {
      hint = "GitHub has nothing to compare with yet, so there is nothing to install. Push this " +
        "folder once (version.txt tells the updater which build you are on) and it works from then on.";
    } else if (updState.needsToken) {
      hint = "GitHub could not be read at all. A git clone of this folder needs no token — the " +
        "credentials a push uses are enough — so check that this folder is still a clone and that " +
        "you are signed in to GitHub. Without a .git folder it needs a public repo, or a read-only " +
        "token in update-token.txt.";
    } else if (updState.updateAvailable) {
      hint = `Version ${latest} is on GitHub. Installing replaces the dock's own files, keeps your ` +
        "tokens, logs and settings, restarts the chat bridge, then reloads this page.";
    } else if (updState.lastError) {
      hint = updState.lastError;
    }
    // "checked 5 min ago" rides along at the end of the hint instead of
    // owning a row of its own: it is the least urgent fact on the panel.
    const when = (updState.checkedAt && !updBusy) ? `Checked ${fmtWhen(updState.checkedAt)}.` : "";
    const full = hint ? `${hint} ${when}`.trim() : when;
    updHintEl.hidden = !full;
    updHintEl.textContent = full;

    const liveNow = lastLiveState === true;
    const problem = updNote || ((updState.updateAvailable && liveNow)
      ? "You are live — install after the stream, so restarting the bridge cannot interrupt chat sending."
      : "");
    updProblemEl.hidden = !problem;
    updProblemEl.textContent = problem;
  }

  async function refreshUpdateInfo() {
    const r = await helperGet("/update/info");
    updInfoOk = !!r;
    if (r) updState = Object.assign(updState, r);
    return r;
  }

  // Poll until done() is satisfied, then hand over. The bridge is DOWN for a
  // few seconds in the middle of an install, so a missing answer here is
  // normal and must not be reported as a failure.
  function watchUpdate(done, label, onDone) {
    clearUpdTimers();
    updBusy = true;
    renderUpdates();
    let left = UPD_POLL_TRIES;
    const tick = async () => {
      const r = await refreshUpdateInfo();
      if (r && done(r)) {
        updBusy = false;
        renderUpdates();
        if (onDone) onDone();
        return;
      }
      renderUpdates();
      if (--left <= 0) {
        updBusy = false;
        updNote = `${label} did not finish. Run UPDATE.bat in the dock folder to see why.`;
        renderUpdates();
        return;
      }
      updTimers.push(setTimeout(tick, UPD_POLL_MS));
    };
    updTimers.push(setTimeout(tick, 1200));
  }

  async function runUpdateCheck() {
    if (updBusy) return;
    clearUpdTimers();
    updNote = "";
    const before = updState.checkedAt;
    const r = await helperGet("/update/check");
    if (!r || r.ok === false) {
      updInfoOk = false;
      updNote = (r && r.error) ? String(r.error)
        : "The chat bridge is not running, so nothing can be checked — run SETUP.bat.";
      renderUpdates();
      return;
    }
    watchUpdate(st => !!st.checkedAt && st.checkedAt !== before, "The version check");
  }

  async function runUpdateApply() {
    if (updBusy || !updState.updateAvailable) return;
    if (lastLiveState === true &&
        !confirm("You are live.\n\nInstalling restarts the chat bridge, which drops chat sending " +
                 "for a few seconds.\n\nInstall now?")) return;
    clearUpdTimers();
    const target = updState.latest;
    const before = updState.appliedAt;
    updNote = `Installing ${target}… the dock reloads itself when it is done.`;
    const r = await helperGet("/update/apply");
    if (!r || r.ok === false) {
      updNote = (r && r.error) ? String(r.error)
        : "Could not start the update — is the chat bridge running?";
      renderUpdates();
      return;
    }
    watchUpdate(
      st => (!!st.appliedAt && st.appliedAt !== before) || (!!st.current && st.current === target),
      "The install",
      () => {
        updNote = `Installed ${target} — reloading the dock…`;
        renderUpdates();
        setTimeout(() => location.reload(), 800);
      }
    );
  }

  // Open one section and bring it into view - how the go-live path hands off
  // to the one-time setup instead of duplicating its controls.
  function openSection(id) {
    const g = document.getElementById(id);
    if (!g) return;
    if (g.classList.contains("closed")) {
      const head = g.querySelector(".sHead");
      if (head) head.click();
    }
    const body = g.querySelector(".sBody") || g;
    try { body.scrollIntoView({ block: "center" }); } catch { }
  }

  /* ------------------------------------------------------------------ *
   *  Boot
   * ------------------------------------------------------------------ */

  // reflect restored settings in the UI
  for (const [group, check] of Object.entries(filterChecks)) check.checked = filters[group];
  for (const [name, check] of Object.entries(boardChecks)) check.checked = boardShow[name];
  soundCheck.checked = soundOn;
  soundBigInput.value = soundBig;
  bridgePortInput.value = bridgePort;
  updAutoCheck.checked = updAuto;
  goalOnCheck.checked = goal.on;
  goalTypeSel.value = goal.type;
  goalTargetInput.value = goal.target;
  for (const g of document.querySelectorAll(".sGroup")) g.classList.add("closed");

  if (CONTROLS) {
    sheetEl.hidden = false;
    document.title = "TikFinity Controls";
    document.getElementById("sheetTitle").textContent = "TikFinity Controls";
    // the chat bar lives above the sheet footer on the controls dock
    document.querySelector(".sheet").insertBefore(chatBar, document.querySelector(".sheetFoot"));
  }

  updateHud();
  renderTopGifters();
  renderPollMenuState();
  renderGoal();
  // NO auto-connect on load: the dock waits, showing "click Reconnect".
  // Everything starts from one deliberate click (retryBtn / status dot).
  if (!demoMode) showDisconnected();
  else connect();

  // first-run welcome: show until dismissed, remember forever after
  if (!welcomed) welcomeEl.hidden = false;

  // Show what is installed straight away, then (unless the creator turned it
  // off) ask GitHub once in the background. The check runs in the helper's
  // own process, so a slow network cannot stall the live feed.
  refreshUpdateInfo().then(() => {
    renderUpdates();
    if (updAuto && !updAutoTried) { updAutoTried = true; runUpdateCheck(); }
  });

  // debug/testing hook (console-only, invisible in the UI)
  window.__testAdd = addEvent;
})();
