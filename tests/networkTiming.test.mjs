import test from "node:test";
import assert from "node:assert/strict";
import { createSnapshotBuffer, getRenderClockCorrection } from "../src/match/snapshotBuffer.js";
import { sampleRemoteFrame, readNetworkExperiments, followRemotePosition } from "../src/gameScene/remoteSmoothing.js";
import roomState from "../src/server/core/gameRoom/roomStateManager.js";
import roomModule from "../src/server/core/gameRoom.js";

const packet = (seq, time, extra = {}) => ({
  snapshotEpoch: "room-a", snapshotSeq: seq, tickId: Math.floor(time / (1000 / 60)),
  tMono: time, sentMono: time, snapshotKind: "periodic",
  players: { p: { x: time / 10, y: 0, vx: 100, vy: 0, grounded: true } }, ...extra,
});

test("immediate snapshots share simulation time but have distinct emission sequences", () => {
  const sent = [];
  const room = { matchId: 1, players: new Map(), _tickId: 60, _simulationMono: 1000,
    io: { to: () => ({ compress() { return this; }, emit(_, p) { sent.push(p); } }) } };
  roomState.broadcastSnapshot(room, { tMono: 1000 });
  roomState.broadcastSnapshot(room);
  room._tickId = 62; room._simulationMono += 1000 / 30;
  roomState.broadcastSnapshot(room, { tMono: room._simulationMono });
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

test("arrival jitter distinguishes network bunching from source stalls without changing default delay", () => {
  const steady = arrivalTrace(false), bursty = arrivalTrace(true);
  assert.ok(steady.arrivalJitterEma < 0.001);
  assert.ok(bursty.arrivalJitterEma > 20);
  assert.ok(Math.abs(steady.interpDelayMs - bursty.interpDelayMs) < 0.001);
  assert.ok(arrivalTrace(true, {}, true).arrivalJitterEma < 0.001);
  const adaptive = arrivalTrace(true, { enableArrivalAdaptiveDelay: true });
  assert.ok(adaptive.interpDelayMs > bursty.interpDelayMs);
  assert.ok(adaptive.interpDelayMs <= 115);
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
    const frame = sampleRemoteFrame(b, base, state, { attack: t < 1600, deltaMs: 1000 / 120 });
    const x = frame.aState.players.p.x + frame.alpha * (frame.bState.players.p.x - frame.aState.players.p.x);
    assert.ok(x > previous, `stalled or reversed at ${t}`);
    assert.ok(frame.targetMono - base.targetMono <= 12.001);
    previous = x;
  }
  b.reset(); b.ingestSnapshot(packet(1, 100), 110);
  assert.equal(sampleRemoteFrame(b, b.sampleAt(100), state).targetMono, 100);
  assert.equal(readNetworkExperiments("").continuousSmoothing, true);
  assert.equal(readNetworkExperiments("?netSmoothing=legacy").continuousSmoothing, false);
  assert.equal(readNetworkExperiments("?netSmoothing=continuous&netArrivalDelay=1").enableArrivalAdaptiveDelay, true);
});

function runLoop(t, coalesce, stall, finishAt = null) {
  let clock = 0, callback;
  t.mock.method(performance, "now", () => clock);
  t.mock.method(globalThis, "setTimeout", (fn) => { callback = fn; return 1; });
  const events = [];
  const noop = () => {};
  const room = Object.assign(Object.create(roomModule.GameRoom.prototype), {
    status: "active", _netTestEnabled: true, _tickId: 0,
    FIXED_DT_MS: 1000 / 60, SNAPSHOT_EVERY_TICKS: 2, WORLD_STATE_EVERY_TICKS: 8,
    COALESCE_SNAPSHOTS: coalesce, _powerups: new Map(), _deathDrops: new Map(), players: new Map(),
    _spawnPowerup: noop, _tickPowerupEffects: noop, processRegen: noop,
    _tickTimerAndSuddenDeath: noop, _tickPowerups: noop, _tickDeathDrops: noop,
    processTick() {
      events.push({ type: "simulation", tick: this._tickId });
      if (this._tickId === 4) events.push({ type: "respawn" });
      if (this._tickId === finishAt) this._loopRunning = false;
    },
    _emitSnapshotWithTiming(time) { events.push({ type: "snapshot", tick: this._tickId, time }); },
    broadcastWorldState() { events.push({ type: "world" }); },
  });
  room.startGameLoop(); clock = stall; callback();
  return { room, events };
}

test("catch-up retains all steps and discrete events but publishes final state once", (t) => {
  const { room, events } = runLoop(t, true, 1000);
  assert.equal(room._tickId, 60);
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
