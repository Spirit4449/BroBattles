// Pure analysis for network trace runs (see net-report.mjs). Takes parsed
// JSONL records and returns a report object; no I/O so tests can feed fixtures.
//
// Time domains: server records carry `t` = server performance.now(). Client
// batches carry client performance.now() stamps plus the client's estimate of
// server time, which maps client events onto the server timeline.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const GAP_MS = 100;
export const LOOP_STALL_MS = 50;
export const BOT_HEAVY_MS = 8;

export function quantile(values, q) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.floor((v.length - 1) * q))];
}
const max = (values) => values.reduce((m, x) => (Number.isFinite(x) && x > m ? x : m), -Infinity);
const fin = (x) => (Number.isFinite(x) ? x : null);
const median = (values) => quantile(values, 0.5);

// ---- server ---------------------------------------------------------------

// Only the part of the run players were in: from the start to the first
// traced client leaving. A room keeps simulating (and stalling) for a while
// after its humans leave, which no player sees.
export function playedWindow(records) {
  const firstActive = records.find(r => r.kind === "tick" && r.status === "active")?.t ?? -Infinity;
  const leave = records.find(r => r.kind === "socket" && r.event === "disconnect" && r.t > firstActive)?.t;
  return Number.isFinite(leave) ? leave : Infinity;
}

export function analyzeServer(allRecords) {
  const end = playedWindow(allRecords);
  const records = allRecords.filter(r => !(r.t > end) || ["run", "room", "socket"].includes(r.kind));
  const run = records.find(r => r.kind === "run") || {};
  const rooms = records.filter(r => r.kind === "room");
  const ticks = records.filter(r => r.kind === "tick" && r.status === "active");
  const stalls = records.filter(r => r.kind === "stall");
  const loopStalls = stalls.filter(s => s.what === "loop");
  const snapStalls = stalls.filter(s => s.what === "snapshot");
  const hosts = records.filter(r => r.kind === "host");
  const nav = records.filter(r => r.kind === "nav");
  const actions = records.filter(r => r.kind === "action");
  const hits = records.filter(r => r.kind === "hit");
  const navIntervals = nav.map(n => ({ start: n.t - (Number(n.buildMs) || 0) - Math.max(0, Number(n.queueMs) || 0), end: n.t }));
  const inNav = (t) => navIntervals.some(i => t >= i.start - 50 && t <= i.end + 50);
  const tickAt = (t) => ticks.find(k => t <= k.t && t > k.t - (k.windowMs || 1000) - 1);
  const hostAt = (t) => hosts.reduce((best, h) => (Math.abs(h.t - t) < Math.abs((best?.t ?? Infinity) - t) ? h : best), null);
  const cpus = Number(run.cpus) || 4;
  let withNav = 0, withBots = 0, withHostLoad = 0;
  for (const s of loopStalls) {
    if (inNav(s.t)) withNav++;
    const tick = tickAt(s.t);
    if ((tick?.bots?.max ?? 0) > BOT_HEAVY_MS || (s.botsLastTickMs ?? 0) > BOT_HEAVY_MS) withBots++;
    if ((hostAt(s.t)?.load1 ?? 0) > cpus) withHostLoad++;
  }
  let slowestBot = null;
  for (const k of ticks) if (k.bots?.slowest && (!slowestBot || k.bots.slowest.ms > slowestBot.ms)) slowestBot = k.bots.slowest;
  const writeBufferMax = max(ticks.flatMap(k => Object.values(k.writeBuffers || {})));
  const tickTimes = ticks.map(k => k.t);
  return {
    hostname: run.host, node: run.node, cpus: run.cpus,
    rooms: dedupeRooms(rooms),
    durationS: tickTimes.length ? (Math.max(...tickTimes) - Math.min(...tickTimes)) / 1000 : 0,
    loopP95: quantile(ticks.map(k => k.loop?.p95), 0.95),
    loopMax: fin(max(ticks.map(k => k.loop?.max))),
    loopStalls: loopStalls.length,
    loopStallsSevere: loopStalls.filter(s => s.deltaMs >= 200).length,
    snapshotGaps: snapStalls.length,
    snapshotGapMax: fin(max(snapStalls.map(s => s.gapMs))),
    avgSnapshotBytes: median(ticks.map(k => k.snap?.avgBytes).filter(x => x > 0)),
    botP95: quantile(ticks.map(k => k.bots?.p95), 0.95),
    botMax: fin(max(ticks.map(k => k.bots?.max))),
    botTotalMaxPerSecond: fin(max(ticks.map(k => k.bots?.totalMs))),
    slowestBot,
    nav: { count: nav.length, buildMax: fin(max(nav.map(n => n.buildMs))), queueMax: fin(max(nav.map(n => n.queueMs))),
      errors: nav.filter(n => n.error).length },
    host: {
      loadMax: fin(max(hosts.map(h => h.load1))), loopDelayP99Max: fin(max(hosts.map(h => h.loopDelayP99))),
      loopDelayMax: fin(max(hosts.map(h => h.loopDelayMax))), cpuMax: fin(max(hosts.map(h => h.cpuPct))),
      memAvailMin: hosts.length ? Math.min(...hosts.map(h => h.memAvailMb).filter(Number.isFinite)) : null,
      swapMax: fin(max(hosts.map(h => h.swapUsedMb))),
    },
    attribution: { stalls: loopStalls.length, withNav, withBots, withHostLoad, botThresholdMs: BOT_HEAVY_MS },
    writeBufferMax: fin(writeBufferMax),
    phases: phaseSummary(ticks),
    gc: { pauseMax: fin(max(hosts.map(h => h.gc?.max))), majorMax: fin(max(hosts.map(h => h.gc?.majorMax))),
      msPerSecondMax: fin(max(hosts.map(h => h.gc?.ms))) },
    _index: { ticks, loopStalls, snapStalls, hosts, inNav, tickAt, hostAt, actions, hits, near: records.filter(r => r.kind === "near") },
  };
}

// Per-phase main-thread time (ms per second) across live ticks: p50/max of the
// per-second totals and the slowest single step.
function phaseSummary(ticks) {
  const out = {};
  for (const k of ticks) {
    for (const [phase, ms] of Object.entries(k.phases || {})) (out[phase] ||= { perSecond: [], stepMax: 0 }).perSecond.push(ms);
    for (const [phase, ms] of Object.entries(k.phaseMax || {})) {
      (out[phase] ||= { perSecond: [], stepMax: 0 });
      if (ms > out[phase].stepMax) out[phase].stepMax = ms;
    }
  }
  return Object.fromEntries(Object.entries(out).map(([phase, v]) => [phase,
    { p50PerSecond: quantile(v.perSecond, 0.5), maxPerSecond: fin(max(v.perSecond)), stepMax: v.stepMax }]));
}

function dedupeRooms(rooms) {
  const byId = new Map();
  for (const r of rooms) if (!byId.has(r.matchId)) byId.set(r.matchId, r);
  return [...byId.values()].map(({ matchId, modeId, modeVariantId, map, bots, humans }) => ({ matchId, modeId, modeVariantId, map, bots, humans }));
}

// ---- client ---------------------------------------------------------------

