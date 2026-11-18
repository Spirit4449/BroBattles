import roomTransport from './helpers/roomTransport.js';
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import recorderModule from "../src/server/core/gameRoom/netTraceRecorder.js";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadClientModule as loadModule } from "./helpers/clientModule.js";
import { analyzeArrivals, detectBounces, analyzeRun, analyzeAttacks, analyzeVictim, buildTruth,
  VICTIM_DISPLACEMENT_PX, analyzeVictimScreen, summarizeVictimScreen } from "../scripts/dev/netReportAnalysis.mjs";
import { NET_PRESETS, parseNetProfiles, createDelaySource, createOrderedLink, SPIKE_WINDOW_MS, parseFlagSets } from "../scripts/dev/net-probe.mjs";

const { createNetTraceRecorder } = recorderModule;
const require = createRequire(import.meta.url);
const { handleHit } = require("../src/shared/combat/runtime/damageResolver.js");

// Client modules are ES modules for the bundler; load them like the renderer harnesses do.
function loadClientModule(file, context = {}) {
  const { require: requireStub = () => null, ...globals } = context;
  return loadModule(fileURLToPath(new URL(file, import.meta.url)), { URLSearchParams, ...globals }, { require: requireStub });
}

function fakeWindow(search) {
  const store = new Map();
  return { location: { search }, sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
}
const TOKEN = "t".repeat(24);

function tempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-nettrace-"));
  return { env: { BB_NET_TRACE_TOKEN: TOKEN, BB_NET_TRACE_DIR: dir }, dir };
}

function fakeSocket(id, netTrace) {
  const socket = new EventEmitter();
  Object.assign(socket, { id, data: { netTrace, user: { name: `user-${id}` } }, handshake: { headers: {} }, conn: { transport: { name: "websocket" }, writeBuffer: [] } });
  return socket;
}

test("tracing stays off without a configured token and ignores wrong tokens", () => {
  const off = createNetTraceRecorder({ env: {} });
  assert.equal(off.enabled, false);
  assert.equal(off.authorize({ netTrace: { runId: "r1", token: "" } }), null);

  const short = createNetTraceRecorder({ env: { BB_NET_TRACE_TOKEN: "short" } });
  assert.equal(short.authorize({ netTrace: { runId: "r1", token: "short" } }), null);

  const { env } = tempEnv();
  const on = createNetTraceRecorder({ env });
  assert.equal(on.authorize({ netTrace: { runId: "r1", token: "x".repeat(24) } }), null);
  assert.equal(on.authorize({ netTrace: { runId: "../etc", token: TOKEN } }), null);
  assert.deepEqual(on.authorize({ netTrace: { runId: "run-1", tag: "c0", token: TOKEN } }), { runId: "run-1", tag: "c0" });
});

test("traced users bypass mode locks only while tracing is enabled", () => {
  const off = createNetTraceRecorder({ env: {} });
  off.markTracedUser("guest");
  assert.equal(off.isTracedUser("guest"), false);
  const on = createNetTraceRecorder({ env: tempEnv().env });
  on.markTracedUser("guest");
  assert.equal(on.isTracedUser("guest"), true);
  assert.equal(on.isTracedUser("other"), false);
});

