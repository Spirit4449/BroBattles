import roomTransport from './helpers/roomTransport.js';
import { loadClientModule } from "./helpers/clientModule.js";
import wire from "../src/shared/networkWire.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createSnapshotBuffer, getRenderClockCorrection, getDeliveryClockCorrection } from "../src/client/game/match/snapshotBuffer.js";
import { sampleRemoteFrame, readNetworkExperiments, followRemotePosition, remoteLifeState } from "../src/client/game/scene/remoteSmoothing.js";
import roomState from "../src/server/core/gameRoom/roomStateManager.js";
import roomModule from "../src/server/core/gameRoom/index.js";

const packet = (seq, time, extra = {}) => ({
  snapshotEpoch: "room-a", snapshotSeq: seq, tickId: Math.floor(time / (1000 / 60)),
  tMono: time, sentMono: time, snapshotKind: "periodic",
  players: { p: { x: time / 10, y: 0, vx: 100, vy: 0, grounded: true } }, ...extra,
});

test("immediate snapshots share simulation time but have distinct emission sequences", () => {
  const sent = [];
  const room = { ...roomTransport, matchId: 1, players: new Map(), tickId: 60, simulationMono: 1000,
    io: { to: () => ({ compress() { return this; }, emit(_, p) { sent.push(wire.decodeWire(p)); } }) } };
  roomState.broadcastSnapshot(room, { tMono: 1000 });
  roomState.broadcastSnapshot(room);
  room.tickId = 62; room.simulationMono += 1000 / 30;
  roomState.broadcastSnapshot(room, { tMono: room.simulationMono });
  const b = createSnapshotBuffer();
  sent.forEach((p, i) => {
    assert.equal(p.snapshotSeq, i + 1);
    assert.equal(p.snapshotEpoch, sent[0].snapshotEpoch);
    assert.equal(b.ingestSnapshot(p, 1050 + i * 10).snapMono, p.tMono);
  });
  assert.equal(sent[1].snapshotKind, "event");
  assert.equal(sent[1].tMono, sent[0].tMono);
  assert.equal(b.getBufferLength(), 2);
});

test("newer same-tick state replaces the frame; stale sequences cannot rewind it", () => {
  const b = createSnapshotBuffer();
  b.ingestSnapshot(packet(1, 1000), 1050);
  b.ingestSnapshot(packet(2, 1000, { snapshotKind: "event", players: { p: { x: 200 } } }), 1051);
  assert.equal(b.getBufferLength(), 1);
  assert.equal(b.sampleAt(1000).bState.players.p.x, 200);
  assert.equal(b.ingestSnapshot(packet(1, 1000), 1052).accepted, false);
  assert.equal(b.ingestSnapshot(packet(3, 999), 1053).reason, "stale-time");
  assert.equal(b.sampleAt(1000).bState.players.p.x, 200);
});

test("epoch changes and reconnect resets accept a fresh lower timeline", () => {
  const b = createSnapshotBuffer();
  b.ingestSnapshot(packet(100, 9000), 10000);
  const gen = b.getGeneration();
  assert.equal(b.ingestSnapshot(packet(1, 100, { snapshotEpoch: "room-b" }), 10050).accepted, true);
  assert.equal(b.getBufferLength(), 1);
  assert.ok(b.getGeneration() > gen);
  b.reset();
  assert.equal(b.hasData(), false);
  assert.equal(b.ingestSnapshot(packet(1, 50), 11000).accepted, true);
});

test("legacy bootstrap wall times do not contaminate the monotonic timeline", () => {
  const b = createSnapshotBuffer();
  b.ingestSnapshot({ timestamp: 1700000000000, players: {} }, 50);
  assert.equal(b.ingestSnapshot(packet(1, 1000), 100).snapMono, 1000);
  assert.equal(b.getBufferLength(), 1);
});