export function flattenClient(records) {
  const out = { user: null, character: null, names: [], frames: [], snaps: [], decoded: [], corrections: [], keys: [], diag: [], events: [], combat: [], offsets: [], dateOffsets: [] };
  for (const r of records) {
    const d = r.kind === "batch" ? r.data : null;
    if (!d) continue;
    out.user ||= d.user;
    if (d.character) out.character = d.character;
    if (Array.isArray(d.names) && d.names.length >= out.names.length) out.names = d.names;
    for (const k of ["frames", "snaps", "decoded", "corrections", "keys", "diag", "events", "combat"]) {
      if (Array.isArray(d[k])) out[k].push(...d[k]);
    }
    if (Number.isFinite(d.serverNowAtSend) && Number.isFinite(d.sentAt)) out.offsets.push(d.serverNowAtSend - d.sentAt);
    if (Number.isFinite(d.dateOffset)) out.dateOffsets.push(d.dateOffset);
  }
  out.dateOffset = median(out.dateOffsets);
  for (const s of out.snaps) if (Number.isFinite(s[6]) && Number.isFinite(s[0])) out.offsets.push(s[6] - s[0]);
  out.combat.sort((a, b) => a[0] - b[0]);
  out.frames.sort((a, b) => a[0] - b[0]);
  out.snaps.sort((a, b) => a[0] - b[0]);
  out.decoded.sort((a, b) => a[0] - b[0]);
  out.offset = median(out.offsets) ?? 0;
  return out;
}

const HIST = [[0, 40], [40, 60], [60, 100], [100, 200], [200, 500], [500, Infinity]];

// Snapshot arrival gaps, each classified by whether the server's own emission
// was late (source tMono gap ~ arrival gap) or the packet was delayed in transit.
// A frozen page delivers queued packets in a burst, which looks like a network
// gap; frames longer than half the gap around it mark it as a client stall.
export function analyzeArrivals(snaps, { serverIndex, offset = 0, frames = [] } = {}) {
  const frozenAround = (t, gap) => frames.some(f => f[1] >= gap * 0.5 && f[0] >= t - 50 && f[0] <= t + gap);
  const periodic = snaps.filter(s => !s[5]);
  const intervals = [], gaps = [], delays = [];
  for (let i = 0; i < periodic.length; i++) {
    const s = periodic[i];
    if (Number.isFinite(s[6]) && Number.isFinite(s[3])) delays.push(s[6] - s[3]);
    if (!i) continue;
    const prev = periodic[i - 1];
    const arrivalGap = s[0] - prev[0];
    intervals.push(arrivalGap);
    if (arrivalGap < GAP_MS) continue;
    const sourceGap = Number.isFinite(s[2]) && Number.isFinite(prev[2]) ? s[2] - prev[2] : null;
    const serverT = s[0] + offset;
    const stall = serverIndex?.loopStalls.find(x => x.t >= serverT - arrivalGap - 150 && x.t <= serverT + 50);
    const cause = sourceGap != null && sourceGap >= arrivalGap * 0.7 ? "server" : stall ? "server"
      : frozenAround(prev[0], arrivalGap) ? "client" : "transport";
    gaps.push({ serverT, arrivalGapMs: arrivalGap, sourceGapMs: sourceGap, cause, serverStall: stall?.deltaMs ?? null,
      nav: serverIndex?.inNav(serverT) || false });
  }
  const histogram = {};
  for (const [lo, hi] of HIST) histogram[hi === Infinity ? `${lo}+` : `${lo}-${hi}`] = intervals.filter(x => x >= lo && x < hi).length;
  const p50 = median(delays) ?? 0;
  return {
    arrival: { p50: quantile(intervals, 0.5), p95: quantile(intervals, 0.95), p99: quantile(intervals, 0.99), max: fin(max(intervals)), histogram },
    gaps,
    gapCauses: { server: gaps.filter(g => g.cause === "server").length, transport: gaps.filter(g => g.cause === "transport").length,
      client: gaps.filter(g => g.cause === "client").length },
    // Relative to the median: the absolute value carries clock-offset error.
    delay: { p50: 0, p95: quantile(delays, 0.95) - p50, max: fin(max(delays)) - p50, rawMedian: p50 },
  };
}

// Per-actor position series from frame rows: [t, dt, lx, ly, lvx, (idx, x, y)*].
export function seriesFromFrames(frames, names) {
  const local = [], remote = new Map();
  for (const f of frames) {
    if (Number.isFinite(f[2])) local.push({ t: f[0], x: f[2], y: f[3] });
    for (let i = 5; i + 2 < f.length; i += 3) {
      const name = names[f[i]] ?? `#${f[i]}`;
      if (!remote.has(name)) remote.set(name, []);
      remote.get(name).push({ t: f[0], x: f[i + 1], y: f[i + 2] });
    }
  }
  return { local, remote };
}

export function seriesFromDecoded(decoded, names) {
  const byName = new Map();
  for (const row of decoded) {
    for (let i = 3; i + 2 < row.length; i += 3) {
      const name = names[row[i]] ?? `#${row[i]}`;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ t: row[0], x: row[i + 1], y: row[i + 2] });
    }
  }
  return byName;
}

// A bounce: steady travel one way, a sharp step back, then travel resumes the
// original way within `resumeMs`. Teleports (> teleportPx) are ignored.
export function detectBounces(series, { minTravelFrames = 5, minSpeed = 1.2, backPx = 6, resumeMs = 350, teleportPx = 220 } = {}) {
  const out = [];
  for (let i = minTravelFrames; i < series.length - 2; i++) {
    const a = series[i - minTravelFrames], b = series[i];
    const travel = b.x - a.x;
    const frames = minTravelFrames;
    if (Math.abs(travel) / frames < minSpeed) continue;
    const dir = Math.sign(travel);
    // monotonic travel before i
    let steady = true;
    for (let k = i - minTravelFrames + 1; k <= i; k++) if (Math.sign(series[k].x - series[k - 1].x) === -dir) { steady = false; break; }
    if (!steady) continue;
    let j = i + 1, back = 0;
    while (j < series.length && series[j].t - b.t < 120) {
      const step = series[j].x - series[j - 1].x;
      if (Math.abs(step) > teleportPx) { back = 0; break; }
      if (Math.sign(step) === -dir) back += Math.abs(step); else if (back) break;
      j++;
    }
    if (back < backPx) continue;
    const turn = series[j - 1];
    let resumed = false;
    for (let k = j; k < series.length && series[k].t - turn.t <= resumeMs; k++) {
      if ((series[k].x - turn.x) * dir > backPx * 0.8) { resumed = true; break; }
    }
    if (!resumed) continue;
    out.push({ t: b.t, magnitudePx: back, dir });
    i = j + 3;
  }
  return out;
}

// Large single-frame jumps of the local player (snaps).
export function detectSnaps(series, { minPx = 28, teleportPx = 260 } = {}) {
  const out = [];
  const steps = [];
  for (let i = 1; i < series.length; i++) {
    const dx = series[i].x - series[i - 1].x, dy = series[i].y - series[i - 1].y;
    const d = Math.hypot(dx, dy);
    const typical = median(steps.slice(-30)) ?? 0;
    steps.push(d);
    if (d >= Math.max(minPx, typical * 4) && d < teleportPx) out.push({ t: series[i].t, magnitudePx: d });
  }
  return out;
}

// Whether the server's own snapshots move the actor back against `dir` by at
// least `minPx` in the window. Cumulative: a bot that turns around over
// several small snapshot steps is real movement too.
function truthReversed(truth, t, dir, windowMs = 450, minPx = 4) {
  if (!truth?.length) return null;
  const pts = truth.filter(p => p.t >= t - windowMs && p.t <= t + 150);
  let peak = -Infinity;
  for (const p of pts) {
    const along = p.x * dir;
    if (along > peak) peak = along;
    else if (peak - along >= minPx) return true;
  }
  return false;
}

