// Pure analysis for network trace runs (see net-report.mjs). Takes parsed
// JSONL records and returns a report object; no I/O so tests can feed fixtures.
//
// Time domains: server records carry `t` = server performance.now(). Client
// batches carry client performance.now() stamps plus the client's estimate of
// server time, which maps client events onto the server timeline.

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

export function analyzeServer(records) {
  const run = records.find(r => r.kind === "run") || {};
  const rooms = records.filter(r => r.kind === "room");
  const ticks = records.filter(r => r.kind === "tick" && r.status === "active");
  const stalls = records.filter(r => r.kind === "stall");
  const loopStalls = stalls.filter(s => s.what === "loop");
  const snapStalls = stalls.filter(s => s.what === "snapshot");
  const hosts = records.filter(r => r.kind === "host");
  const nav = records.filter(r => r.kind === "nav");
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
    _index: { ticks, loopStalls, snapStalls, hosts, inNav, tickAt, hostAt },
  };
}

function dedupeRooms(rooms) {
  const byId = new Map();
  for (const r of rooms) if (!byId.has(r.matchId)) byId.set(r.matchId, r);
  return [...byId.values()].map(({ matchId, modeId, modeVariantId, map, bots, humans }) => ({ matchId, modeId, modeVariantId, map, bots, humans }));
}

// ---- client ---------------------------------------------------------------

export function flattenClient(records) {
  const out = { user: null, names: [], frames: [], snaps: [], decoded: [], corrections: [], keys: [], diag: [], events: [], offsets: [] };
  for (const r of records) {
    const d = r.kind === "batch" ? r.data : null;
    if (!d) continue;
    out.user ||= d.user;
    if (Array.isArray(d.names) && d.names.length >= out.names.length) out.names = d.names;
    for (const k of ["frames", "snaps", "decoded", "corrections", "keys", "diag", "events"]) {
      if (Array.isArray(d[k])) out[k].push(...d[k]);
    }
    if (Number.isFinite(d.serverNowAtSend) && Number.isFinite(d.sentAt)) out.offsets.push(d.serverNowAtSend - d.sentAt);
  }
  for (const s of out.snaps) if (Number.isFinite(s[6]) && Number.isFinite(s[0])) out.offsets.push(s[6] - s[0]);
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

function truthReversed(truth, t, dir, windowMs = 450) {
  if (!truth?.length) return null;
  const pts = truth.filter(p => p.t >= t - windowMs && p.t <= t + 150);
  for (let i = 1; i < pts.length; i++) if ((pts[i].x - pts[i - 1].x) * dir < -4) return true;
  return false;
}

export function analyzeClient(records, serverIndex) {
  const c = flattenClient(records);
  if (!c.snaps.length && !c.frames.length) return { user: c.user, snapshots: 0 };
  const arrivals = analyzeArrivals(c.snaps, { serverIndex, offset: c.offset, frames: c.frames });
  const series = seriesFromFrames(c.frames, c.names);
  const truth = seriesFromDecoded(c.decoded, c.names);
  const gapNear = (t) => arrivals.gaps.find(g => g.serverT - c.offset <= t + 30 && g.serverT - c.offset >= t - 400);
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
    events: c.events,
  };
}

// ---- run ------------------------------------------------------------------

export function analyzeRun({ server: serverRecords, clients: clientRecords }) {
  const server = analyzeServer(serverRecords);
  const idx = server._index;
  const clients = {};
  for (const [tag, records] of Object.entries(clientRecords)) clients[tag] = analyzeClient(records, idx);

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
  }
  delete server._index;
  const report = { rooms: server.rooms, durationS: server.durationS, server, clients, timeline: rows };
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