function arrivalTrace(bursty, options = {}, sourceStall = false) {
  const b = createSnapshotBuffer(options);
  for (let i = 0; i < 90; i++) {
    const t = i * 1000 / 30;
    const arrival = bursty ? Math.floor(i / 5) * 5000 / 30 + 200 : t + 50;
    b.ingestSnapshot(packet(i + 1, t, { sentMono: sourceStall ? arrival - 50 : t }), arrival);
  }
  return b.getDiagnostics();
}

test("arrival jitter distinguishes network bunching from source stalls; the legacy delay ignores it", () => {
  const legacy = { delayMode: "spacing" };
  const steady = arrivalTrace(false, legacy), bursty = arrivalTrace(true, legacy);
  assert.ok(steady.arrivalJitterEma < 0.001);
  assert.ok(bursty.arrivalJitterEma > 20);
  assert.ok(Math.abs(steady.interpDelayMs - bursty.interpDelayMs) < 0.001);
  assert.ok(arrivalTrace(true, legacy, true).arrivalJitterEma < 0.001);
});

// Feeds 30 Hz snapshots delivered `base + extra(i)` ms after their simulation
// time and renders 60 Hz frames between them. Returns per-phase delays and
// underrun counts.
function renderLink(extra, { snapshots = 600, options = {}, interval = 1000 / 30 } = {}) {
  const b = createSnapshotBuffer({ maxStateBuffer: 400, ...options });
  if (options.setInterval) b.setSnapshotIntervalMs(options.setInterval);
  const arrivals = [];
  for (let i = 0; i < snapshots; i++) arrivals.push({ i, sim: i * interval, at: i * interval + 50 + extra(i) });
  arrivals.sort((a, b) => a.at - b.at);
  const delays = [], underruns = [];
  let k = 0;
  for (let t = 50; t < snapshots * interval; t += 1000 / 60) {
    while (k < arrivals.length && arrivals[k].at <= t) {
      const a = arrivals[k++];
      b.ingestSnapshot(packet(a.i + 1, a.sim), a.at);
    }
    if (!b.hasData()) continue;
    const frame = b.getInterpolationFrame(t);
    delays.push({ t, delay: b.getDiagnostics().interpDelayMs });
    if (frame.extrapolationMs > 0) underruns.push(t);
  }
  const delayAt = (t) => delays.find((d) => d.t >= t)?.delay;
  return { delays, underruns, delayAt, buffer: b };
}

test("on a clean link the render delay converges near one snapshot interval", () => {
  const interval = 1000 / 30;
  const clean = renderLink(() => 0);
  const settled = clean.delayAt(15000);
  assert.ok(settled >= interval, `at least one interval (${settled})`);
  assert.ok(settled < interval * 1.5, `well under two intervals (${settled})`);
  assert.equal(clean.underruns.filter((t) => t > 5000).length, 0, "no underruns once settled");
  // The legacy target keeps about two intervals on the same link.
  const legacy = renderLink(() => 0, { options: { delayMode: "spacing" } });
  assert.ok(legacy.delayAt(15000) > settled + interval / 2);
  // The interval comes from the room (game:init) rather than the build.
  const fast = renderLink(() => 0, { interval: 1000 / 60, snapshots: 1200, options: { setInterval: 1000 / 60 } });
  assert.ok(fast.delayAt(15000) < settled - 1000 / 120, `a 60 Hz room renders closer (${fast.delayAt(15000)})`);
  assert.ok(fast.buffer.getSnapshotIntervalMs() < interval);
});