export function analyzeClient(records, serverIndex, tag = null, { flat = null, truth: serverTruth = null } = {}) {
  const c = flat || flattenClient(records);
  if (!c.snaps.length && !c.frames.length) return { user: c.user, snapshots: 0 };
  const arrivals = analyzeArrivals(c.snaps, { serverIndex, offset: c.offset, frames: c.frames });
  const series = seriesFromFrames(c.frames, c.names);
  const truth = seriesFromDecoded(c.decoded, c.names);
  // A bounce is stamped at the last frame before it steps back; the snapshot
  // that ends a gap (and pulls an extrapolated actor back) lands up to ~150 ms
  // later.
  const gapNear = (t) => arrivals.gaps.find(g => g.serverT - c.offset <= t + 200 && g.serverT - c.offset >= t - 400);
  const correctionNear = (t) => c.corrections.find(x => Math.abs(x.t - t) <= 120);
  const frameHitch = (t) => c.frames.find(f => f[1] >= 50 && Math.abs(f[0] - t) <= 60);
  const MOVE_KEYS = new Set(["KeyA", "KeyD", "KeyW", "KeyS", "Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
  const inputNear = (t) => c.keys.some(k => MOVE_KEYS.has(k[1]) && k[0] >= t - 250 && k[0] <= t + 60);
  const classify = (e, kind, actor) => {
    const gap = gapNear(e.t);
    const corr = kind === "local" ? correctionNear(e.t) : null;
    const hitch = frameHitch(e.t);
    let cause, context = [];
    if (kind === "local" && !corr && inputNear(e.t)) { cause = "input"; }
    else if (corr) { cause = "correction"; context.push(`${corr.reason} ${corr.errorPx ?? "?"}px`); }
    else if (gap) { cause = { server: "server-stall", client: "client-frame-hitch" }[gap.cause] || "transport-gap"; context.push(`gap ${Math.round(gap.arrivalGapMs)}ms`); }
    else if (hitch) { cause = "client-frame-hitch"; context.push(`frame ${Math.round(hitch[1])}ms`); }
    else if (kind === "remote") {
      const real = truthReversed(truth.get(actor), e.t, e.dir);
      cause = real ? "real-movement" : "client-interpolation";
    } else cause = "unexplained";
    if (serverIndex?.inNav(e.t + c.offset)) context.push("nav build");
    return { kind, actor, serverT: e.t + c.offset, magnitudePx: e.magnitudePx, cause, context: context.join(", ") };
  };
  const localEvents = [
    ...detectSnaps(series.local).map(e => classify(e, "local", null)),
    ...detectBounces(series.local).map(e => classify(e, "local", null)),
  ];
  const remoteEvents = [];
  for (const [name, s] of series.remote) for (const e of detectBounces(s)) remoteEvents.push(classify(e, "remote", name));
  // Reversals the player pressed for, or that the server's own snapshots show,
  // are ordinary movement; only the rest count as rubber-banding.
  const EXPLAINED = new Set(["input", "real-movement"]);
  const byCause = {}, explained = {};
  for (const e of [...localEvents, ...remoteEvents]) {
    const bucket = EXPLAINED.has(e.cause) ? explained : byCause;
    bucket[e.cause] = (bucket[e.cause] || 0) + 1;
  }
  const suspect = (list) => list.filter(e => !EXPLAINED.has(e.cause));
  const frameTimes = c.frames.map(f => f[1]).filter(x => x > 0);
  const diags = c.diag.map(d => d.snapshot).filter(Boolean);
  const byReason = {};
  for (const x of c.corrections) byReason[x.reason || "?"] = (byReason[x.reason || "?"] || 0) + 1;
  return {
    user: c.user,
    offsetMs: c.offset,
    snapshots: c.snaps.length,
    ...arrivals,
    rttMin: fin(Math.min(...c.diag.map(d => d.clock?.bestRttMs).filter(Number.isFinite))),
    frames: c.frames.length,
    frameTime: { p50: quantile(frameTimes, 0.5), p95: quantile(frameTimes, 0.95), max: fin(max(frameTimes)),
      hitches: frameTimes.filter(x => x >= 50).length },
    render: {
      underruns: diags.length ? max(diags.map(d => d.underrunFrames)) : null,
      maxExtrapolationMs: fin(max(diags.map(d => d.maxExtrapolationMs))),
      interpDelayMin: diags.length ? Math.min(...diags.map(d => d.interpDelayMs).filter(Number.isFinite)) : null,
      interpDelayMax: fin(max(diags.map(d => d.interpDelayMs))),
    },
    corrections: { total: c.corrections.length, byReason, maxErrorPx: fin(max(c.corrections.map(x => x.errorPx))) },
    rubber: { local: suspect(localEvents), remote: suspect(remoteEvents), byCause, explained },
    attacks: analyzeAttacks(c, serverIndex, tag, { truth: serverTruth, remote: series.remote }),
    events: c.events,
  };
}

// ---- attacks ----------------------------------------------------------------
//
// Client combat rows are [t, what, ...] in client performance.now(); `offset`
// maps them onto server mono. Server "action" records are request receipts,
// "hit" records damage applications. A request's id ties it to its receipt;
// hits are tied to the latest earlier request of the same player.
const ATTACK_INPUTS = new Map([["KeyJ", 1], ["KeyI", 1], ["Mouse0", 0], ["Mouse2", 0]]);
const summary = (values) => {
  const v = values.filter(Number.isFinite);
  return v.length ? { n: v.length, p50: quantile(v, 0.5), p95: quantile(v, 0.95), max: max(v) } : { n: 0 };
};

// The request a prediction was drawn for: by the id it carries (a request id,
// or a projectile id that embeds it, "<owner>:<request>:<n>"), else the
// latest request before it.
export function requestOfPrediction(tx, p) {
  const id = p?.[3] == null ? null : String(p[3]);
  if (id) {
    const byId = tx.findLast(r => r[4] != null && (String(r[4]) === id || id.includes(`:${r[4]}:`) || id.endsWith(`:${r[4]}`)));
    if (byId) { byId.byId = true; return byId; }
  }
  return tx.findLast(r => r[0] <= p[0] + 1 && r[0] >= p[0] - 2500);
}

export function analyzeAttacks(c, serverIndex, tag, ctx = {}) {
  const rows = c.combat || [];
  const tx = rows.filter(r => r[1] === "tx");
  if (!tx.length && !rows.some(r => r[1] === "pred")) return null;
  const off = c.offset || 0;
  const toServer = (t) => t + off;
  const name = c.user;
  // Attack keys fire on key down (polled once per frame); mouse attacks fire on release.
  const presses = c.keys.filter(k => ATTACK_INPUTS.has(k[1]) && k[2] === ATTACK_INPUTS.get(k[1]));
  const actions = (serverIndex?.actions || []).filter(a => a.tag === tag);
  const hitsByMe = (serverIndex?.hits || []).filter(h => h.aTag === tag && h.ok && (h.dmg || 0) > 0);
  const hitsOnMe = (serverIndex?.hits || []).filter(h => h.vTag === tag && h.ok && (h.dmg || 0) > 0);
  const stallNear = (t0, t1) => (serverIndex?.loopStalls || []).some(s => s.t >= t0 && s.t - s.deltaMs <= t1);
  const hp = rows.filter(r => r[1] === "hp");
  const preds = rows.filter(r => r[1] === "pred");
  const sp = rows.filter(r => r[1] === "sp");
  const rtts = (c.diag || []).map(d => d.clock?.bestRttMs).filter(Number.isFinite);
  const rtt = rtts.length ? Math.min(...rtts) : 20;

  // Press -> request sent (the local attack plays in the same frame as the send).
  const pressToSend = [], sendToServer = [];
  const usedActions = new Set();
  for (const r of tx) {
    const press = presses.findLast(k => k[0] <= r[0] + 1 && k[0] >= r[0] - 250);
    r.press = press ? press[0] : null;
    if (press) pressToSend.push(r[0] - press[0]);
    const id = r[4] == null ? null : String(r[4]).slice(0, 40);
    const sent = toServer(r[0]);
    const action = actions.find(a => !usedActions.has(a) && (id ? a.id === id : a.ev === r[2]) && a.t >= sent - 200 && a.t <= sent + 2000);
    if (action) { usedActions.add(action); r.serverT = action.t; r.action = action; sendToServer.push(action.t - sent); }
  }

  // Each damaging hit: the request behind it, the prediction drawn for it, and
  // when this client saw the target's health change.
  const perHit = [];
  // A prediction belongs to the first hit after it from the request it was
  // drawn for; a later shot's hit must not be timed from it.
  const usedPreds = new Set();
  for (const h of hitsByMe) {
    const hitClient = h.t - off;
    const cause = tx.findLast(r => r[0] <= hitClient + 5 && r[0] >= hitClient - 2500);
    const health = hp.find(r => r[2] === h.v && r[0] >= hitClient - 5 && r[0] <= hitClient + 3000);
    const pred = preds.findLast(r => r[2] === h.v && !usedPreds.has(r) && r[0] <= (health ? health[0] : hitClient + 400) &&
      r[0] >= Math.max(hitClient - 1500, cause ? cause[0] - 1 : -Infinity));
    if (pred) usedPreds.add(pred);
    const superRow = sp.find(r => r[0] >= hitClient - 5 && r[0] <= hitClient + 3000);
    const contact = pred && Number.isFinite(pred[4]) ? { x: pred[4], y: pred[5] } : null;
    perHit.push({
      t: h.t, target: h.v, type: h.type, rewindMs: h.rewindMs, delivery: deliveryOfHit(h),
      drawnToTestedPx: contact && h.tested ? Math.round(Math.hypot(contact.x - h.tested[0], contact.y - h.tested[1])) : null,
      serverToClient: health ? health[0] + off - h.t : null,
      pressToConfirm: health && cause?.press != null ? health[0] - cause.press : null,
      sendToHit: cause?.serverT != null ? h.t - cause.serverT : null,
      predToConfirm: health && pred ? health[0] - pred[0] : null,
      hitToSuper: superRow ? superRow[0] + off - h.t : null,
      stall: stallNear(h.t - 300, health ? health[0] + off : h.t + 300),
    });
  }

  // A prediction with no damaging server hit on that target soon after it was
  // drawn is one the client will have withdrawn (or shown as a hit that never
  // landed). The window is the client's own confirmation window.
  const confirmWindow = Math.min(900, rtt + 220);
  const unconfirmed = [];
  const drawn = ctx.remote || seriesFromFrames(c.frames || [], c.names || []).remote;
  for (const p of preds) {
    const at = toServer(p[0]);
    const ok = hitsByMe.some(h => h.v === p[2] && h.t >= at - 400 && h.t <= at + confirmWindow + 50);
    if (ok) continue;
    // What the trace knows about it: the request it was drawn for, the view
    // rewind the server stamped against what the client asked for, and how far
    // the target the attacker drew was from where the server would test it
    // (snapshot truth at contact time minus the applied rewind; contact on the
    // server is about half an RTT after the client's).
    const cause = requestOfPrediction(tx, p);
    const action = cause?.action || null;
    const delivery = p[6] || deliveryOfAttack(c.character, cause?.[3]);
    const requested = action && Number.isFinite(action.viewMono) && Number.isFinite(action.sim) ? action.sim - action.viewMono : null;
    const applied = Number.isFinite(action?.rewindMs) ? Math.min(action.rewindMs, deliveryCapMs(delivery)) : null;
    // The contact point the client drew (pred rows since 2026-11), else the target's drawn position.
    const seen = Number.isFinite(p[4]) ? { x: p[4], y: p[5] } : interpAt(drawn.get(p[2]), p[0]);
    const tested = interpAt(ctx.truth?.get(p[2]), at + rtt / 2 - (applied ?? 0));
    unconfirmed.push({ t: at, target: p[2], stall: stallNear(at - 200, at + confirmWindow),
      id: p[3] ?? null, matchedById: !!cause?.byId, attack: cause?.[3] ?? null, delivery, sinceRequestMs: cause ? Math.round(p[0] - cause[0]) : null,
      rewindRequestedMs: fin(requested == null ? null : Math.round(requested)), rewindAppliedMs: applied,
      rewindCapped: requested != null && applied != null && requested > applied + 1,
      drawnToTestedPx: seen && tested ? Math.round(Math.hypot(seen.x - tested.x, seen.y - tested.y)) : null,
      drawnToTested: seen && tested ? [Math.round(tested.x - seen.x), Math.round(tested.y - seen.y)] : null });
  }
  const byType = {};
  for (const h of perHit) (byType[h.type || "?"] ||= []).push(h);
  return {
    character: c.character, requests: tx.length, presses: presses.length,
    pressToSend: summary(pressToSend), withinOneFrame: pressToSend.length ? pressToSend.filter(x => x <= 17).length / pressToSend.length : null,
    sendToServer: summary(sendToServer),
    hits: perHit.length,
    serverToClient: summary(perHit.map(h => h.serverToClient)),
    serverToClientStalled: summary(perHit.filter(h => h.stall).map(h => h.serverToClient)),
    predToConfirm: summary(perHit.map(h => h.predToConfirm)),
    pressToConfirm: summary(perHit.map(h => h.pressToConfirm)),
    sendToHit: summary(perHit.map(h => h.sendToHit)),
    hitToSuper: summary(perHit.map(h => h.hitToSuper)),
    rewindAsShooter: summary(perHit.map(h => h.rewindMs)),
    byType: Object.fromEntries(Object.entries(byType).map(([k, list]) => [k, {
      hits: list.length, predToConfirm: summary(list.map(h => h.predToConfirm)), pressToConfirm: summary(list.map(h => h.pressToConfirm)) }])),
    predictions: preds.length, unconfirmed: unconfirmed.length, unconfirmedDuringStall: unconfirmed.filter(u => u.stall).length,
    unconfirmedRate: preds.length ? unconfirmed.length / preds.length : null,
    unconfirmedList: unconfirmed,
    unconfirmedByDelivery: countBy(unconfirmed, u => u.delivery || "?"),
    predictionsByDelivery: countBy(preds.map(p => p[6] || deliveryOfAttack(c.character, requestOfPrediction(tx, p)?.[3])), d => d || "?"),
    // Confirmed hits: the target as this attacker drew it at contact against
    // where the server tested it (hit `tested`, since 2026-11).
    drawnToTestedConfirmed: summary(perHit.map(h => h.drawnToTestedPx)),
    hitsByDelivery: countBy(hitsByMe, h => deliveryOfHit(h)),
    withdrawnEvents: rows.filter(r => r[1] === "wd").length,
    hitsTaken: hitsOnMe.length, rewindAsVictim: summary(hitsOnMe.map(h => h.rewindMs)),
    // Raw values so several runs can be pooled per character.
    samples: {
      pressToSend: pressToSend.map(Math.round), pressToConfirm: perHit.map(h => h.pressToConfirm).filter(Number.isFinite).map(Math.round),
      predToConfirm: perHit.map(h => h.predToConfirm).filter(Number.isFinite).map(Math.round),
      serverToClient: perHit.map(h => h.serverToClient).filter(Number.isFinite).map(Math.round),
    },
  };
}

// ---- fairness ---------------------------------------------------------------
//
// Attacker truth: a hit drawn on my screen deals damage (unconfirmed
// predictions, above). Victim truth: if it did not touch me on my screen I take
// no damage. For every damaging hit a traced client took, compare where its own
// client drew it when the server applied the hit with where the server tested
// it (its position history `rewindMs` before the hit). The tested position
// comes from snapshot truth (another traced client's decoded snapshots of the
// victim, in server simulation time) when there is one, else from the victim's
// own timeline: the server's history of a human is what that human reported,
// so the position `rewindMs` before the hit is what the victim drew about
// rewindMs + RTT/2 earlier.

export const VICTIM_DISPLACEMENT_PX = 40;

const DELIVERY_CAP_MS = { attached: 150, released: 300, area: 0, self: 0 };
const deliveryCapMs = (d) => DELIVERY_CAP_MS[d] ?? 300;
const RELEASED_CHARS = new Set(["sparrow", "ninja", "gloop"]);

// Delivery of a request by attacker character and request type (tx rows,
// action records): see src/shared/combat/attackDelivery.js.
export function deliveryOfAttack(character, type) {
  const t = String(type || "").toLowerCase(), ch = String(character || "").toLowerCase();
  if (!t) return null;
  if (t === "special") return { thorg: "self", ozzy: "self", draven: "area" }[ch] || (RELEASED_CHARS.has(ch) ? "released" : null);
  if (/charge/.test(t)) return "attached";
  if (/thorg|draven|sweep|splash|fall/.test(t)) return "attached";
  if (/sparrow|ninja|gloop|shuriken|arrow|slime|hook|fireball/.test(t)) return "released";
  return null;
}

// Hit records carry `delivery` (from the attack runtime) since 2026-11; for
// older runs derive it from the attacker character and type, where an Ozzy
// "basic" hit may be the charging fireball (attached) or the released one and
// counts as released.
export function deliveryOfHit(h) {
  if (h?.delivery && h.delivery !== "none") return h.delivery;
  const ch = String(h?.aChar || "").toLowerCase(), t = String(h?.type || "").toLowerCase(), id = String(h?.id || "").toLowerCase();
  if (/charge/.test(t) || /charge/.test(id)) return "attached";
  if (RELEASED_CHARS.has(ch) || /arrow|shuriken|swarm|slime|hook/.test(t)) return "released";
  if (ch === "thorg" || ch === "draven") return t === "special" ? (ch === "draven" ? "area" : "self") : "attached";
  if (ch === "ozzy") return t === "special" ? "self" : "released";
  return "?";
}

let bodyFn;
export function bodyWidth(character) {
  try {
    bodyFn ||= require("../../src/shared/physics/characterBody.js").characterBody;
    const w = bodyFn(String(character || "ninja")).width;
    return Number.isFinite(w) ? w : 30;
  } catch (_) { return 30; }
}

// Position at time t from a time-sorted [{t, x, y}] series: interpolated
// between samples at most `maxGap` apart, else the nearest within `near` ms.
export function interpAt(series, t, { maxGap = 250, near = 80 } = {}) {
  if (!series?.length || !Number.isFinite(t)) return null;
  let lo = 0, hi = series.length - 1;
  if (t <= series[0].t) return series[0].t - t <= near ? series[0] : null;
  if (t >= series[hi].t) return t - series[hi].t <= near ? series[hi] : null;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (series[mid].t <= t) lo = mid; else hi = mid; }
  const a = series[lo], b = series[hi];
  if (b.t - a.t > maxGap) return t - a.t <= near ? a : b.t - t <= near ? b : null;
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// Server-time position history per player name from every traced client's
// decoded snapshots ([receivedAt, seq, tMono, (idx, x, y)*]).
export function buildTruth(flats) {
  const byName = new Map();
  for (const c of flats) {
    for (const row of c.decoded || []) {
      const t = row[2];
      if (!Number.isFinite(t)) continue;
      for (let i = 3; i + 2 < row.length; i += 3) {
        const name = c.names[row[i]] ?? null;
        if (!name || !Number.isFinite(row[i + 1])) continue;
        if (!byName.has(name)) byName.set(name, new Map());
        byName.get(name).set(t, { t, x: row[i + 1], y: row[i + 2] });
      }
    }
  }
  return new Map([...byName].map(([name, m]) => [name, [...m.values()].sort((a, b) => a.t - b.t)]));
}

const countBy = (list, key) => {
  const out = {};
  for (const x of list) { const k = key(x); out[k] = (out[k] || 0) + 1; }
  return out;
};

// How long after this client drew itself the server's history holds that
// position (input upload, one-way delay, step): the lag that best lines the
// client's own timeline up with snapshot truth of it. Null without truth.
export function calibrateUploadLag(local, own, offset = 0, { maxMs = 400, stepMs = 5, minSamples = 40 } = {}) {
  if (!local?.length || !own?.length || own.length < minSamples) return null;
  const sample = own.length > 600 ? own.filter((_, i) => i % Math.ceil(own.length / 600) === 0) : own;
  let best = null;
  for (let lag = 0; lag <= maxMs; lag += stepMs) {
    const errs = [];
    for (const s of sample) { const p = interpAt(local, s.t - offset - lag); if (p) errs.push(Math.hypot(s.x - p.x, s.y - p.y)); }
    if (errs.length < minSamples) continue;
    const err = errs.reduce((a, b) => a + b, 0) / errs.length;
    if (!best || err < best.err - 1e-9) best = { ms: lag, err, calibrated: true };
  }
  return best;
}

export function analyzeVictim(c, serverIndex, tag, { truth } = {}) {
  const hits = (serverIndex?.hits || []).filter(h => h.vTag === tag && h.ok && (h.dmg || 0) > 0);
  if (!hits.length) return { hits: 0 };
  const local = (c.frames || []).filter(f => Number.isFinite(f[2])).map(f => ({ t: f[0], x: f[2], y: f[3] }));
  const rtts = (c.diag || []).map(d => d.clock?.bestRttMs).filter(Number.isFinite);
  const rtt = rtts.length ? Math.min(...rtts) : 20;
  const off = c.offset || 0;
  const limitPx = VICTIM_DISPLACEMENT_PX;
  const halfBody = bodyWidth(c.character) / 2;
  const own = truth?.get(c.user);
  const uploadLag = calibrateUploadLag(local, own, off) ?? { ms: rtt / 2 + 25, calibrated: false };
  const actions = serverIndex?.actions || [];
  const list = [];
  for (const h of hits) {
    const sim = Number.isFinite(h.sim) ? h.sim : h.t;
    const rewind = Number(h.rewindMs) || 0;
    const drawn = interpAt(local, h.t - off);
    if (!drawn) continue;
    const testedAt = sim - rewind;
    const fromServer = Array.isArray(h.tested) ? { x: h.tested[0], y: h.tested[1] } : null;
    const fromTruth = fromServer ? null : interpAt(own, testedAt);
    const fromSelf = fromServer || fromTruth ? null : interpAt(local, testedAt - off - uploadLag.ms);
    const tested = fromServer || fromTruth || fromSelf;
    if (!tested) continue;
    const key = String(h.id || "").replace(/^[^:]*:(?=[a-z])/i, "").slice(0, 28);
    const action = key && !/^bot:/.test(key) ? actions.find(a => String(a.id || "").startsWith(key)) : null;
    list.push({
      t: h.t, attacker: h.a, bot: !!h.aBot, aChar: h.aChar, type: h.type, delivery: deliveryOfHit(h),
      rewindMs: rewind,
      displacementPx: Math.hypot(drawn.x - tested.x, drawn.y - tested.y), dx: tested.x - drawn.x, dy: tested.y - drawn.y,
      rewindRequestedMs: Number.isFinite(h.rewindReqMs) ? h.rewindReqMs : action && Number.isFinite(action.viewMono) ? Math.round(action.sim - action.viewMono) : null,
      ageMs: h.t - testedAt + uploadLag.ms, source: fromServer ? "server" : fromTruth ? "snapshot" : "self",
    });
  }
  const sum = (l) => ({
    n: l.length,
    px: summary(l.map(x => x.displacementPx)),
    ms: summary(l.map(x => x.ageMs)),
    overLimit: l.filter(x => x.displacementPx > limitPx).length,
    overHalfBody: l.filter(x => x.displacementPx > halfBody).length,
  });
  const byDelivery = {};
  for (const x of list) (byDelivery[x.delivery] ||= []).push(x);
  return {
    hits: hits.length, measured: list.length, limitPx, halfBodyPx: Math.round(halfBody), rttMs: rtt,
    uploadLagMs: Math.round(uploadLag.ms), uploadLagCalibrated: uploadLag.calibrated,
    sources: countBy(list, x => x.source),
    all: sum(list), byDelivery: Object.fromEntries(Object.entries(byDelivery).map(([k, l]) => [k, sum(l)])),
    fromHumans: sum(list.filter(x => !x.bot)),
    worst: list.slice().sort((a, b) => b.displacementPx - a.displacementPx).slice(0, 8)
      .map(x => ({ ...x, displacementPx: Math.round(x.displacementPx), dx: Math.round(x.dx), dy: Math.round(x.dy), ageMs: Math.round(x.ageMs) })),
  };
}

// ---- victim screen truth ------------------------------------------------------
//
// "If it did not touch me on my screen I take no damage", measured on the
// victim's own screen (client rows from match/victimScreenTrace.js): for each
// enemy released shot that could damage this client, the gap between the shot
// as drawn (with the victim lead) and this player's body as drawn, and whether
// the server then hit this player with it. A hit is screen-agreed when the
// drawn shot touched the drawn body (gap <= SCREEN_TOUCH_PX) at or before the
// server registered it (health-update arrival minus half the best RTT). A
// phantom touch is a shot that touched or held on the drawn body but never
// hit. The drawn->tested metric above is different: the victim's own drawn
// position against the rewound one the server tested (self-view staleness),
// which the lead does not change.

export const SCREEN_TOUCH_PX = 3;

// Raw per-shot and per-hit samples for one client, poolable across runs.
export function victimScreenSamples(c, serverIndex, tag) {
  const rows = c.combat || [];
  const shots = new Map();
  const shot = (id) => {
    if (!shots.has(id)) shots.set(id, { id, char: null, shooter: null, touched: false, holds: [], holdStart: null, hit: false });
    return shots.get(id);
  };
  const vh = [];
  const tracks = new Map();
  for (const r of rows) {
    if (r[1] === "es") Object.assign(shot(r[2]), { shooter: r[3], char: r[4], shown: r[0], targetLead: r[6], R: r[7], rtt2: r[8], P: r[9], uplink: r[11] ?? null });
    else if (r[1] === "et") shot(r[2]).touched = true;
    else if (r[1] === "eh") {
      const s = shot(r[2]);
      if (r[3]) s.holdStart = r[0];
      else if (s.holdStart != null) { s.holds.push(r[0] - s.holdStart); s.holdStart = null; }
    } else if (r[1] === "ee") Object.assign(shot(r[2]), { minGap: r[3], touchMs: r[6], maxLead: r[7] });
    else if (r[1] === "ea") {
      const pts = [];
      for (let i = 4; i + 2 < r.length; i += 3) pts.push([r[3] + r[i], r[i + 1], r[i + 2]]);
      tracks.set(String(r[2]), pts);
    } else if (r[1] === "vh") vh.push(r);
  }
  const serverHits = (serverIndex?.hits || []).filter(h => h.vTag === tag && h.ok && (h.dmg || 0) > 0);
  const charOf = (name) => serverHits.find(h => h.a === name)?.aChar || null;
  const hits = [];
  for (const r of vh) {
    const [t, , delivery, by, pid, gapNow, atReg, minToReg, touchLeadMs, traced] = r;
    const s = pid != null ? shots.get(String(pid)) : null;
    if (s) s.hit = true;
    hits.push({ t, delivery: delivery || "?", by, pid, char: s?.char || charOf(by), traced: !!traced,
      gapNow, atReg, minToReg, touchLeadMs, agreed: traced && Number.isFinite(minToReg) ? minToReg <= SCREEN_TOUCH_PX : null });
  }
  // A server hit on a shot whose health update the client did not tie to it
  // (older server, update lost) still means the shot hit.
  for (const h of serverHits) if (h.pid != null && shots.has(String(h.pid))) shots.get(String(h.pid)).hit = true;
  // A contact the server accepted without damage (ducked, shielded) still
  // stopped the shot on this player: not a phantom.
  const contacts = (serverIndex?.hits || []).filter(h => h.vTag === tag && h.ok);
  for (const h of contacts) if (h.pid != null && shots.has(String(h.pid))) shots.get(String(h.pid)).hit = true;
  const leads = leadErrorSamples(c, serverIndex, tag, { shots, tracks, serverHits: contacts });
  return {
    hits,
    leads,
    shots: [...shots.values()].filter(x => x.shown != null).map(x => ({ char: x.char, shooter: x.shooter, touched: x.touched, hit: x.hit,
      holdMs: x.holds.length ? Math.max(...x.holds) : null, minGap: x.minGap ?? null, maxLead: x.maxLead ?? null,
      targetLead: x.targetLead ?? null, R: x.R ?? null, rtt2: x.rtt2 ?? null, P: x.P ?? null, uplink: x.uplink ?? null })),
  };
}

// Lead error: what this victim drew at the instant the server tested.
// A server hit (or a "near" record: the shot's closest approach to this
// player's tested body) carries `vTs`, this client's own Date.now() of the
// frame whose position the server tested, and the shot's server age then.
// The flight age this client drew at that frame ("ea" track) should equal it:
// the difference (server age - drawn age, ms) is the lead error (positive:
// drawn behind, the lead is short), whatever the victim and shot were doing.
function trackAt(pts, t) {
  if (!pts?.length || !(t >= pts[0][0] - 20) || !(t <= pts[pts.length - 1][0] + 20)) return null;
  let i = 1;
  while (i < pts.length - 1 && pts[i][0] < t) i++;
  const a = pts[Math.max(0, i - 1)], b = pts[i] || a;
  const k = b[0] > a[0] ? Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0]))) : 0;
  // Ages extrapolate in time; a frame drawn before/after the track does too.
  const age = t < pts[0][0] ? pts[0][2] - (pts[0][0] - t) : t > pts[pts.length - 1][0] ? pts[pts.length - 1][2] + (t - pts[pts.length - 1][0]) : a[2] + (b[2] - a[2]) * k;
  return { age, gap: a[1] + (b[1] - a[1]) * k };
}

