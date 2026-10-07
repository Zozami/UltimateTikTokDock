/* ------------------------------------------------------------------ *
 *  obs-websocket client — pushes the TikTok stream key straight into
 *  OBS (or into the Aitum Vertical canvas) so there is nothing to
 *  copy/paste.
 *
 *  Enable it in OBS: Tools -> WebSocket Server Settings -> "Enable
 *  WebSocket server" (default port 4455) and set a password.
 *
 *  Two protocol generations are supported, because OBS changed opcodes
 *  in obs-websocket 5.6:
 *
 *    5.6+   Hello = op 0 (auth = {challenge, salt})
 *           Identify = op 1, Identified = op 2
 *           Request = op 6, response = op 7
 *           auth = b64(sha256( b64(sha256(password + salt)) + challenge ))
 *
 *    5.0-5.5 Hello = op 1 (challenge is a bare string)
 *           auth reply = op 2, Request = op 1
 *           auth = b64(sha256( b64(sha256(password)) + challenge ))
 *
 *  Sending the request before Identified (new) is rejected by OBS, so the
 *  two handshakes are handled separately.
 * ------------------------------------------------------------------ */

const b64 = {
  enc(bytes) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
};

// What the connected OBS told us in its Hello. obs-websocket 5.6 renamed
// several requests (SetStreamSettings -> the outputs API), so we need this.
const serverInfo = { obsVersion: "", wsVersion: "" };
function obsServerInfo() { return Object.assign({}, serverInfo); }

async function sha256Base64(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return b64.enc(new Uint8Array(digest));
}

// Connect, authenticate, send `requestType` (+ optional requestData),
// and resolve with OBS's responseData. Rejects with a readable Error.
function obsRequest({ port, password, requestType, requestData = {}, timeoutMs = 8000 }) {
  return new Promise((resolve, reject) => {
    const requestId = "tf-" + requestType + "-" + Date.now();
    let ws;
    try { ws = new WebSocket(`ws://127.0.0.1:${port}`); }
    catch { reject(new Error(`Cannot reach OBS on port ${port} — enable Tools ▸ WebSocket Server`)); return; }

    let settled = false;
    let proto = null;          // "new" (5.6+) | "legacy" (5.0-5.5)
    let timer = null;

    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closing */ }
      err ? reject(err) : resolve(val);
    };
    timer = setTimeout(() => finish(new Error("OBS did not answer in time")), timeoutMs);

    const sendRequest = () => {
      try {
        ws.send(JSON.stringify({
          op: proto === "new" ? 6 : 1,
          d: { requestType, requestId, requestData }
        }));
      } catch (e) { finish(e); }
    };

    ws.onerror = () => finish(new Error(`Cannot reach OBS on port ${port} — enable Tools ▸ WebSocket Server`));

    ws.onclose = e => {
      const code = e ? e.code : 0;
      // 4002 = 5.0-5.5 AuthenticationFailed, 4009 = 5.6+ AuthenticationFailed
      if (code === 4002 || code === 4009) finish(new Error("OBS rejected the WebSocket password"));
      else if (code === 4003) finish(new Error("OBS rejected the protocol version"));
      else if (e && e.reason) finish(new Error("OBS closed the connection: " + e.reason));
      else finish(new Error("OBS closed the connection"));
    };

    ws.onmessage = async ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      const d = m.d || {};

      // ---- obs-websocket 5.6+ : Hello (op 0) with an auth object -------
      if (m.op === 0 && d.obsWebSocketVersion) {
        proto = "new";
        serverInfo.obsVersion = d.obsStudioVersion || serverInfo.obsVersion;
        serverInfo.wsVersion = d.obsWebSocketVersion || serverInfo.wsVersion;
        const identify = { rpcVersion: 1, eventSubscriptions: 0 };
        const a = d.authentication;
        if (a && a.challenge) {
          const secret = await sha256Base64((password || "") + a.salt);
          identify.authentication = await sha256Base64(secret + a.challenge);
        }
        try { ws.send(JSON.stringify({ op: 1, d: identify })); }
        catch (e) { finish(e); }
        return;
      }

      // ---- Identified (op 2): only NOW may we send a request -----------
      if (m.op === 2 && proto === "new") { sendRequest(); return; }

      // ---- obs-websocket 5.0-5.5 : Hello (op 1), bare challenge -------
      if (m.op === 1 && d.obsWebSocketVersion && !d.requestId) {
        proto = "legacy";
        serverInfo.obsVersion = d.obsStudioVersion || serverInfo.obsVersion;
        serverInfo.wsVersion = d.obsWebSocketVersion || serverInfo.wsVersion;
        const secret = (await sha256Base64(password || "")) + d.challenge;
        const auth = (await sha256Base64(secret)) || "";
        try {
          ws.send(JSON.stringify({ op: 2, d: { auth, eventSubscriptions: 0 } }));
          sendRequest();
        } catch (e) { finish(e); }
        return;
      }

      // ---- 5.0-5.5 tells us the password was wrong with op 9 -----------
      if (m.op === 9 && proto === "legacy") {
        finish(new Error("OBS rejected the WebSocket password"));
        return;
      }

      // ---- the answer to OUR request -----------------------------------
      if (d.requestId === requestId) {
        if (d.requestStatus && d.requestStatus.result === false) {
          finish(new Error(d.requestStatus.comment || "OBS rejected the request"));
        } else {
          finish(null, d.responseData || {});
        }
      }
    };
  });
}