test("late arrivals raise the delay quickly and it gives latency back slowly", () => {
  // Clean for 8 s, then every 3rd snapshot 40 ms late for 6 s, then clean.
  let seed = 3;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const jitter = Array.from({ length: 900 }, (_, i) => (i >= 240 && i < 420 && i % 3 === 0 ? 40 * random() + 20 : 0));
  const link = renderLink((i) => jitter[i], { snapshots: 900 });
  const clean = link.delayAt(7900);
  const raised = link.delayAt(9000);
  assert.ok(raised > clean + 20, `rose within a second of late arrivals (${clean} -> ${raised})`);
  const lateUnderruns = link.underruns.filter((t) => t > 9000 && t < 14000).length;
  const earlyUnderruns = link.underruns.filter((t) => t > 8000 && t < 9000).length;
  assert.ok(lateUnderruns <= earlyUnderruns, "once raised, late snapshots stop underrunning");
  const peak = Math.max(...link.delays.filter((d) => d.t > 8000 && d.t < 14500).map((d) => d.delay));
  // After the late arrivals stop, the delay falls back gradually.
  const change = (windowMs, sign) => Math.max(...link.delays.map((d) => {
    const later = link.delayAt(d.t + windowMs);
    return later == null ? 0 : sign * (later - d.delay);
  }));
  assert.ok(change(500, 1) > 2 * change(500, -1), "rises faster than it falls");
  assert.ok(link.delayAt(29000) < clean + 1 && link.delayAt(29000) < peak - 20, "returns to the clean delay");
  for (let i = 1; i < link.delays.length; i++) {
    const step = link.delays[i].delay - link.delays[i - 1].delay;
    // Never faster than real time in either direction: motion never reverses.
    assert.ok(Math.abs(step) < 1000 / 60, `delay step ${step}`);
  }
});

test("event packets do not change periodic cadence or jitter measurements", () => {
  const b = createSnapshotBuffer();
  b.ingestSnapshot(packet(1, 1000), 1050);
  b.ingestSnapshot(packet(2, 1016, { snapshotKind: "event" }), 1066);
  b.ingestSnapshot(packet(3, 1033), 1083);
  assert.equal(b.getDiagnostics().spacingEma, 33);
  assert.equal(b.getDiagnostics().arrivalJitterEma, 0);
});

test("underrun metrics and extrapolation remain bounded and sampling is read-only", () => {
  const b = createSnapshotBuffer({ extrapolationLimitMs: 100, enableBacklogCatchup: false });
  b.ingestSnapshot(packet(1, 1000), 1050);
  b.ingestSnapshot(packet(2, 1033), 1083);
  for (let t = 1050; t <= 2000; t += 16) b.getInterpolationFrame(t);
  const before = b.getDiagnostics();
  assert.ok(before.underrunFrames > 0);
  assert.ok(before.maxExtrapolationMs <= 100);
  b.sampleAt(100000);
  assert.deepEqual(b.getDiagnostics(), before);
});

test("continuous precision crosses snapshot boundaries and exits without reversing time", () => {
  const b = createSnapshotBuffer({ maxStateBuffer: 240 });
  for (let i = 0; i < 150; i++) b.ingestSnapshot(packet(i + 1, i * 1000 / 30), i * 1000 / 30 + 50);
  const state = {};
  let previous = -Infinity;
  for (let t = 1000; t < 2000; t += 1000 / 120) {
    const base = b.sampleAt(t);
    const frame = sampleRemoteFrame(b, base, state, { attack: t < 1600, deltaMs: 1000 / 120, legacyLead: true });
    const x = frame.aState.players.p.x + frame.alpha * (frame.bState.players.p.x - frame.aState.players.p.x);
    assert.ok(x > previous, `stalled or reversed at ${t}`);
    assert.ok(frame.targetMono - base.targetMono <= 12.001);
    previous = x;
  }
  // By default attacking and airborne actors are drawn at the reported view
  // time itself, so the server's rewind matches what the attacker saw.
  const fresh = {};
  for (let t = 1000; t < 1400; t += 1000 / 60) {
    const base = b.sampleAt(t);
    for (const options of [{ attack: true }, { airborne: true }]) {
      assert.equal(sampleRemoteFrame(b, base, fresh, { ...options, deltaMs: 1000 / 60 }).targetMono, base.targetMono);
    }
  }
  b.reset(); b.ingestSnapshot(packet(1, 100), 110);
  assert.equal(sampleRemoteFrame(b, b.sampleAt(100), state).targetMono, 100);
  assert.equal(readNetworkExperiments("?netSmoothing=legacy").continuousSmoothing, undefined);
  assert.equal(readNetworkExperiments("").delayMode, "arrival");
  assert.equal(readNetworkExperiments("?netRenderDelay=legacy").delayMode, "spacing");
  assert.equal(readNetworkExperiments("").legacyInputCadence, false);
  assert.equal(readNetworkExperiments("?netInputCadence=legacy").legacyInputCadence, true);
});