// The lead ramps in over this long after a shot first shows (sparrowReplication
// LEAD_RAMP_MS): a test of a frame before then compares a partly led flight.
const LEAD_RAMP_MS = 120;
// When, relative to the shot first showing on this screen, the tested frame was.
function testedPhase(shownAt, T) {
  if (!Number.isFinite(shownAt) || !Number.isFinite(T)) return null;
  return T < shownAt ? "unseen" : T < shownAt + LEAD_RAMP_MS ? "ramp" : "full";
}

export function leadErrorSamples(c, serverIndex, tag, { shots, tracks, serverHits }) {
  const offset = c.dateOffset;
  if (!Number.isFinite(offset)) return [];
  const out = [];
  const hitPids = new Set(serverHits.map(h => String(h.pid)));
  const seen = new Set();
  for (const h of serverHits) {
    if (h.delivery !== "released" || h.pid == null || !Number.isFinite(h.vTs) || seen.has(String(h.pid))) continue;
    seen.add(String(h.pid));
    const T = h.vTs - offset, at = trackAt(tracks.get(String(h.pid)), T), s = shots.get(String(h.pid));
    out.push({ kind: "hit", char: h.aChar || s?.char || null, err: at ? h.ageMs - at.age : null, gapAtTested: at ? at.gap : null,
      touched: !!s?.touched, serverGap: null, ageMs: h.ageMs, phase: testedPhase(s?.shown, T), sinceShownMs: s?.shown != null ? T - s.shown : null,
      // The same error had the lead used half the best ping for the uplink.
      errHalfPing: at && Number.isFinite(s?.uplink) && Number.isFinite(s?.rtt2) ? h.ageMs - at.age - (s.rtt2 - s.uplink) : null });
  }
  const near = (serverIndex?.near || []).filter(n => n.vTag === tag && n.pid != null && !hitPids.has(String(n.pid)));
  for (const n of near) {
    if (seen.has(String(n.pid))) continue;
    seen.add(String(n.pid));
    const s = shots.get(String(n.pid));
    const T = Number.isFinite(n.vTs) ? n.vTs - offset : NaN, at = Number.isFinite(T) ? trackAt(tracks.get(String(n.pid)), T) : null;
    out.push({ kind: "miss", char: n.aChar || s?.char || null, err: at ? n.ageMs - at.age : null, gapAtTested: at ? at.gap : null,
      touched: !!s?.touched, held: !!s?.holds?.length, serverGap: n.gap, ageMs: n.ageMs, phase: testedPhase(s?.shown, T),
      sinceShownMs: s?.shown != null && Number.isFinite(T) ? T - s.shown : null });
  }
  // Shots that touched this player's screen without a hit and without the
  // server's shot ever coming within the near-record range of the tested body.
  for (const s of shots.values()) {
    if (!s.touched || s.hit || seen.has(String(s.id))) continue;
    out.push({ kind: "miss", char: s.char, err: null, gapAtTested: null, touched: true, held: !!s.holds.length, serverGap: null, far: true });
  }
  return out;
}

