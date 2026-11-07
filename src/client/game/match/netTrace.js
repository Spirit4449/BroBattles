import { decodeWire } from "../../../shared/networkWire.js";
// Client half of production network tracing. Inactive (every export a no-op)
// unless this tab carries a nettrace spec (see lib/netTraceSpec.js). Records raw
// timelines — snapshot arrivals, decoded positions, rendered positions per
// frame, corrections, keys and mouse buttons, clock, attack requests sent,
// combat confirmations received, predicted hits drawn and withdrawn — and
// uploads them every two seconds on `debug:net-trace`. Rubber-band and attack
// latency analysis happen offline in scripts/dev/net-report.mjs so they can
// change without a client rebuild.
import { readNetTraceSpec } from "../../lib/netTraceSpec";
import { setShotTraceHook } from "../characters/shared/shotPrediction";

const UPLOAD_MS = 2000;
const DIAG_MS = 1000;
const MAX_FRAMES_PER_BATCH = 400;
const MAX_SNAPS_PER_BATCH = 200;

let active = null;

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

const ATTACK_EVENTS = new Set(["game:action", "game:special"]);
const MAX_COMBAT_PER_BATCH = 600;

export function installNetTrace({ socket, getLocal, getRemotes, getUsername, getSnapshotDiagnostics,
  getCorrectionDiagnostics, getClockDiagnostics, serverNow, getCharacter, getEnemies, toScreen }) {
  const spec = readNetTraceSpec();
  if (!spec || active) return null;
  const state = {
    spec, socket, seq: 0, names: [], nameIndex: new Map(),
    frames: [], snaps: [], decoded: [], corrections: [], keys: [], diag: [], events: [], combat: [],
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
    packet = decodeWire(packet);
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
  // Combat rows: [t, what, ...]. "tx" attack requests sent, "rx" combat actions
  // received that involve this player, "hp" health updates, "sp" super charge,
  // "pred" predicted hits drawn, "wd" predictions withdrawn.
  const combat = (row) => { if (state.combat.length < MAX_COMBAT_PER_BATCH) state.combat.push(row); };
  state.combatRow = combat;
  const me = () => getUsername?.() || null;
  const onAction = (msg) => {
    const a = msg?.action || {};
    const name = me();
    if (msg?.playerName !== name && a.target !== name && a.ownerName !== name) return;
    combat([r1(performance.now()), "rx", String(a.type || "").slice(0, 40), msg?.playerName ?? null, a.target ?? null,
      Number.isFinite(a.appliedDamage) ? a.appliedDamage : null, a.id ?? a.requestId ?? a.instanceId ?? null,
      a.accepted === false ? 0 : a.accepted === true ? 1 : null, a.reason ?? null]);
  };
  const onHealth = (d) => combat([r1(performance.now()), "hp", d?.username ?? null, d?.health ?? null, d?.cause ?? null]);
  const onSuper = (d) => { if (d?.username === me()) combat([r1(performance.now()), "sp", d.charge ?? null, d.maxCharge ?? null]); };
  const onSpecial = (d) => {
    const name = d?.username ?? d?.playerName ?? d?.name ?? null;
    if (name === me()) combat([r1(performance.now()), "rx", "player:special", name, null, null, d?.id ?? d?.requestId ?? null, null, null]);
  };
  setShotTraceHook({ prediction: noteShotPrediction, withdrawn: noteShotWithdrawn });
  const originalEmit = socket.emit;
  socket.emit = function tracedEmit(event, payload, ...rest) {
    if (ATTACK_EVENTS.has(event)) {
      combat([r1(performance.now()), "tx", event, String(payload?.type || (event === "game:special" ? "special" : "")).slice(0, 40),
        payload?.id ?? payload?.requestId ?? null, getCharacter?.() || null]);
    }
    return originalEmit.call(this, event, payload, ...rest);
  };
  const listeners = {
    "game:snapshot": onSnapshot,
    "game:action": onAction,
    "health-update": onHealth,
    "super-update": onSuper,
    "player:special": onSpecial,
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
  const onPointer = (down) => (e) => state.keys.push([r1(performance.now()), `Mouse${e.button ?? 0}`, down ? 1 : 0]);
  const pointerDown = onPointer(true), pointerUp = onPointer(false);
  window.addEventListener("pointerdown", pointerDown, true);
  window.addEventListener("pointerup", pointerUp, true);

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
      events: state.events.splice(0), combat: state.combat.splice(0), character: getCharacter?.() || null,
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
    // For the probe's attack scripts: the nearest living enemy relative to the
    // local player in world pixels, and where it is on the page.
    nearestEnemy: () => {
      const p = getLocal?.();
      if (!p || !Number.isFinite(p.x)) return null;
      let best = null;
      for (const e of getEnemies?.() || []) {
        if (!e || !Number.isFinite(e.x)) continue;
        const dx = e.x - p.x, dy = e.y - p.y, dist = Math.hypot(dx, dy);
        if (!best || dist < best.dist) best = { name: e.name, dx, dy, dist };
      }
      if (best) best.screen = toScreen?.(p.x + best.dx, p.y + best.dy) || null;
      return best;
    },
  };
  event("install", { userAgent: navigator.userAgent, dpr: window.devicePixelRatio });

  return () => {
    upload();
    cancelAnimationFrame(state.rafId);
    state.timers.forEach(clearInterval);
    for (const [name, fn] of Object.entries(listeners)) socket.off(name, fn);
    window.removeEventListener("keydown", keyDown, true);
    window.removeEventListener("keyup", keyUp, true);
    window.removeEventListener("pointerdown", pointerDown, true);
    window.removeEventListener("pointerup", pointerUp, true);
    window.removeEventListener("pagehide", onHide);
    socket.emit = originalEmit;
    setShotTraceHook(null);
    active = null;
  };
}

// A predicted hit the shooter drew against a displayed enemy. Repeated queries
// for the same target within a few frames are one prediction.
function noteShotPrediction(targetName) {
  if (!active || !targetName) return;
  const t = performance.now();
  const last = active.lastPrediction;
  if (last && last.name === targetName && t - last.t < 120) return;
  active.lastPrediction = { name: targetName, t };
  active.combatRow?.([r1(t), "pred", String(targetName).slice(0, 40)]);
}

// A predicted hit the server did not confirm in time and the client took back.
function noteShotWithdrawn(kind, id = null) {
  if (!active) return;
  active.combatRow?.([r1(performance.now()), "wd", kind, id]);
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