function runLoop(t, coalesce, stall, finishAt = null, combatPaused = false) {
  let clock = 0, callback;
  t.mock.method(performance, "now", () => clock);
  t.mock.method(globalThis, "setTimeout", (fn) => { callback = fn; return 1; });
  const events = [];
  const noop = () => {};
  const room = Object.assign(Object.create(roomModule.GameRoom.prototype), {
    status: "active", _netTestEnabled: true, tickId: 0,
    FIXED_DT_MS: 1000 / 60, SNAPSHOT_EVERY_TICKS: 2, WORLD_STATE_EVERY_TICKS: 8,
    COALESCE_SNAPSHOTS: coalesce, powerups: new Map(), deathDrops: new Map(), players: new Map(),
    gameMode: {
      isCombatPaused: () => combatPaused,
      tick() { events.push({ type: "mode" }); },
    },
    _spawnPowerup: noop, _tickPowerupEffects: noop, processRegen: noop,
    _tickTimerAndSuddenDeath: noop, _tickPowerups: noop, _tickDeathDrops: noop,
    processTick() {
      events.push({ type: "simulation", tick: this.tickId });
      if (this.tickId === 4) events.push({ type: "respawn" });
      if (this.tickId === finishAt) this._loopRunning = false;
    },
    _emitSnapshotWithTiming(time) { events.push({ type: "snapshot", tick: this.tickId, time }); },
    broadcastWorldState() { events.push({ type: "world" }); },
  });
  room.sparrowCombatState = { active: new Map(), pending: [], requests: new Map(), terminals: [], metrics: [] };
  room.startGameLoop(); clock = stall; callback();
  return { room, events };
}

test("catch-up retains all steps and discrete events but publishes final state once", (t) => {
  const { room, events } = runLoop(t, true, 1000);
  assert.equal(room.tickId, 60);
  assert.equal(events.filter(e => e.type === "simulation").length, 60);
  assert.equal(events.filter(e => e.type === "respawn").length, 1);
  const snapshots = events.filter(e => e.type === "snapshot");
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].tick, 60);
  assert.equal(events.filter(e => e.type === "world").length, 1);
});

test("publication rollback keeps the old cadence", (t) => {
  const { events } = runLoop(t, false, 1000);
  assert.equal(events.filter(e => e.type === "snapshot").length, 30);
  assert.equal(events.filter(e => e.type === "world").length, 7);
});

test("a combat pause keeps mode ticks and snapshots running", (t) => {
  const { room, events } = runLoop(t, true, 1000, null, true);
  assert.equal(events.filter(e => e.type === "mode").length, room.tickId);
  assert.equal(events.filter(e => e.type === "simulation").length, 0);
  assert.equal(events.filter(e => e.type === "snapshot").length, 1);
});

test("ordinary ticks preserve 30 Hz cadence and a terminal tick stops catch-up", (t) => {
  const { events } = runLoop(t, true, 34);
  assert.equal(events.filter(e => e.type === "simulation").length, 2);
  assert.equal(events.filter(e => e.type === "snapshot").length, 1);
});

test("match finish cannot run additional catch-up ticks or publish a stale frame", (t) => {
  const { events } = runLoop(t, true, 1000, 4);
  assert.equal(events.filter(e => e.type === "simulation").length, 4);
  assert.equal(events.filter(e => e.type === "snapshot").length, 0);
});