// Stats from samples (one run, or several pooled).
export function summarizeVictimScreen(samples) {
  const hits = samples.hits || [], shots = samples.shots || [];
  const groups = { all: { hits, shots } };
  for (const h of hits) ((groups[h.char || "?"] ||= { hits: [], shots: [] }).hits).push(h);
  for (const x of shots) ((groups[x.char || "?"] ||= { hits: [], shots: [] }).shots).push(x);
  groups.all.leads = samples.leads || [];
  for (const x of samples.leads || []) (((groups[x.char || "?"] ||= { hits: [], shots: [] }).leads ||= []).push(x));
  const one = ({ hits: hs, shots: ss, leads: ls = [] }) => {
    const hitLeads = ls.filter(x => x.kind === "hit"), phantoms = ls.filter(x => x.kind === "miss" && x.touched);
    const released = hs.filter(h => h.delivery === "released");
    const traced = released.filter(h => h.traced);
    const missed = traced.filter(h => h.agreed === false);
    const touched = ss.filter(x => x.touched);
    const phantom = touched.filter(x => !x.hit);
    const attached = hs.filter(h => h.delivery === "attached" && Number.isFinite(h.gapNow));
    return {
      releasedHits: released.length, traced: traced.length, agreed: traced.length - missed.length,
      agreedShare: traced.length ? (traced.length - missed.length) / traced.length : null,
      // px by which "it did not touch me" was violated: the closest the drawn
      // shot came to the drawn body before the server hit.
      missGap: summary(missed.map(h => h.minToReg)), gapAtReg: summary(traced.map(h => h.atReg)),
      touchLeadMs: summary(traced.map(h => h.touchLeadMs)),
      shots: ss.length, touched: touched.length, phantom: phantom.length,
      phantomShare: touched.length ? phantom.length / touched.length : null,
      phantomHoldMs: summary(phantom.map(x => x.holdMs)),
      lead: summary(ss.map(x => x.maxLead)), targetLead: summary(ss.map(x => x.targetLead)),
      R: summary(ss.map(x => x.R)), rtt2: summary(ss.map(x => x.rtt2)), P: summary(ss.map(x => x.P)), uplink: summary(ss.map(x => x.uplink)),
      attachedHits: attached.length, attachedBodyGap: summary(attached.map(h => h.gapNow)),
      // Lead error (server age at the test - drawn age then, ms) for hits and
      // for phantom touches; the server's closest approach of phantoms (px,
      // tested body), how many never came within the near range, and screen
      // touches the server's shot missed by more than the touch margin.
      // Lead error only where the full lead was on screen at the tested frame;
      // hits whose tested frame came before the shot showed here ("unseen":
      // close-range shots no lead can show in time) are counted apart.
      leadErrHit: summary(hitLeads.filter(x => x.phase === "full").map(x => x.err)), hitTracked: hitLeads.filter(x => x.phase === "full" && Number.isFinite(x.err)).length, hitLeadN: hitLeads.length,
      leadErrRamp: summary(hitLeads.filter(x => x.phase === "ramp").map(x => x.err)),
      leadErrHitHalfPing: summary(hitLeads.filter(x => x.phase === "full").map(x => x.errHalfPing)),
      hitPhases: { unseen: hitLeads.filter(x => x.phase === "unseen").length, ramp: hitLeads.filter(x => x.phase === "ramp").length, full: hitLeads.filter(x => x.phase === "full").length },
      unseenByMs: summary(hitLeads.filter(x => x.phase === "unseen").map(x => -x.sinceShownMs)),
      phantomPhases: { unseen: phantoms.filter(x => x.phase === "unseen").length, ramp: phantoms.filter(x => x.phase === "ramp").length, full: phantoms.filter(x => x.phase === "full").length, far: phantoms.filter(x => x.far).length },
      gapAtTestedHit: summary(hitLeads.map(x => x.gapAtTested)),
      leadErrPhantom: summary(phantoms.filter(x => x.phase === "full").map(x => x.err)), phantomServerGap: summary(phantoms.map(x => x.serverGap)),
      phantomFar: phantoms.filter(x => x.far).length, phantomTraced: phantoms.length,
      leadErrMiss: summary(ls.filter(x => x.kind === "miss").map(x => x.err)),
    };
  };
  return Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, one(g)]));
}

