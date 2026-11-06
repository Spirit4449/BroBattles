// Run-scoped network tracing for production debugging.
//
// Off unless BB_NET_TRACE_TOKEN is set. A client opts in by sending
// { netTrace: { runId, tag, token } } in its Socket.IO handshake auth; every
// room such a socket joins then writes JSONL under <dir>/<runId>/. Writes are
// buffered and flushed once a second so tracing never blocks the game loop.
// See docs/development/networking.md#production-network-tracing.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { timingSafeEqual } = require("node:crypto");
const { monitorEventLoopDelay, PerformanceObserver, constants: perfConstants } = require("node:perf_hooks");

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TRACED_SOCKETS_PER_RUN = 8;
const MAX_RUN_BYTES = 50 * 1024 * 1024;
const MAX_CLIENT_BATCH_BYTES = 256 * 1024;
const MIN_CLIENT_BATCH_INTERVAL_MS = 400;
const RUN_IDLE_CLOSE_MS = 5 * 60 * 1000;
const RUN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const FLUSH_MS = 1000;
const TRACED_USER_TTL_MS = 6 * 60 * 60 * 1000;
const LOOP_STALL_MS = 50;
const SNAPSHOT_GAP_MS = 100;

function config(env = process.env) {
  const token = String(env.BB_NET_TRACE_TOKEN || "");
  return {
    token,
    enabled: token.length >= 16,
    dir: path.resolve(env.BB_NET_TRACE_DIR || path.join(process.cwd(), "data", "net-traces")),
  };
}