test("remote sprites advance every render frame across snapshot and precision transitions", () => {
  for (const hz of [60, 120, 144, 240]) {
    const b = createSnapshotBuffer({ maxStateBuffer: 240 });
    for (let i = 0; i < 150; i++) b.ingestSnapshot(packet(i + 1, i * 1000 / 30), i * 1000 / 30 + 50);
    const state = {}, sprite = { x: 100, y: 0 };
    const dt = 1000 / hz;
    for (let i = 1; i <= hz; i++) {
      const time = 1000 + i * dt;
      const frame = sampleRemoteFrame(b, b.sampleAt(time), state, {
        attack: i < hz / 3, airborne: i < hz * 2 / 3, deltaMs: dt,
      });
      const x = frame.aState.players.p.x + frame.alpha * (frame.bState.players.p.x - frame.aState.players.p.x);
      const previous = sprite.x;
      followRemotePosition(sprite, x, 0, { deltaMs: dt });
      assert.ok(sprite.x > previous, `held sprite at ${hz} Hz frame ${i}`);
      assert.ok(Math.abs(sprite.x - x) < 1e-8, "ordinary motion follows the interpolated target exactly");
    }
  }
});

test("continuous follower preserves tiny movement and limits correction without overshoot", () => {
  const sprite = { x: 0, y: 0 };
  for (let i = 1; i <= 240; i++) {
    followRemotePosition(sprite, i * 0.05, 0, { deltaMs: 1000 / 240 });
    assert.equal(sprite.x, i * 0.05);
  }
  followRemotePosition(sprite, 100, 0, { deltaMs: 10 });
  assert.equal(sprite.x, 27);
  followRemotePosition(sprite, 26.95, 0, { deltaMs: 10 });
  assert.equal(sprite.x, 26.95, "small direction reversals are not suppressed");
  followRemotePosition(sprite, 2000, 0, { deltaMs: 10 });
  assert.equal(sprite.x, 2000, "teleports retain the existing snap safeguard");
});

test("timeline recovery matches across refresh rates and cannot reverse frame progress", () => {
  for (const initialLag of [150, -80, 1000, -1000]) {
    const results = [60, 120, 144, 240].map(hz => {
      let lag = initialLag;
      const dt = 1000 / hz;
      for (let i = 0; i < hz; i++) {
        const correction = getRenderClockCorrection(lag, dt);
        assert.ok(dt + correction > 0);
        lag -= correction;
      }
      return lag;
    });
    assert.ok(Math.max(...results) - Math.min(...results) < 1e-8);
  }
  assert.equal(getRenderClockCorrection(1000, 0), 0);
  assert.equal(getRenderClockCorrection(120, 16), 0);
  assert.equal(getRenderClockCorrection(-60, 16), 0);
});


test("snapshot ingest exposes transit and source gaps independently, with bounded default extrapolation", () => {
  const b=createSnapshotBuffer();
  b.ingestSnapshot(packet(1,0),0);
  const received=b.ingestSnapshot(packet(2,33),200);
  assert.equal(received.arrivalGapMs,200);
  assert.equal(received.sourceGapMs,33);
  const event=b.ingestSnapshot(packet(3,33,{snapshotKind:'event'}),205);
  assert.equal(event.arrivalGapMs,0);
  for(let t=210;t<2200;t+=17)b.getInterpolationFrame(t);
  assert.ok(b.getDiagnostics().maxExtrapolationMs<=250);
});

test("rendered remote delay matches the configured interpolation delay", () => {
  const lagAfter = (firstDelay) => {
    const b = createSnapshotBuffer({ maxStateBuffer: 400, enableAdaptiveDelay: false });
    let frame = null;
    for (let i = 0; i < 300; i++) {
      const sim = i * 1000 / 30;
      b.ingestSnapshot(packet(i + 1, sim), sim + 50 + (i === 0 ? firstDelay : 0));
      for (let t = sim + 50; t < sim + 50 + 1000 / 30; t += 1000 / 144) frame = b.getInterpolationFrame(t);
    }
    // Render delay behind the newest snapshot's steady 50 ms delivery.
    return (300 - 1) * 1000 / 30 + 1000 / 30 - frame.targetMono;
  };
  // The configured 75 ms delay is what is rendered, plus at most one interval of
  // arrival phase. (A startup clamp used to leave only ~15-48 ms of cushion.)
  for (const firstDelay of [0, 100, -30]) {
    const lag = lagAfter(firstDelay);
    assert.ok(lag >= 75 - 2 && lag <= 75 + 1000 / 30 + 2, `first delay ${firstDelay}: lag ${lag}`);
  }
});