export function analyzeVictimScreen(c, serverIndex, tag) {
  const samples = victimScreenSamples(c, serverIndex, tag);
  if (!samples.hits.length && !samples.shots.length) return null;
  return { touchPx: SCREEN_TOUCH_PX, ...summarizeVictimScreen(samples), samples };
}

// One line of victim screen truth ("all" group of a summary).
export function victimScreenLine(v) {
  const a = v?.all;
  if (!a) return "screen: no enemy shots traced";
  const n = (x) => (Number.isFinite(x) ? Math.round(x) : "-");
  return `screen agreed ${a.agreed}/${a.traced}${a.releasedHits > a.traced ? ` (+${a.releasedHits - a.traced} untraced)` : ""}` +
    `${a.missGap.n ? `, miss gap p50 ${n(a.missGap.p50)} p95 ${n(a.missGap.p95)}px` : ""}` +
    `, phantom ${a.phantom}/${a.touched}${a.phantomHoldMs.n ? ` hold p50 ${n(a.phantomHoldMs.p50)}ms` : ""}` +
    `, lead p50 ${n(a.lead.p50)}ms`;
}

// Trace fields the fairness metrics would need but do not have; the analysis
// estimates around them.
export const FAIRNESS_GAPS = [
  "the server's registration time of a hit on the victim's screen is estimated as the health update's arrival minus half the best RTT",
  "attached hits taken compare the attacker's drawn body with the victim's drawn body, not the attacker's drawn swing shape (remote swings are not traced)",
  "unconfirmed predictions have no server test; their tested position is snapshot truth at contact minus the applied rewind",
  "runs from before 2026-11 lack hit delivery/tested/rewindReqMs, pred ids and contact points, hp delivery and the victim screen rows; the older estimates apply",
];

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "-");