/* ------------------------------------------------------------------ *
 *  Live output stats - the same numbers OBS prints along its own status
 *  bar (fps / bitrate / dropped frames and the percent lost).
 *
 *  GetStats only fills outputStats[] while an output is actually running,
 *  so the top-level outputTotalFrames / outputSkippedFrames fields are the
 *  fallback. Everything is normalised here so the dock never has to know
 *  which shape it got.
 * ------------------------------------------------------------------ */

async function obsStats({ port, password }) {
  const r = await obsRequest({ port, password, requestType: "GetStats", timeoutMs: 5000 });
  const list = Array.isArray(r.outputStats) ? r.outputStats.filter(Boolean) : [];
  // Prefer whichever output is live; the vertical canvas' RTMP is the one
  // that matters while streaming, and it is not the only output OBS has.
  const out = list.find(o => o.active) || list[0] || null;

  // Number(null) and Number(false) are both 0, which is never what we want
  // here - a missing field has to fall through, not read as zero.
  const num = (v, fallback) => {
    if (v === null || v === undefined || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const fps = num(out && out.fps, num(r.activeFps, 0));
  // speed is bytes/second; bitrate is what a human reads
  const kbps = Math.round(num(out && out.speed, 0) * 8 / 1000);

  const total = num(out && out.totalFrames, num(r.outputTotalFrames, 0));
  const dropped = num(out && out.droppedFrames, num(r.outputSkippedFrames, 0));
  let droppedPct = num(out && out.droppedPct, NaN);
  if (!Number.isFinite(droppedPct)) {
    droppedPct = total > 0 ? (dropped / total) * 100 : 0;
  }

  return {
    active: out ? !!out.active : false,
    output: (out && (out.outputName || out.outputType)) || "",
    fps, kbps,
    totalFrames: total,
    droppedFrames: dropped,
    droppedPct
  };
}

/* ------------------------------------------------------------------ *
 *  Writing the key into OBS
 *
 *  obs-websocket 5.6 deleted SetStreamSettings / StartStreaming. On OBS 32
 *  the stream key lives in the *stream service* settings instead, so we
 *  read what is there, swap server + key, and write it back. The generic
 *  outputs API is NOT used for streaming: GetOutputList returns file /
 *  replay / virtualcam outputs, never the stream.
 * ------------------------------------------------------------------ */

async function obsVersion({ port, password }) {
  return obsRequest({ port, password, timeoutMs: 4000, requestType: "GetVersion" });
}

/* ------------------------------------------------------------------ *
 *  Aitum Vertical (obs-vertical-canvas)
 *
 *  The plugin runs its OWN rtmp service for the 9:16 canvas, separate
 *  from OBS's main Stream settings — so writing the key to OBS does
 *  nothing for a vertical-only stream. Luckily it registers obs-websocket
 *  vendor requests (vendor "aitum-vertical-canvas"), so the same socket
 *  can push the key straight into the canvas:
 *
 *    update_stream_server { stream_server: "rtmps://..." }
 *    update_stream_key    { stream_key: "..." }
 *    start_streaming / stop_streaming / status / version
 * ------------------------------------------------------------------ */

const AITUM_VENDOR = "aitum-vertical-canvas";

async function aitumRequest({ port, password, requestType, requestData = {}, timeoutMs = 8000 }) {
  return obsRequest({
    port, password, timeoutMs,
    requestType: "CallVendorRequest",
    requestData: { vendorName: AITUM_VENDOR, requestType, requestData }
  });
}

// Is the canvas actually pushing right now? The dock waits on this before it
// opens TikFinity, because TikFinity refuses to attach while TikTok still
// reports no output - a race that otherwise looks like a broken app.
async function aitumStatus({ port, password }) {
  const r = await aitumRequest({ port, password, requestType: "status" });
  return !!(r && r.responseData && r.responseData.streaming);
}

async function obsSetAitumStream({ port, password, url, key }) {
  if (url) {
    await aitumRequest({
      port, password,
      requestType: "update_stream_server",
      requestData: { stream_server: url }
    });
  }
  return aitumRequest({
    port, password,
    requestType: "update_stream_key",
    requestData: { stream_key: key }
  });
}

// Press the vertical canvas' own "Go Live" button.
async function aitumStartStreaming({ port, password }) {
  return aitumRequest({ port, password, requestType: "start_streaming" });
}

// And its "Stop". Without this the canvas keeps pushing a stream key that
// nobody is listening to any more.
async function aitumStopStreaming({ port, password }) {
  return aitumRequest({ port, password, requestType: "stop_streaming" });
}