import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import recorderModule from "../src/server/core/gameRoom/netTraceRecorder.js";
import { analyzeArrivals, detectBounces, analyzeRun, analyzeAttacks } from "../scripts/dev/netReportAnalysis.mjs";

const { createNetTraceRecorder } = recorderModule;
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
  const room = { matchId: 7, matchData: {}, players: new Map(), botControllers: new Map(), io: { sockets: { sockets: new Map() } } };
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