// One line per run: per client, attacker truth (unconfirmed predictions) and
// victim truth (displacement of hits taken).
export function fairnessSummary(report) {
  const parts = [];
  for (const [tag, c] of Object.entries(report.clients || {})) {
    const a = c.attacks, v = c.victim;
    const net = report.probe?.clients?.[tag]?.net?.name || (report.probe ? "fast" : null);
    const head = `${tag} ${a?.character || c.character || "?"}${net ? `[${net}]` : ""}`;
    const att = a ? `${a.requests} req ${a.hits} hits, unconfirmed ${a.unconfirmed}/${a.predictions} (${pct(a.unconfirmed, a.predictions)})` : "no attacks";
    const vic = v?.measured ? `took ${v.hits}: self-view drawn→tested p50 ${Math.round(v.all.px.p50)} p95 ${Math.round(v.all.px.p95)} max ${Math.round(v.all.px.max)}px, ${v.all.overLimit} >${v.limitPx}px` : `took ${v?.hits || 0}`;
    const flags = report.probe?.clients?.[tag]?.flags;
    parts.push(`${head}${flags ? `{${flags}}` : ""}: ${att}; ${vic}; ${victimScreenLine(c.screen)}`);
  }
  return parts.length ? `fairness: ${parts.join(" | ")}` : "fairness: no client data";
}