function tokensMatch(expected, provided) {
  const a = Buffer.from(String(expected || ""));
  const b = Buffer.from(String(provided || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function sanitizeId(value, fallback = null) {
  const text = String(value ?? "").trim();
  return ID_PATTERN.test(text) ? text : fallback;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

function createNetTraceRecorder({ env = process.env, now = () => performance.now(), wall = () => Date.now() } = {}) {
  const cfg = config(env);
  const runs = new Map(); // runId -> run
  let flushTimer = null;
  let hostTimer = null;
  let loopDelay = null;
  let lastCpu = null;
  let lastCpuAt = 0;
  let pruned = false;
  let gcObserver = null;
  const gc = { count: 0, ms: 0, max: 0, major: 0, majorMax: 0 };

  function pruneOldRuns() {
    if (pruned) return;
    pruned = true;
    try {
      for (const name of fs.readdirSync(cfg.dir)) {
        const full = path.join(cfg.dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory() && wall() - stat.mtimeMs > RUN_RETENTION_MS) {
          fs.rmSync(full, { recursive: true, force: true });
        }
      }
    } catch (_) {}
  }

  function ensureTimers() {
    if (!flushTimer) {
      flushTimer = setInterval(flushAll, FLUSH_MS);
      flushTimer.unref?.();
    }
    if (!hostTimer) {
      loopDelay = monitorEventLoopDelay({ resolution: 10 });
      loopDelay.enable();
      lastCpu = process.cpuUsage();
      lastCpuAt = now();
      // Garbage-collection pauses stop the game loop like any other main-thread work.
      try {
        gcObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            gc.count++; gc.ms += entry.duration; if (entry.duration > gc.max) gc.max = entry.duration;
            const major = entry.detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MAJOR;
            if (major) { gc.major++; if (entry.duration > gc.majorMax) gc.majorMax = entry.duration; }
          }
        });
        gcObserver.observe({ entryTypes: ["gc"] });
      } catch (_) { gcObserver = null; }
      hostTimer = setInterval(sampleHost, 1000);
      hostTimer.unref?.();
    }
  }

  function stopTimersIfIdle() {
    if (runs.size) return;
    clearInterval(flushTimer); flushTimer = null;
    clearInterval(hostTimer); hostTimer = null;
    loopDelay?.disable(); loopDelay = null;
    gcObserver?.disconnect(); gcObserver = null;
  }

  function getRun(runId) {
    let run = runs.get(runId);
    if (run) return run;
    pruneOldRuns();
    const dir = path.join(cfg.dir, runId);
    fs.mkdirSync(dir, { recursive: true });
    run = { runId, dir, files: new Map(), pending: new Map(), bytes: 0, sockets: new Set(),
      rooms: new Set(), lastActivity: wall(), truncated: false };
    runs.set(runId, run);
    ensureTimers();
    write(run, "server", { kind: "run", runId, pid: process.pid, host: os.hostname(),
      node: process.version, cpus: os.cpus().length, totalMemMb: Math.round(os.totalmem() / 1048576) });
    return run;
  }

  function write(run, file, record) {
    if (run.truncated) return;
    const line = JSON.stringify({ t: round(now(), 2), wall: wall(), ...record }) + "\n";
    run.bytes += line.length;
    if (run.bytes > MAX_RUN_BYTES) {
      run.truncated = true;
      const capLine = JSON.stringify({ t: now(), wall: wall(), kind: "truncated", maxBytes: MAX_RUN_BYTES }) + "\n";
      (run.pending.get("server") || run.pending.set("server", []).get("server")).push(capLine);
      return;
    }
    run.lastActivity = wall();
    let queue = run.pending.get(file);
    if (!queue) run.pending.set(file, (queue = []));
    queue.push(line);
  }

  function flushRun(run) {
    for (const [file, lines] of run.pending) {
      if (!lines.length) continue;
      let stream = run.files.get(file);
      if (!stream) {
        stream = fs.createWriteStream(path.join(run.dir, `${file}.jsonl`), { flags: "a" });
        stream.on("error", () => {});
        run.files.set(file, stream);
      }
      stream.write(lines.join(""));
      lines.length = 0;
    }
  }

  function closeRun(run) {
    flushRun(run);
    for (const stream of run.files.values()) stream.end();
    runs.delete(run.runId);
    for (const room of run.rooms) room._netTrace?.runs.delete(run);
    stopTimersIfIdle();
  }

  function flushAll() {
    const t = now();
    for (const run of runs.values()) {
      for (const room of run.rooms) flushRoom(room, t);
    }
    for (const run of [...runs.values()]) {
      flushRun(run);
      if (!run.sockets.size && wall() - run.lastActivity > RUN_IDLE_CLOSE_MS) closeRun(run);
    }
  }

  function sampleHost() {
    if (!runs.size || !loopDelay) return;
    const t = now();
    const cpu = process.cpuUsage(lastCpu);
    const elapsedMs = Math.max(1, t - lastCpuAt);
    lastCpu = process.cpuUsage();
    lastCpuAt = t;
    const record = {
      kind: "host",
      loopDelayP50: round(loopDelay.percentile(50) / 1e6),
      loopDelayP99: round(loopDelay.percentile(99) / 1e6),
      loopDelayMax: round(loopDelay.max / 1e6),
      cpuPct: round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 100),
      load1: round(os.loadavg()[0], 2),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      heapMb: Math.round(process.memoryUsage().heapUsed / 1048576),
      ...readProcCounters(),
      gc: { n: gc.count, ms: round(gc.ms), max: round(gc.max), major: gc.major, majorMax: round(gc.majorMax) },
      ...readMeminfo(),
    };
    gc.count = 0; gc.ms = 0; gc.max = 0; gc.major = 0; gc.majorMax = 0;
    loopDelay.reset();
    for (const run of runs.values()) write(run, "server", record);
  }

  // ---- socket / room wiring -------------------------------------------------

  // Called from the Socket.IO auth middleware. Returns the trace identity or null.
  function authorize(auth, fallbackTag) {
    if (!cfg.enabled) return null;
    const spec = auth && typeof auth === "object" ? auth.netTrace : null;
    if (!spec || !tokensMatch(cfg.token, spec.token)) return null;
    const runId = sanitizeId(spec.runId);
    if (!runId) return null;
    const tag = sanitizeId(spec.tag) || sanitizeId(String(fallbackTag || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32)) || "client";
    return { runId, tag };
  }

  function attachSocket(socket) {
    const trace = socket?.data?.netTrace;
    if (!trace) return null;
    const run = getRun(trace.runId);
    if (!run.sockets.has(socket.id) && run.sockets.size >= MAX_TRACED_SOCKETS_PER_RUN) return null;
    run.sockets.add(socket.id);
    socket.once("disconnect", (reason) => {
      run.sockets.delete(socket.id);
      write(run, "server", { kind: "socket", event: "disconnect", tag: trace.tag, socketId: socket.id, reason });
    });
    write(run, "server", { kind: "socket", event: "connect", tag: trace.tag, socketId: socket.id,
      user: socket.data.user?.name || null, transport: socket.conn?.transport?.name || null,
      address: socket.handshake?.headers?.["cf-connecting-ip"] ? "cf" : "direct" });
    return run;
  }

  // Accept one client batch. Returns false when rejected.
  function acceptClientBatch(socket, payload) {
    const trace = socket?.data?.netTrace;
    if (!trace) return false;
    const run = runs.get(trace.runId);
    if (!run || !run.sockets.has(socket.id)) return false;
    const t = wall();
    if (t - (socket.data._netTraceLastBatch || 0) < MIN_CLIENT_BATCH_INTERVAL_MS) return false;
    socket.data._netTraceLastBatch = t;
    let size = 0;
    try { size = Buffer.byteLength(JSON.stringify(payload)); } catch (_) { return false; }
    if (size > MAX_CLIENT_BATCH_BYTES) {
      write(run, "server", { kind: "client-batch-rejected", tag: trace.tag, size });
      return false;
    }
    write(run, trace.tag, { kind: "batch", tag: trace.tag, recvMono: round(now(), 2), size, data: payload });
    return true;
  }

  function attachRoom(room, socket) {
    const run = attachSocket(socket);
    if (!run) return;
    const state = room._netTrace ||= createRoomState();
    state.runs.add(run);
    state.sockets.set(socket.id, socket.data.netTrace.tag);
    run.rooms.add(room);
    write(run, "server", { kind: "room", matchId: room.matchId, modeId: room.matchData?.modeId || room.modeId || null,
      modeVariantId: room.matchData?.modeVariantId || null, map: room.matchData?.map ?? null,
      bots: room.botControllers?.size || 0, humans: [...room.players.values()].filter(p => !p.isBot).length,
      tag: socket.data.netTrace.tag, socketId: socket.id });
  }

  function createRoomState() {
    return {
      runs: new Set(),
      sockets: new Map(), // socketId -> tag
      loopDeltas: [], maxSteps: 0,
      snapGaps: [], snapBytes: 0, snapCount: 0, lastSnapMono: null,
      botTickMs: [], botSlowest: null,
      phases: {}, phaseMax: {}, stepMax: 0,
      inputs: new Map(), // socketId -> { count, gaps[], last, clamps }
      lastFlush: now(),
    };
  }

  function emitRoom(room, record) {
    const state = room._netTrace;
    if (!state) return;
    for (const run of state.runs) write(run, "server", { matchId: room.matchId, ...record });
  }

  // Opt-in CPU profile of the live game process for one traced match:
  // BB_NET_TRACE_CPU_PROFILE_S=<seconds> writes <run>/cpu.cpuprofile, starting
  // when the first traced room goes live. Summarize with cpuprofile-top.cjs.
  let profiling = null;
  function maybeProfile(room) {
    const seconds = Number(env.BB_NET_TRACE_CPU_PROFILE_S);
    if (!(seconds > 0) || profiling || room.status !== "active") return;
    const run = [...room._netTrace.runs][0];
    if (!run || run.profiled) return;
    run.profiled = true;
    try {
      const inspector = require("node:inspector");
      const session = new inspector.Session();
      session.connect();
      profiling = session;
      session.post("Profiler.setSamplingInterval", { interval: 1000 }, () => session.post("Profiler.enable", () => session.post("Profiler.start")));
      write(run, "server", { kind: "cpu-profile", event: "start", seconds });
      setTimeout(() => session.post("Profiler.stop", (error, result) => {
        if (!error && result?.profile) fs.writeFile(path.join(run.dir, "cpu.cpuprofile"), JSON.stringify(result.profile), () => {});
        write(run, "server", { kind: "cpu-profile", event: "stop", error: error?.message || null });
        session.disconnect();
        profiling = null;
      }), seconds * 1000).unref?.();
    } catch (_) { profiling = null; }
  }

  function flushRoom(room, t) {
    const s = room._netTrace;
    if (!s || !s.runs.size) return;
    maybeProfile(room);
    if (room._disposed) {
      for (const run of s.runs) run.rooms.delete(room);
      s.runs.clear();
      return;
    }
    const inputs = {};
    for (const [socketId, entry] of s.inputs) {
      const tag = s.sockets.get(socketId);
      if (!tag) continue;
      inputs[tag] = { n: entry.count, gapP95: round(percentile(entry.gaps, 0.95)), gapMax: round(Math.max(0, ...entry.gaps)) };
      entry.count = 0; entry.gaps.length = 0;
    }
    const writeBuffers = {};
    for (const [socketId, tag] of s.sockets) {
      const socket = room.io?.sockets?.sockets?.get?.(socketId);
      if (socket) writeBuffers[tag] = socket.conn?.writeBuffer?.length ?? null;
    }
    emitRoom(room, {
      kind: "tick",
      windowMs: round(t - s.lastFlush),
      status: room.status,
      loop: { n: s.loopDeltas.length, p50: round(percentile(s.loopDeltas, 0.5)), p95: round(percentile(s.loopDeltas, 0.95)),
        max: round(Math.max(0, ...s.loopDeltas)), maxSteps: s.maxSteps },
      snap: { n: s.snapCount, gapP95: round(percentile(s.snapGaps, 0.95)), gapMax: round(Math.max(0, ...s.snapGaps)),
        avgBytes: s.snapCount ? Math.round(s.snapBytes / s.snapCount) : 0 },
      bots: s.botTickMs.length ? { ticks: s.botTickMs.length, totalMs: round(s.botTickMs.reduce((a, b) => a + b, 0)),
        p95: round(percentile(s.botTickMs, 0.95), 2), max: round(Math.max(...s.botTickMs), 2), slowest: s.botSlowest } : null,
      inputs,
      writeBuffers,
      // Main-thread ms per phase of the fixed step over this window, and the
      // slowest single step of each.
      phases: Object.fromEntries(Object.entries(s.phases).map(([k, v]) => [k, round(v)])),
      phaseMax: Object.fromEntries(Object.entries(s.phaseMax).map(([k, v]) => [k, round(v, 2)])),
      stepMax: round(s.stepMax, 2),
    });
    s.phases = {}; s.phaseMax = {}; s.stepMax = 0;
    s.loopDeltas.length = 0; s.maxSteps = 0;
    s.snapGaps.length = 0; s.snapBytes = 0; s.snapCount = 0;
    s.botTickMs.length = 0; s.botSlowest = null;
    s.lastFlush = t;
  }

  // ---- hooks (all cheap no-ops for untraced rooms) ---------------------------

  function noteLoopFrame(room, { deltaMs, stepsThisFrame, sleepMs }) {
    const s = room._netTrace;
    if (!s?.runs.size) return;
    s.loopDeltas.push(deltaMs);
    if (stepsThisFrame > s.maxSteps) s.maxSteps = stepsThisFrame;
    if (deltaMs >= LOOP_STALL_MS || stepsThisFrame >= 4) {
      emitRoom(room, { kind: "stall", what: "loop", deltaMs: round(deltaMs), steps: stepsThisFrame, sleepMs,
        botsLastTickMs: s.botTickMs.length ? round(s.botTickMs[s.botTickMs.length - 1], 2) : null });
    }
  }

  function noteSnapshotEmit(room, snapshot) {
    const s = room._netTrace;
    if (!s?.runs.size) return;
    const mono = Number(snapshot?.tMono);
    let bytes = 0;
    try { bytes = Buffer.byteLength(JSON.stringify(snapshot)); } catch (_) {}
    s.snapCount++;
    s.snapBytes += bytes;
    if (Number.isFinite(mono) && s.lastSnapMono != null) {
      const gap = mono - s.lastSnapMono;
      s.snapGaps.push(gap);
      if (gap >= SNAPSHOT_GAP_MS) emitRoom(room, { kind: "stall", what: "snapshot", gapMs: round(gap), seq: snapshot.snapshotSeq, emitLagMs: round(now() - mono) });
    }
    if (Number.isFinite(mono)) s.lastSnapMono = mono;
  }

  function noteBotTick(room, controller, elapsedMs) {
    const s = room._netTrace;
    if (!s?.runs.size) return;
    s.botTickMs.push(elapsedMs);
    if (!s.botSlowest || elapsedMs > s.botSlowest.ms) {
      const p = controller?.player;
      s.botSlowest = { ms: round(elapsedMs, 2), name: p?.name || null, char: p?.char_class || null,
        objective: controller?.objective?.type || controller?.objective?.kind || null, pursuit: !!controller?.pursuit };
    }
  }

  function noteInput(room, socketId) {
    const s = room._netTrace;
    if (!s?.runs.size || !s.sockets.has(socketId)) return;
    const t = now();
    let entry = s.inputs.get(socketId);
    if (!entry) s.inputs.set(socketId, (entry = { count: 0, gaps: [], last: null }));
    if (entry.last != null) entry.gaps.push(t - entry.last);
    entry.last = t;
    entry.count++;
  }

  function noteCorrection(room, player, payload) {
    const s = room._netTrace;
    if (!s?.runs.size || !s.sockets.has(player?.socketId)) return;
    emitRoom(room, { kind: "correction", tag: s.sockets.get(player.socketId), id: payload.correctionId,
      reason: payload.reason, sequence: payload.sequence, errorPx: round(Number(payload.errorPx) || 0),
      x: round(payload.x), y: round(payload.y) });
  }

  // One fixed step's phase timings: { bots: ms, attacks: ms, ... }.
  function notePhases(room, phases, totalMs) {
    const s = room._netTrace;
    if (!s?.runs.size) return;
    for (const k in phases) {
      const v = phases[k];
      s.phases[k] = (s.phases[k] || 0) + v;
      if (!(s.phaseMax[k] >= v)) s.phaseMax[k] = v;
    }
    if (totalMs > s.stepMax) s.stepMax = totalMs;
  }

  // An attack request from a traced socket, after the view rewind was stamped.
  function noteAction(room, socketId, event, payload) {
    const s = room._netTrace;
    if (!s?.runs.size || !s.sockets.has(socketId)) return;
    const id = payload?.id ?? payload?.requestId ?? payload?.clientRequestId ?? null;
    emitRoom(room, { kind: "action", tag: s.sockets.get(socketId), ev: event, type: String(payload?.type || event).slice(0, 40),
      id: id == null ? null : String(id).slice(0, 40), rewindMs: round(Number(payload?.viewRewindMs)),
      viewMono: round(Number(payload?.viewMono)), sim: round(room._simulationMono), tick: room._tickId });
  }

  // Damage applied (or refused) where a traced player is the attacker or the
  // target. `rewindMs` is how far back the target was tested.
  function noteHit(room, attacker, targetName, info = {}) {
    const s = room._netTrace;
    if (!s?.runs.size) return;
    const tagOf = (p) => (p?.socketId ? s.sockets.get(p.socketId) : null) || null;
    const target = info.target || null;
    const aTag = tagOf(attacker), vTag = tagOf(target);
    if (!aTag && !vTag) return;
    emitRoom(room, { kind: "hit", a: attacker?.name || null, aTag, aChar: attacker?.char_class || null,
      aBot: !!attacker?.isBot, v: targetName, vTag, type: info.type || null, dmg: info.dmg ?? null,
      id: info.id == null ? null : String(info.id).slice(0, 40), rewindMs: round(Number(info.rewindMs)),
      ok: info.ok !== false, reason: info.reason || null, sim: round(room._simulationMono), tick: room._tickId });
  }

  // Token-verified probe accounts may play trophy-locked modes (Bank Bust) as
  // fresh guests. Process-local and time-limited.
  const tracedUsers = new Map(); // name -> expiresAt
  function markTracedUser(name) {
    if (cfg.enabled && name) tracedUsers.set(String(name), wall() + TRACED_USER_TTL_MS);
  }
  function isTracedUser(name) {
    const until = tracedUsers.get(String(name));
    if (!until) return false;
    if (until < wall()) { tracedUsers.delete(String(name)); return false; }
    return true;
  }

  // Global events (not tied to a room) go to every active run.
  function noteGlobal(record) {
    if (!runs.size) return;
    for (const run of runs.values()) write(run, "server", record);
  }

  return {
    enabled: cfg.enabled,
    dir: cfg.dir,
    authorize,
    attachRoom,
    acceptClientBatch,
    noteLoopFrame,
    noteSnapshotEmit,
    noteBotTick,
    noteInput,
    noteCorrection,
    notePhases,
    noteAction,
    noteHit,
    noteGlobal,
    markTracedUser,
    isTracedUser,
    isRoomTraced: (room) => !!room?._netTrace?.runs.size,
    flushAll,
    closeAll: () => { for (const run of [...runs.values()]) closeRun(run); },
  };
}

