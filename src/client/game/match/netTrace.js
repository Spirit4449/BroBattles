// Client half of production network tracing. Inactive (every export a no-op)
// unless this tab carries a nettrace spec (see lib/netTraceSpec.js). Records raw
// timelines — snapshot arrivals, decoded positions, rendered positions per
// frame, corrections, keys, clock — and uploads them every two seconds on
// `debug:net-trace`. Rubber-band detection happens offline in
// scripts/dev/net-report.mjs so it can change without a client rebuild.
import { readNetTraceSpec } from "../../lib/netTraceSpec";

const UPLOAD_MS = 2000;
const DIAG_MS = 1000;
const MAX_FRAMES_PER_BATCH = 400;
const MAX_SNAPS_PER_BATCH = 200;

let active = null;

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

export function installNetTrace({ socket, getLocal, getRemotes, getUsername, getSnapshotDiagnostics,
  getCorrectionDiagnostics, getClockDiagnostics, serverNow }) {
  const spec = readNetTraceSpec();
  if (!spec || active) return null;
  const state = {
    spec, socket, seq: 0, names: [], nameIndex: new Map(),
    frames: [], snaps: [], decoded: [], corrections: [], keys: [], diag: [], events: [],
    lastFrameAt: null, uploads: 0, rejected: 0, totals: { frames: 0, snaps: 0, corrections: 0, maxArrivalGapMs: 0 },
    lastArrival: null, timers: [], rafId: 0,
  };
  active = state;

  const indexOf = (name) => {
    let i = state.nameIndex.get(name);
    if (i === undefined) { i = state.names.length; state.names.push(name); state.nameIndex.set(name, i); }
    return i;
  };
  const event = (type, data = {}) => state.events.push({ t: r1(performance.now()), type, ...data });

  const onSnapshot = (packet) => {
    const t = performance.now();
    const gap = state.lastArrival == null ? null : t - state.lastArrival;
    state.lastArrival = t;
    if (gap != null && gap > state.totals.maxArrivalGapMs) state.totals.maxArrivalGapMs = gap;
    state.totals.snaps++;
    if (state.snaps.length < MAX_SNAPS_PER_BATCH) {
      state.snaps.push([r1(t), packet?.snapshotSeq ?? null, r1(packet?.tMono), r1(packet?.sentMono),
        packet?.keyframe ? 1 : 0, packet?.snapshotKind === "event" ? 1 : 0, r1(serverNow?.(t))]);
    }
  };
  const onCorrection = (data) => {
    state.totals.corrections++;
    state.corrections.push({ t: r1(performance.now()), id: data?.correctionId, reason: data?.reason,
      seq: data?.sequence, errorPx: r1(Number(data?.errorPx)), x: r1(data?.x), y: r1(data?.y),
      local: snapshotLocal() });
  };
  const snapshotLocal = () => {
    const p = getLocal?.();
    return p ? [r1(p.x), r1(p.y)] : null;
  };
  const listeners = {
    "game:snapshot": onSnapshot,
    "game:correction": onCorrection,
    "game:start": () => event("start"),
    "game:over": () => { event("over"); upload(); },
    "player:dead": (d) => event("dead", { name: d?.username }),
    "player:respawn": (d) => event("respawn", { name: d?.username }),
    disconnect: (reason) => event("disconnect", { reason }),
    connect: () => event("connect"),
  };
  for (const [name, fn] of Object.entries(listeners)) socket.on(name, fn);

  const onKey = (down) => (e) => {
    if (e.repeat) return;
    state.keys.push([r1(performance.now()), e.code || e.key, down ? 1 : 0]);
  };
  const keyDown = onKey(true), keyUp = onKey(false);
  window.addEventListener("keydown", keyDown, true);
  window.addEventListener("keyup", keyUp, true);

  const frame = () => {
    state.rafId = requestAnimationFrame(frame);
    const t = performance.now();
    const dt = state.lastFrameAt == null ? 0 : t - state.lastFrameAt;
    state.lastFrameAt = t;
    state.totals.frames++;
    if (state.frames.length >= MAX_FRAMES_PER_BATCH) return;
    const local = getLocal?.();
    const row = [r1(t), r1(dt), local ? r1(local.x) : null, local ? r1(local.y) : null,
      local?.body ? r1(local.body.velocity?.x) : null];
    const remotes = getRemotes?.() || [];
    for (const remote of remotes) {
      if (!remote || !Number.isFinite(remote.x)) continue;
      row.push(indexOf(remote.name), r1(remote.x), r1(remote.y));
    }
    state.frames.push(row);
  };
  state.rafId = requestAnimationFrame(frame);

  state.timers.push(setInterval(() => {
    let snapshot = null, corrections = null, clock = null;
    try { snapshot = getSnapshotDiagnostics?.(); } catch (_) {}
    try { corrections = getCorrectionDiagnostics?.(); } catch (_) {}
    try { clock = getClockDiagnostics?.(); } catch (_) {}
    state.diag.push({ t: r1(performance.now()), snapshot, corrections: compactCorrections(corrections), clock,
      hidden: document.hidden, });
  }, DIAG_MS));

  function compactCorrections(c) {
    if (!c || typeof c !== "object") return c;
    const out = {};
    for (const [k, v] of Object.entries(c)) if (!Array.isArray(v)) out[k] = v;
    return out;
  }

  function upload() {
    if (!socket.connected) return;
    const batch = {
      seq: state.seq++, user: getUsername?.() || null, sentAt: r1(performance.now()),
      serverNowAtSend: r1(serverNow?.(performance.now())), names: state.names.slice(),
      frames: state.frames.splice(0), snaps: state.snaps.splice(0), decoded: state.decoded.splice(0),
      corrections: state.corrections.splice(0), keys: state.keys.splice(0), diag: state.diag.splice(0),
      events: state.events.splice(0),
    };
    socket.timeout(5000).emit("debug:net-trace", batch, (err, reply) => {
      if (!err && reply?.ok) state.uploads++;
      else state.rejected++;
    });
  }
  state.timers.push(setInterval(upload, UPLOAD_MS));
  const onHide = () => upload();
  window.addEventListener("pagehide", onHide);

  window.__BB_NET_TRACE__ = {
    spec: { runId: spec.runId, tag: spec.tag },
    stats: () => ({ ...state.totals, maxArrivalGapMs: r1(state.totals.maxArrivalGapMs), uploads: state.uploads,
      rejected: state.rejected, seq: state.seq }),
    flush: upload,
  };
  event("install", { userAgent: navigator.userAgent, dpr: window.devicePixelRatio });

  return () => {
    upload();
    cancelAnimationFrame(state.rafId);
    state.timers.forEach(clearInterval);
    for (const [name, fn] of Object.entries(listeners)) socket.off(name, fn);
    window.removeEventListener("keydown", keyDown, true);
    window.removeEventListener("keyup", keyUp, true);
    window.removeEventListener("pagehide", onHide);
    active = null;
  };
}

// Decoded (full) per-player positions, called by the match coordinator after
// delta decoding so the report can compare rendered motion with server truth.
export function noteDecodedSnapshot(snapshot, receivedAt) {
  if (!active || !snapshot?.players || active.decoded.length >= MAX_SNAPS_PER_BATCH) return;
  const row = [r1(receivedAt), snapshot.snapshotSeq ?? null, r1(snapshot.tMono)];
  for (const [name, p] of Object.entries(snapshot.players)) {
    if (!Number.isFinite(p?.x)) continue;
    let i = active.nameIndex.get(name);
    if (i === undefined) { i = active.names.length; active.names.push(name); active.nameIndex.set(name, i); }
    row.push(i, r1(p.x), r1(p.y));
  }
  active.decoded.push(row);
}