test("delivery steering is a bounded slew that never reverses the timeline", () => {
  for (const hz of [60, 144, 240]) {
    const dt = 1000 / hz;
    for (const error of [1000, -1000, 40, -40]) {
      const c = getDeliveryClockCorrection(error, dt);
      assert.ok(Math.abs(c) <= dt * 0.08 + 1e-12);
      assert.ok(dt + c > 0);
    }
  }
  assert.equal(getDeliveryClockCorrection(2, 16), 0);
});

test("snapshots drawn after a death or respawn event cannot undo it", () => {
  // Real buffer: 30 Hz snapshots; the player dies after snapshot 10 and
  // respawns at x=100 after snapshot 20.
  const b = createSnapshotBuffer({ maxStateBuffer: 240 });
  const alive = (seq) => seq <= 10 || seq > 20;
  for (let seq = 1; seq <= 30; seq++) {
    const t = seq * 1000 / 30;
    b.ingestSnapshot(packet(seq, t, { players: { p: { x: seq > 20 ? 100 : 900, y: 0, isAlive: alive(seq) } } }), t + 50);
  }
  const at = (seq) => b.sampleAt(seq * 1000 / 30 + 10);
  const life = (sample, event) => remoteLifeState(event, sample.aState, sample.aState.players.p, sample.bState, sample.bState.players.p);
  const died = { epoch: "room-a", afterSeq: 10, dead: true };
  const respawned = { epoch: "room-a", afterSeq: 20, dead: false };

  // Without an event the snapshots decide, as before.
  assert.equal(life(at(5), null).dead, false);
  assert.equal(life(at(12), null).dead, true);

  // Snapshots 9-10 still show the player alive; the death event wins.
  assert.equal(life(at(9), died).dead, true);
  assert.equal(life(at(10), died).dead, true);

  // Snapshots before the respawn show the corpse at the death spot.
  assert.deepEqual(life(at(19), respawned), { dead: false, holdPosition: true, newestOnly: false });
  assert.deepEqual(life(at(20), respawned), { dead: false, holdPosition: false, newestOnly: true });
  assert.deepEqual(life(at(22), respawned), { dead: false, holdPosition: false, newestOnly: false });

  // Another room's sequence numbers are not compared with the event.
  assert.equal(life(at(19), { ...respawned, epoch: "room-b" }).dead, true);
});

test('input wire saves geometry and FX repetition while reliably delivering new effects', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const filename = require.resolve('../src/client/game/scene/localInputSync.js');
  const realRequire = createRequire(filename);
  const exports = {};
  let now = 10000;
  loadClientModule(filename, { exports, Date: { now: () => now }, require(name) {
    if (name.includes('localMovementCorrector')) return { localMovementCorrector: { getAck: () => 0, recordSent() {} } };
    if (name.includes('netTestLogger')) return { noteClientInputSent() {}, noteClientIntentSent() {} };
    return realRequire(name);
  } });
  const sent = [];
  const emitter = reliable => ({ compress() { return this; }, emit(event, data) {
    sent.push({ reliable, data: wire.decodeWire(JSON.parse(JSON.stringify(data))) });
  } });
  const socket = { ...emitter(true), volatile: emitter(false) };
  let fx = 0;
  const sync = exports.createLocalInputSync({ socket, getAmmoSyncState: () => ({ charges: 3 }),
    getNetworkInputState: () => ({ movementFxSeq: fx, movementFxType: 'jump', grounded: true }) });
  const player = { x: 100, y: 100, body: { velocity: { x: 0, y: 0 }, touching: { down: true } } };
  const state = { handlePlayerMovement() {} };
  sync.sync({}, player, state);
  assert.equal(sent[0].reliable, true);
  assert.equal(sent[0].data.loaded, true);
  now += 20; sync.sync({}, player, state);
  assert.equal(sent[1].reliable, false);
  assert.equal(sent[1].data.loaded, undefined);
  assert.equal(sent[1].data.bodyHalfWidth, undefined);
  assert.equal(sent[1].data.movementFxType, undefined);
  now += 20; fx++; sync.sync({}, player, state);
  assert.equal(sent[2].reliable, true);
  assert.equal(sent[2].data.movementFxType, 'jump');
  now += 20; sync.sync({}, player, state);
  assert.equal(sent[3].data.movementFxType, undefined);
  now += 300; sync.sync({}, player, state);
  assert.equal(sent[4].reliable, true);
  assert.equal(sent[4].data.movementFxType, 'jump');
});