// Page faults of this process and system iowait since the previous sample:
// a loop blocked with little CPU is waiting on the disk (major faults, writes).
let lastProc = null;
function readProcCounters() {
  try {
    const stat = fs.readFileSync("/proc/self/stat", "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const minflt = Number(fields[7]), majflt = Number(fields[9]);
    const cpu = fs.readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
    const total = cpu.reduce((a, b) => a + b, 0), iowait = cpu[4];
    const status = fs.readFileSync("/proc/self/status", "utf8");
    const vol = Number(status.match(/^voluntary_ctxt_switches:\s+(\d+)/m)?.[1] || 0);
    const invol = Number(status.match(/^nonvoluntary_ctxt_switches:\s+(\d+)/m)?.[1] || 0);
    const prev = lastProc;
    lastProc = { minflt, majflt, total, iowait, vol, invol };
    if (!prev) return {};
    return { majflt: majflt - prev.majflt, minflt: minflt - prev.minflt,
      iowaitPct: round(((iowait - prev.iowait) / Math.max(1, total - prev.total)) * 100),
      ctxVol: vol - prev.vol, ctxInvol: invol - prev.invol };
  } catch (_) { return {}; }
}

function readMeminfo() {
  try {
    const text = fs.readFileSync("/proc/meminfo", "utf8");
    const kb = (key) => Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] || 0);
    return { memAvailMb: Math.round(kb("MemAvailable") / 1024),
      swapUsedMb: Math.round((kb("SwapTotal") - kb("SwapFree")) / 1024) };
  } catch (_) {
    return { memAvailMb: Math.round(os.freemem() / 1048576), swapUsedMb: null };
  }
}

const netTrace = createNetTraceRecorder();

module.exports = { netTrace, createNetTraceRecorder, tokensMatch, sanitizeId };