// ---- run ------------------------------------------------------------------

export function analyzeRun({ server: serverRecords, clients: clientRecords, probe = null }) {
  const server = analyzeServer(serverRecords);
  const idx = server._index;
  const flats = Object.fromEntries(Object.entries(clientRecords).map(([tag, records]) => [tag, flattenClient(records)]));
  const truth = buildTruth(Object.values(flats));
  const clients = {};
  for (const [tag, records] of Object.entries(clientRecords)) {
    clients[tag] = analyzeClient(records, idx, tag, { flat: flats[tag], truth });
    if (flats[tag].frames.length) clients[tag].victim = analyzeVictim(flats[tag], idx, tag, { truth });
    clients[tag].screen = analyzeVictimScreen(flats[tag], idx, tag);
    clients[tag].flags = flats[tag].events.find(e => e.type === "flags") || null;
    clients[tag].character = flats[tag].character;
  }

  // Timeline of notable seconds.
  const rows = [];
  for (const k of idx.ticks) {
    const host = idx.hostAt(k.t);
    const clientGaps = {};
    let rubber = 0;
    for (const [tag, c] of Object.entries(clients)) {
      const g = (c.gaps || []).filter(x => x.serverT <= k.t && x.serverT > k.t - 1000);
      if (g.length) clientGaps[tag] = Math.max(...g.map(x => x.arrivalGapMs));
      rubber += [...(c.rubber?.local || []), ...(c.rubber?.remote || [])].filter(e => e.serverT <= k.t && e.serverT > k.t - 1000).length;
    }
    const notable = (k.loop?.max ?? 0) >= LOOP_STALL_MS || (k.snap?.gapMax ?? 0) >= GAP_MS || (k.bots?.max ?? 0) > BOT_HEAVY_MS
      || Object.keys(clientGaps).length || rubber;
    if (!notable) continue;
    rows.push({ t: k.t, loopMax: k.loop?.max, snapGapMax: k.snap?.gapMax, botMax: k.bots?.max, botTotal: k.bots?.totalMs,
      nav: idx.inNav(k.t), load: host?.load1, elDelayMax: host?.loopDelayMax, clientGaps, rubber });
  }
  const t0 = idx.ticks[0]?.t ?? 0;
  for (const r of rows) r.t -= t0;
  for (const c of Object.values(clients)) {
    for (const g of c.gaps || []) g.serverT -= t0;
    for (const e of [...(c.rubber?.local || []), ...(c.rubber?.remote || [])]) e.serverT -= t0;
    for (const u of c.attacks?.unconfirmedList || []) u.t -= t0;
    for (const w of c.victim?.worst || []) w.t -= t0;
  }
  delete server._index;
  const report = { rooms: server.rooms, durationS: server.durationS, server, clients, timeline: rows, probe };
  report.fairness = { summary: fairnessSummary(report), gaps: FAIRNESS_GAPS };
  report.verdict = verdict(report);
  return report;
}

export function verdict(r) {
  const out = [];
  const s = r.server;
  const clients = Object.values(r.clients).filter(c => c.snapshots);
  const gaps = clients.reduce((n, c) => n + c.gaps.length, 0);
  const transport = clients.reduce((n, c) => n + c.gapCauses.transport, 0);
  const rubber = clients.reduce((n, c) => n + c.rubber.local.length + c.rubber.remote.length, 0);
  const causes = {};
  for (const c of clients) for (const [k, v] of Object.entries(c.rubber.byCause)) causes[k] = (causes[k] || 0) + v;
  if (!clients.length) out.push("No client data — check the token, run id, and that clients reached FIGHT.");
  if (s.loopStalls) {
    out.push(`Server loop stalled ${s.loopStalls}× (max ${Math.round(s.loopMax)}ms); ${s.attribution.withNav} overlapped navigation builds, ${s.attribution.withBots} had heavy bot ticks, ${s.attribution.withHostLoad} under host overload.`);
  } else out.push("Server loop stayed under 50ms per frame.");
  const clientSide = clients.reduce((n, c) => n + (c.gapCauses.client || 0), 0);
  if (gaps) out.push(`Clients saw ${gaps} snapshot gaps >=${GAP_MS}ms: ${gaps - transport - clientSide} server-side, ${transport} in transport, ${clientSide} from the client page freezing.`);
  const slow = clients.filter(c => (c.frameTime?.p50 ?? 0) > 25);
  if (slow.length) out.push(`Warning: ${slow.length} client(s) rendered below 40 fps (frame p50 ${slow.map(c => Math.round(c.frameTime.p50)).join("/")}ms); their data mostly reflects the client, not the network.`);
  if (rubber) out.push(`Rubber-band events: ${rubber} (${Object.entries(causes).map(([k, v]) => `${k} ${v}`).join(", ")}).`);
  else if (clients.length) out.push("No rubber-band events detected.");
  if ((s.botTotalMaxPerSecond ?? 0) > 100) out.push(`Bots used up to ${Math.round(s.botTotalMaxPerSecond)}ms of main-thread time in one second.`);
  return out;
}