async function loadLocalInputSync(clock) {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const filename = require.resolve('../src/client/game/scene/localInputSync.js');
  const realRequire = createRequire(filename);
  const exports = {};
  loadClientModule(filename, { exports, Date: { now: () => clock.now }, require(name) {
    if (name.includes('localMovementCorrector')) return { localMovementCorrector: { getAck: () => 0, recordSent() {} } };
    if (name.includes('netTestLogger')) return { noteClientInputSent() {}, noteClientIntentSent() {} };
    return realRequire(name);
  } });
  return exports;
}

test('inputs go out once per rendered frame up to about 60 Hz, evenly spaced', async () => {
  const clock = { now: 50000 };
  const { createLocalInputSync, INPUT_SEND_INTERVAL_MS } = await loadLocalInputSync(clock);
  const run = (refreshHz, frames, { frameCadence = true, readJitterMs = () => 0 } = {}) => {
    const sentAt = [];
    const socket = { compress() { return this; }, emit() { sentAt.push(loop.now); },
      volatile: { compress() { return this; }, emit() { sentAt.push(loop.now); } } };
    const loop = { now: 1000, delta: 1000 / refreshHz };
    const sync = createLocalInputSync({ socket, getAmmoSyncState: () => ({ charges: 3 }),
      getNetworkInputState: () => ({ grounded: true }), throttleMs: 16, frameCadence });
    const player = { x: 1, y: 1, body: { velocity: { x: 0, y: 0 }, touching: { down: true } } };
    for (let i = 0; i < frames; i++) {
      loop.now = 1000 + i * 1000 / refreshHz;
      // Date.now() is read partway through the frame's work.
      clock.now = Math.floor(50000 + loop.now + readJitterMs(i));
      sync.sync({ game: { loop } }, player, { handlePlayerMovement() {} });
    }
    return sentAt.slice(1).map((t, i) => t - sentAt[i]);
  };
  const busyFrames = (i) => (i % 2 ? 2.5 : 0);
  // 60 Hz: every frame, even when the frame's work makes Date.now() read 14-15 ms.
  const sixty = run(60, 120, { readJitterMs: busyFrames });
  assert.ok(sixty.every((gap) => Math.abs(gap - 1000 / 60) < 0.01), 'a 60 Hz display sends every frame');
  const legacy = run(60, 120, { frameCadence: false, readJitterMs: busyFrames });
  assert.ok(Math.max(...legacy) > 30, 'the legacy throttle skipped frames and left double gaps');
  // High-refresh displays stay near the cap with even spacing.
  for (const hz of [90, 120, 144, 165, 240]) {
    const gaps = run(hz, hz * 2);
    const rate = 1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length);
    assert.ok(rate <= 1000 / INPUT_SEND_INTERVAL_MS * 1.25, `${hz} Hz sends at most ~60 Hz (${rate.toFixed(1)})`);
    assert.ok(rate >= 1000 / INPUT_SEND_INTERVAL_MS * 0.7, `${hz} Hz still sends often (${rate.toFixed(1)})`);
    assert.ok(Math.max(...gaps) - Math.min(...gaps) < 0.01, `${hz} Hz spacing is even`);
  }
});