test("client batches are accepted only from traced sockets, rate limited and size capped", () => {
  let wall = 1_000_000;
  const { env, dir } = tempEnv();
  const rec = createNetTraceRecorder({ env, wall: () => wall });
  const traced = fakeSocket("s1", { runId: "run-a", tag: "c0" });
  const room = { ...roomTransport, matchId: 7, matchData: {}, players: new Map(), botControllers: new Map(), io: { sockets: { sockets: new Map() } } };
  rec.attachRoom(room, traced);

  assert.equal(rec.acceptClientBatch(fakeSocket("s2", null), { seq: 0 }), false);
  assert.equal(rec.acceptClientBatch(traced, { seq: 0, frames: [] }), true);
  assert.equal(rec.acceptClientBatch(traced, { seq: 1 }), false, "second batch inside the rate window");
  wall += 1000;
  assert.equal(rec.acceptClientBatch(traced, { seq: 2, junk: "x".repeat(300 * 1024) }), false, "oversized batch");
  wall += 1000;
  assert.equal(rec.acceptClientBatch(traced, { seq: 3 }), true);

  rec.flushAll();
  rec.closeAll();
  return new Promise((resolve) => setTimeout(() => {
    const lines = fs.readFileSync(path.join(dir, "run-a", "c0.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(lines.map(l => l.data.seq), [0, 3]);
    const server = fs.readFileSync(path.join(dir, "run-a", "server.jsonl"), "utf8");
    assert.match(server, /"kind":"room"/);
    assert.match(server, /client-batch-rejected/);
    resolve();
  }, 50));
});

const moving = (from, to, steps, t0 = 0, dtMs = 16) =>
  Array.from({ length: steps }, (_, i) => ({ t: t0 + i * dtMs, x: from + ((to - from) * i) / (steps - 1), y: 0 }));

test("bounce detector flags step-back-then-resume but not steady travel or genuine turns", () => {
  assert.equal(detectBounces(moving(0, 200, 40)).length, 0);

  const bounce = [...moving(0, 100, 20), ...moving(88, 88, 2, 330), ...moving(90, 200, 20, 370)];
  const events = detectBounces(bounce);
  assert.equal(events.length, 1);
  assert.ok(events[0].magnitudePx >= 10);

  const turn = [...moving(0, 100, 20), ...moving(98, 0, 30, 330)];
  assert.equal(detectBounces(turn).length, 0);
});

test("arrival gaps are attributed to the server when emission was late and to transport otherwise", () => {
  // [arrival, seq, tMono, sentMono, keyframe, event, serverNow]
  const snaps = [];
  let arrival = 0, source = 0;
  const push = (arrivalStep, sourceStep) => {
    arrival += arrivalStep; source += sourceStep;
    snaps.push([arrival, snaps.length, source, source, 0, 0, arrival]);
  };
  for (let i = 0; i < 10; i++) push(33, 33);
  push(250, 250); // server emitted late
  for (let i = 0; i < 5; i++) push(33, 33);
  push(220, 33); // delayed in transit
  const result = analyzeArrivals(snaps);
  assert.equal(result.gaps.length, 2);
  assert.deepEqual(result.gaps.map(g => g.cause), ["server", "transport"]);
});

test("run analysis attributes loop stalls to navigation builds and heavy bot ticks", () => {
  const server = [
    { kind: "run", t: 0, cpus: 4 },
    { kind: "nav", t: 5000, buildMs: 3000, queueMs: 500, character: "gloop" },
    { kind: "stall", what: "loop", t: 3000, deltaMs: 400, steps: 24 },
    { kind: "stall", what: "loop", t: 9000, deltaMs: 120, steps: 7 },
    ...Array.from({ length: 10 }, (_, i) => ({ kind: "tick", status: "active", t: (i + 1) * 1000, windowMs: 1000,
      loop: { p95: 18, max: i === 2 ? 400 : i === 8 ? 120 : 20 }, snap: { gapMax: 34, avgBytes: 400 },
      bots: { max: i === 8 ? 30 : 2, totalMs: 50, p95: 2 } })),
    ...Array.from({ length: 10 }, (_, i) => ({ kind: "host", t: (i + 1) * 1000, load1: 2 })),
  ];
  const report = analyzeRun({ server, clients: {} });
  assert.equal(report.server.loopStalls, 2);
  assert.equal(report.server.attribution.withNav, 1);
  assert.equal(report.server.attribution.withBots, 1);
  assert.ok(report.timeline.length >= 2);
});

test("a predicted hit is timed only to the hit from the shot it was drawn for", () => {
  // Shot at 1000 predicted at 1100 and confirmed at 1136; the next shot at
  // 1518 lands at 2015 without a prediction of its own.
  const client = { user: "me", offset: 0, keys: [[1000, "KeyJ", 1], [1518, "KeyJ", 1]], diag: [],
    combat: [[1000, "tx", "game:action", "arrow", "a1"], [1100, "pred", "foe"], [1136, "hp", "foe", 90],
      [1518, "tx", "game:action", "arrow", "a2"], [2015, "hp", "foe", 80]] };
  const server = { actions: [], loopStalls: [], hits: [
    { t: 1120, aTag: "c0", v: "foe", ok: true, dmg: 10 }, { t: 2000, aTag: "c0", v: "foe", ok: true, dmg: 10 }] };
  const attacks = analyzeAttacks(client, server, "c0");
  assert.deepEqual(attacks.samples.predToConfirm, [36]);
  assert.deepEqual(attacks.samples.pressToConfirm, [136, 497]);
});

test("net profiles parse presets, raw specs and per-client lists", () => {
  const [fast, mobile] = parseNetProfiles("fast,4g", 3);
  assert.equal(fast, null);
  assert.deepEqual({ ...mobile, name: undefined }, { ...NET_PRESETS["4g"], name: undefined });
  assert.equal(parseNetProfiles("fast,4g", 3)[2], null, "profiles cycle over clients");
  const [raw, second] = parseNetProfiles("rtt=100,jitter=20,spike=0.01:300;wifi", 2);
  assert.deepEqual([raw.rttMs, raw.jitterMs, raw.spikeP, raw.spikeMs], [100, 20, 0.01, 300]);
  assert.equal(second.rttMs, NET_PRESETS.wifi.rttMs);
  assert.throws(() => parseNetProfiles("rtt=abc", 1));
  // Without jitter or spikes each direction carries half the round trip.
  assert.equal(createDelaySource({ rttMs: 80, jitterMs: 0, spikeP: 0, spikeMs: 0 })(), 40);
  const spiky = createDelaySource({ rttMs: 80, jitterMs: 0, spikeP: 0.5, spikeMs: 300 }, () => 0.3);
  assert.equal(spiky(SPIKE_WINDOW_MS), 340, "a spike adds its length");
  assert.equal(spiky(SPIKE_WINDOW_MS / 10), 40, "spike chance is per link time, not per message");
});

test("a simulated link delays every message but never reorders them", () => {
  let clock = 0;
  const timers = [];
  const delivered = [];
  const delays = [100, 10, 10, 50];
  const link = createOrderedLink((m) => delivered.push([m, clock]), () => delays.shift(), {
    now: () => clock, setTimer: (fn, ms) => { timers.push({ fn, at: clock + ms }); return timers.length; }, clearTimer: () => {} });
  for (const m of ["a", "b", "c"]) { link.send(m); clock += 5; }
  link.send("d"); // sent at 15, wants 65, held back by "a" until 100
  while (timers.length) {
    timers.sort((x, y) => x.at - y.at);
    const next = timers.shift();
    clock = Math.max(clock, next.at);
    next.fn();
  }
  assert.deepEqual(delivered.map(d => d[0]), ["a", "b", "c", "d"]);
  assert.ok(delivered.every(([, t]) => t >= 100), "later messages wait for the delayed one");
  assert.equal(link.stats().heldBack, 3);
});

test("victim truth measures how far the tested position was from where the victim drew itself", () => {
  // The victim walks right at 0.5 px/ms; the server tests it 120 ms back.
  const frames = Array.from({ length: 200 }, (_, i) => [i * 16, 16, i * 8, 300, 0]);
  const victim = { user: "me", character: "ninja", offset: 0, frames, diag: [], decoded: [] };
  // Snapshot truth of the victim from another client: the server's history lags the drawn position by 40 ms.
  const watcher = { names: ["me"], decoded: Array.from({ length: 150 }, (_, i) => [0, i, i * 16 + 40, 0, i * 8, 300]) };
  const truth = buildTruth([watcher]);
  const hits = [{ t: 2000, sim: 2000, vTag: "c1", a: "foe", aChar: "sparrow", type: "sparrow-arrow", ok: true, dmg: 10, rewindMs: 120 },
    { t: 2600, sim: 2600, vTag: "c1", a: "foe", aChar: "thorg", type: "basic", ok: true, dmg: 10, rewindMs: 0 }];
  const v = analyzeVictim(victim, { hits, actions: [] }, "c1", { truth });
  assert.equal(v.measured, 2);
  assert.equal(v.uploadLagCalibrated, true);
  const worst = v.worst[0];
  assert.equal(worst.delivery, "released");
  // 120 ms rewind + 40 ms of history lag at 0.5 px/ms.
  assert.ok(Math.abs(worst.displacementPx - 80) <= 2, `displacement ${worst.displacementPx}`);
  assert.ok(Math.abs(worst.ageMs - 160) <= 6, `age ${worst.ageMs}`);
  assert.equal(v.byDelivery.released.overLimit, worst.displacementPx > VICTIM_DISPLACEMENT_PX ? 1 : 0);
  assert.equal(v.byDelivery.attached.n, 1);
  // Without snapshot truth the victim's own timeline gives a similar answer.
  const self = analyzeVictim(victim, { hits, actions: [] }, "c1", {});
  assert.equal(self.sources.self, 2);
  assert.ok(self.worst[0].displacementPx > 40);
});

test("an unconfirmed prediction reports its request's rewind and where the server would have tested the target", () => {
  const frames = Array.from({ length: 100 }, (_, i) => [i * 16, 16, 0, 300, 0, 0, 400 + i * 4, 300]);
  const client = { user: "me", character: "thorg", offset: 0, names: ["foe"], frames,
    keys: [[1000, "KeyJ", 1]], diag: [{ clock: { bestRttMs: 100 } }],
    combat: [[1000, "tx", "game:action", "thorg-fall", "s1"], [1100, "pred", "foe"]] };
  const actions = [{ t: 1050, sim: 1050, tag: "c0", id: "s1", ev: "game:action", viewMono: 800, rewindMs: 250 }];
  const truth = new Map([["foe", Array.from({ length: 100 }, (_, i) => ({ t: i * 16, x: 400 + i * 4, y: 300 }))]]);
  const a = analyzeAttacks(client, { actions, hits: [], loopStalls: [] }, "c0", { truth });
  assert.equal(a.unconfirmed, 1);
  const [u] = a.unconfirmedList;
  assert.equal(u.delivery, "attached");
  assert.equal(u.rewindRequestedMs, 250);
  assert.ok(u.rewindAppliedMs < u.rewindRequestedMs && u.rewindCapped, "attached rewinds are capped below the request");
  assert.ok(u.drawnToTestedPx > 0, "the tested target is ahead of the drawn one");
  // A prediction that carries its request id is tied to that request even
  // when a later one was sent before it, and its drawn contact point is used.
  const byId = analyzeAttacks({ ...client, combat: [[1000, "tx", "game:action", "thorg-fall", "s1"], [1080, "tx", "game:action", "thorg-fall", "s2"],
    [1100, "pred", "foe", "s1", 420, 300, "attached"]] }, { actions, hits: [], loopStalls: [] }, "c0", { truth });
  const [v] = byId.unconfirmedList;
  assert.equal(v.matchedById, true);
  assert.equal(v.rewindRequestedMs, 250);
  assert.equal(v.delivery, "attached");
});

test("net A/B flags on the first page survive navigation until netflags=off", () => {
  const { readNetFlags, netFlagSearch } = loadClientModule("../src/client/lib/netFlags.js");
  const win = fakeWindow("?nettrace=r1&ntk=x&netProjectileLead=0&netRenderDelay=legacy&other=1");
  assert.deepEqual({ ...readNetFlags(win) }, { netProjectileLead: "0", netRenderDelay: "legacy" });
  win.location.search = "";
  assert.equal(netFlagSearch(win), "netProjectileLead=0&netRenderDelay=legacy");
  win.location.search = "?netInputCadence=legacy";
  assert.equal(readNetFlags(win).netInputCadence, "legacy");
  assert.equal(readNetFlags(win).netProjectileLead, "0", "a later page adds to the stored flags");
  win.location.search = "?netflags=off";
  assert.deepEqual({ ...readNetFlags(win) }, {});
  win.location.search = "";
  assert.deepEqual({ ...readNetFlags(win) }, {});
  assert.deepEqual(parseFlagSets("default;netProjectileLead=0", 2), ["", "netProjectileLead=0"]);
  assert.throws(() => parseFlagSets("lead=0", 1), /net<Name>/);
});

test("server hit records say how the hit was delivered and where it was tested", () => {
  const { env, dir } = tempEnv();
  const rec = createNetTraceRecorder({ env });
  const now = 50_000;
  const fighter = (name, team, x, extra = {}) => ({ name, team, x, y: 300, isAlive: true, connected: true, loaded: true, char_class: "ozzy",
    health: 5000, maxHealth: 5000, baseDamage: 400, socketId: name, ...extra });
  const shooter = fighter("shooter", "team1", 100);
  const victim = fighter("victim", "team2", 400, { _posHistory: [{ t: now - 500, x: 300, y: 300, ts: 5000 }, { t: now + 1000, x: 450, y: 300, ts: 6500 }] });
  const healthMeta = [];
  const roomOf = () => ({ ...roomTransport, combatClock: { now: () => now }, players: new Map([["shooter", shooter], ["victim", victim]]), matchId: 9, matchData: {}, botControllers: new Map(),
    io: { to: () => ({ emit() {} }), sockets: { sockets: new Map() } }, simulationMono: 1000, recordCombatStat() {}, broadcastSnapshot() {},
    getAttackMaxDist: () => 2000, getHistoricalPosition: (p) => ({ x: p.x, y: p.y }), checkVictoryCondition() {}, applyKnockback() {},
    handlePlayerDeath() {}, broadcastHealthUpdate: (p, meta) => healthMeta.push(meta) });
  const room = roomOf();
  rec.attachRoom(room, fakeSocket("victim", { runId: "run-h", tag: "c1" }));
  room.traceCombatHit = (a, n, d) => rec.noteHit(room, a, n, d);
  const fireball = { runtimeKind: "projectile-linear", instanceId: "shot-1", attackerParticipantId: "shooter", attackerName: "shooter",
    viewRewindMs: 250, viewRewindRequestedMs: 280, elapsed: 320, contactTarget: "victim", hitSet: new Set() };
  const hitOf = (r, attack) => handleHit(r, "shooter", { attacker: "shooter", target: "victim", attackType: "basic", instanceId: attack.instanceId },
    { server: true, runtimeProjectile: attack });
  assert.equal(hitOf(room, fireball).accepted, true);
  assert.deepEqual({ by: healthMeta[0].by, pid: healthMeta[0].pid, delivery: healthMeta[0].delivery }, { by: "shooter", pid: "shot-1", delivery: "released" });
  // An untraced room's health updates carry nothing extra.
  hitOf(roomOf(), { ...fireball, instanceId: "shot-2" });
  assert.equal(healthMeta[1].by, undefined);
  assert.equal(healthMeta[1].pid, undefined);
  rec.flushAll();
  rec.closeAll();
  return new Promise((resolve) => setTimeout(() => {
    const hit = fs.readFileSync(path.join(dir, "run-h", "server.jsonl"), "utf8").trim().split("\n").map(JSON.parse).find(r => r.kind === "hit");
    assert.equal(hit.delivery, "released");
    assert.equal(hit.akind, "projectile-linear");
    assert.equal(hit.pid, "shot-1");
    assert.equal(hit.ageMs, 320);
    assert.equal(hit.rewindReqMs, 280);
    assert.equal(hit.rewindMs, 250);
    assert.deepEqual(hit.vAt, [400, 300]);
    assert.deepEqual(hit.aAt, [100, 300]);
    assert.equal(hit.tested[0], 325, "tested where the victim stood 250 ms earlier");
    // The victim's own timestamp of the tested position (history ts).
    assert.equal(hit.vTs, 5250);
    resolve();
  }, 50));
});

test("victim screen truth tells shots that touched the drawn body before the server hit from those that did not", () => {
  const { createVictimScreenTracker, circleBoxGap } = loadClientModule("../src/client/game/match/victimScreenTrace.js");
  const rows = [];
  const tracker = createVictimScreenTracker({ row: (r) => rows.push(r), lead: () => ({ rtt2: 20, playout: 30, target: 150 }) });
  const body = { left: 0, right: 30, top: 0, bottom: 50 };
  assert.equal(circleBoxGap(45, 25, 5, body), 10);
  // Shot a: reaches the body, held, and the server hits me with it.
  for (let t = 0; t <= 160; t += 16) tracker.note(t, "a", "foe", "sparrow", circleBoxGap(150 - t, 25, 5, body), 100, 100, t >= 112 ? 1 : 0);
  tracker.hit(200, { delivery: "released", by: "foe", pid: "a", registeredAt: 180 });
  // Shot b: stops 12 px short, and the server still hits me.
  for (let t = 0; t <= 96; t += 16) tracker.note(t, "b", "foe", "sparrow", 12 + (96 - t), 100, 100, 0);
  tracker.hit(150, { delivery: "released", by: "foe", pid: "b", registeredAt: 130 });
  // Shot c: held on the body, never hit (a phantom touch).
  for (let t = 0; t <= 300; t += 16) tracker.note(t, "c", "bot", "ninja", t < 100 ? 40 : 0, 80, 0, t >= 100 && t < 280 ? 1 : 0);
  tracker.sweep(1000);
  assert.equal(tracker.active(), 0);
  const vh = rows.filter(r => r[1] === "vh");
  assert.equal(vh.length, 2);
  assert.ok(vh[0][7] <= 0 && vh[0][8] > 0, "shot a touched before the server registered it");
  assert.equal(vh[1][7], 12);
  const ends = rows.filter(r => r[1] === "ee");
  assert.equal(ends.length, 3);
  assert.ok(rows.some(r => r[1] === "eh" && r[2] === "c" && r[3] === 0), "the hold on shot c ended");

  // The report reads the same rows back.
  const screen = analyzeVictimScreen({ combat: rows }, { hits: [] }, "c0");
  assert.equal(screen.all.traced, 2);
  assert.equal(screen.all.agreed, 1);
  assert.equal(screen.all.missGap.p95, 12);
  assert.equal(screen.all.touched, 2);
  assert.equal(screen.all.phantom, 1);
  assert.ok(screen.all.phantomHoldMs.p50 >= 160);
  assert.equal(screen.sparrow.releasedHits, 2);
  assert.equal(screen.ninja.phantom, 1);
  assert.equal(screen.all.lead.p50, 100);
  assert.equal(screen.all.targetLead.p50, 150);
  // Samples pool across runs.
  const pooled = summarizeVictimScreen({ hits: [...screen.samples.hits, ...screen.samples.hits], shots: [...screen.samples.shots, ...screen.samples.shots] });
  assert.equal(pooled.all.agreed, 2);
  assert.equal(pooled.all.phantom, 2);
});

test("lead error compares the flight age the victim drew at the tested frame with the server's", () => {
  const { createVictimScreenTracker, circleBoxGap } = loadClientModule("../src/client/game/match/victimScreenTrace.js");
  const rows = [];
  const tracker = createVictimScreenTracker({ row: (r) => rows.push(r), lead: () => ({ rtt2: 20, playout: 30, target: 150 }) });
  const body = { left: 0, right: 30, top: 0, bottom: 50 };
  // Two shots at 1 px/ms, drawn at flight age t + 100; the victim's frames
  // are timestamped Date.now() = performance.now() + 10000.
  for (let t = 0; t <= 200; t += 16) {
    tracker.note(t, "hit", "foe", "sparrow", circleBoxGap(150 - t, 25, 5, body), 100, 100, 0, t + 100);
    tracker.note(t, "miss", "foe", "sparrow", circleBoxGap(150 - t, 60, 5, body), 100, 100, 0, t + 100);
  }
  tracker.sweep(1000);
  assert.ok(rows.some(r => r[1] === "et" && r[2] === "hit" && r[4] > 100), "first touch carries the drawn flight age");
  assert.equal(rows.filter(r => r[1] === "ea").length, 2);
  const c = { combat: rows, dateOffset: 10000 };
  // The server tested the frame drawn at t = 160 (age 260, after the lead
  // ramp) with the shot 20 ms older: the lead was 20 ms short. The miss
  // passed 3 px from the tested body.
  const serverIndex = {
    hits: [{ vTag: "c0", ok: true, dmg: 10, delivery: "released", pid: "hit", aChar: "sparrow", ageMs: 280, vTs: 10160 }],
    near: [{ vTag: "c0", pid: "miss", aChar: "sparrow", gap: 3, ageMs: 200, vTs: 10100 }, { vTag: "c0", pid: "hit", gap: -4, ageMs: 230, vTs: 10110 }] };
  const screen = analyzeVictimScreen(c, serverIndex, "c0");
  assert.ok(Math.abs(screen.sparrow.leadErrHit.p50 - 20) < 1, `hit lead error ${screen.sparrow.leadErrHit.p50}`);
  assert.equal(screen.sparrow.hitLeadN, 1);
  const miss = screen.samples.leads.find(x => x.kind === "miss");
  assert.ok(Math.abs(miss.err) < 1 && miss.serverGap === 3 && miss.touched === false);
});

test("released shots near a traced victim leave one closest-approach record per shot", () => {
  const { traceShotGaps } = require("../src/shared/combat/runtime/shotTrace.js");
  const { env, dir } = tempEnv();
  let clock = 0;
  const rec = createNetTraceRecorder({ env, now: () => clock });
  const victim = { name: "victim", team: "team2", socketId: "victim", x: 0, y: 0,
    _posHistory: [{ t: Date.now() - 1000, x: 0, y: 0, ts: 1000 }, { t: Date.now() + 1000, x: 0, y: 0, ts: 3000 }] };
  const room = { players: new Map([["victim", victim]]), matchId: 3, matchData: {}, botControllers: new Map(), simulationMono: 500 };
  rec.attachRoom(room, fakeSocket("victim", { runId: "run-n", tag: "c0" }));
  room.traceShotGap = (d) => rec.noteShotGap(room, d);
  const bounds = { left: -10, right: 10, top: -20, bottom: 20 };
  for (const [x, age] of [[60, 100], [30, 117], [14, 133]]) {
    traceShotGaps(room, { pid: "arrow-1", attacker: { name: "foe", char_class: "sparrow" }, a: { x: x + 16, y: 0 }, b: { x, y: 0 },
      radius: 2, age, rewindMs: 100, targets: [{ name: "victim", bounds }] });
  }
  rec.flushNear(room);
  clock = 1000;
  rec.flushNear(room);
  rec.flushAll();
  rec.closeAll();
  return new Promise((resolve) => setTimeout(() => {
    const near = fs.readFileSync(path.join(dir, "run-n", "server.jsonl"), "utf8").trim().split("\n").map(JSON.parse).filter(r => r.kind === "near");
    assert.equal(near.length, 1);
    assert.equal(near[0].gap, 2);
    assert.equal(near[0].ageMs, 133);
    assert.equal(near[0].vTag, "c0");
    assert.equal(near[0].aChar, "sparrow");
    assert.ok(Number.isFinite(near[0].vTs));
    resolve();
  }, 50));
});