test('a forced pre-attack flush publishes the simulated state without simulating again', async () => {
  const clock = { now: 70000 };
  const { createLocalInputSync } = await loadLocalInputSync(clock);
  const sent = [];
  const socket = { compress() { return this; }, emit(event, data) { sent.push(wire.decodeWire(data)); },
    volatile: { compress() { return this; }, emit(event, data) { sent.push(wire.decodeWire(data)); } } };
  const sync = createLocalInputSync({ socket, getAmmoSyncState: () => ({ charges: 3 }),
    getNetworkInputState: () => ({ grounded: true }) });
  const player = { x: 10, y: 20, body: { velocity: { x: 0, y: 0 }, touching: { down: true } } };
  const loop = { now: 500, delta: 16.67 };
  const scene = { game: { loop } };
  let simulated = 0;
  const handlePlayerMovement = () => {
    simulated += 1;
    // A keyboard attack fires from inside the frame's movement update.
    if (simulated === 2) sync.flushNow(scene, player, { dead: false, gameEnded: false, handlePlayerMovement });
  };
  sync.sync(scene, player, { handlePlayerMovement });
  loop.now += 16.67; clock.now += 17;
  sync.sync(scene, player, { handlePlayerMovement });
  assert.equal(simulated, 2, 'the flush did not run the movement update a second time');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].keyframe, true, 'the flush is reliable');
  sync.flushNow(scene, player, { dead: true });
  assert.equal(sent.length, 2, 'a dead player publishes nothing');
});

test("the player snapshot rate is a room setting with a keyframe about once a second", async () => {
  const { default: constants } = await import("../src/shared/gameConstants.js");
  const { snapshotEveryTicksFor, SNAPSHOT_EVERY_TICKS, SERVER_TICK_HZ, FIXED_DT_MS } = constants;
  assert.equal(snapshotEveryTicksFor(undefined), SNAPSHOT_EVERY_TICKS);
  assert.equal(snapshotEveryTicksFor("nonsense"), SNAPSHOT_EVERY_TICKS);
  assert.equal(snapshotEveryTicksFor(SERVER_TICK_HZ), 1);
  assert.equal(snapshotEveryTicksFor(SERVER_TICK_HZ / 2), 2);
  assert.equal(snapshotEveryTicksFor(SERVER_TICK_HZ * 4), 1, "never more than one per tick");
  const keyframesPerSecond = (everyTicks) => {
    const sent = [];
    const room = { ...roomTransport, matchId: 1, players: new Map(), tickId: 0, simulationMono: 0,
      FIXED_DT_MS, SNAPSHOT_EVERY_TICKS: everyTicks,
      io: { to: () => ({ compress() { return this; }, emit(_, p) { sent.push(wire.decodeWire(p)); } }) } };
    const perSecond = SERVER_TICK_HZ / everyTicks;
    for (let i = 0; i < perSecond * 4; i++) {
      room.tickId += everyTicks; room.simulationMono += FIXED_DT_MS * everyTicks;
      roomState.broadcastSnapshot(room, { tMono: room.simulationMono });
    }
    return sent.filter((p) => p.keyframe).length / 4;
  };
  const slow = keyframesPerSecond(2), fast = keyframesPerSecond(1);
  assert.ok(Math.abs(slow - fast) <= 0.25, `keyframes per second ${slow} vs ${fast}`);
});

test('remote interpolation reaches both endpoints and extrapolates from reported velocity', () => {
  const source = 'src/client/game/scene/remoteInterpolation.js';
  const { hermiteAxis, projectAxis } = loadClientModule(source, { require: () => ({}) });
  assert.equal(hermiteAxis(10, 60, 50, 50, 0, 1000), 10);
  assert.equal(hermiteAxis(10, 60, 50, 50, 1, 1000), 60);
  assert.equal(hermiteAxis(10, 60, 50, 50, 0.5, 1000), 35);
  assert.equal(projectAxis(10, 60, 1000, 50, { extrapolationMs: 200 }), 70);
});
