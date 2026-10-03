import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatchmakingClient,
  MATCHMAKING_SUCCESS_HOLD_MS,
  QUEUE_HEALTH_INTERVAL_MS,
} from "../src/lobby/matchmakingClient.mjs";

const duel = { modeId: "duels", modeVariantId: "duels-1v1", mapId: 1 };

function fixture({ suppressed = false, players = [{ name: "Ann", char_class: "ninja" }] } = {}) {
  const handlers = {};
  const requests = []; // socket.timeout(...).emit(event, cb)
  const emits = [];
  const notices = [];
  const navigations = [];
  const timeouts = [];
  const intervals = [];
  let clock = 1000;
  let readyResets = 0;
  const view = {
    exists: () => true,
    hidden: true,
    shown: 0,
    hides: [],
    cancelDisabled: false,
    renders: [],
    nextFull: false,
    isHidden() { return this.hidden; },
    show() { this.hidden = false; this.shown++; },
    hide(options) { this.hidden = true; this.hides.push(options); },
    render(snapshot) {
      this.renders.push(snapshot);
      const becameFull = snapshot.full && !this.wasFull;
      this.wasFull = snapshot.full;
      return { becameFull };
    },
    isCancelDisabled() { return this.cancelDisabled; },
    setCancelDisabled(value) { this.cancelDisabled = value; },
    bindControls(controls) { this.controls = controls; },
    setAdminControlsVisible(value) { this.admin = value; },
  };
  const socket = {
    on: (event, handler) => { handlers[event] = handler; },
    emit: (...args) => emits.push(args),
    timeout: () => ({ emit: (...args) => requests.push(args) }),
  };
  const client = createMatchmakingClient({
    socket,
    view,
    selection: {
      normalize: (selection) => ({ ...duel, ...selection }),
      totalPlayers: () => 2,
      current: () => duel,
    },
    party: { activeId: () => null, players: () => players, currentTeam: () => null },
    memberKey: (name) => String(name || "").toLowerCase(),
    selfKey: () => "ann",
    onReadyReset: () => { readyResets++; },
    notify: (...args) => notices.push(args),
    navigate: (url) => navigations.push(url),
    suppressed,
    timers: {
      setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
      clearTimeout: () => {},
      setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
      clearInterval: () => {},
    },
    now: () => clock,
    log: { log() {}, warn() {}, error() {} },
  });
  client.bindSocketEvents();
  return {
    client, view, handlers, requests, emits, notices, navigations, timeouts, intervals,
    get readyResets() { return readyResets; },
    advance(ms) { clock += ms; },
  };
}

test("cancel stays visible until acknowledged and cannot hide an intervening found match", () => {
  const f = fixture();
  f.client.show();
  f.view.controls.onCancel();
  assert.equal(f.view.cancelDisabled, true);
  assert.equal(f.view.hides.length, 0);
  f.client.lockCancel(77);
  f.requests[0][1](null, { ok: true, cancelled: true });
  assert.equal(f.view.hides.length, 0);
  f.view.controls.onCancel();
  assert.equal(f.requests.length, 1);
});

test("cancel rejection locks the button while a failed request permits retry", () => {
  const f = fixture();
  f.client.show();
  f.view.controls.onCancel();
  f.requests[0][1](Error("timeout"));
  assert.equal(f.view.cancelDisabled, false);
  f.view.controls.onCancel();
  f.requests.at(-1)[1](null, { ok: true, cancelled: false, matchId: 77 });
  assert.equal(f.view.cancelDisabled, true);
  assert.equal(f.view.hides.length, 0);
});

test("health check recovers a missing ticket and ignores a response overtaken by match found", () => {
  const f = fixture();
  f.client.checkHealth();
  f.requests[0][1](null, { state: "missing" });
  assert.equal(f.emits[0][0], "queue:leave");
  f.client.checkHealth();
  f.client.lockCancel(77);
  f.requests[1][1](null, { state: "missing" });
  assert.equal(f.emits.length, 1);
  assert.equal(f.client.matchedId, 77);
});

test("health checks run while the overlay is open and a live match redirects", () => {
  const f = fixture();
  f.client.startSolo(duel);
  assert.deepEqual(f.emits[0][0], "queue:join");
  assert.equal(f.intervals.length, 1);
  assert.equal(f.intervals[0].ms, QUEUE_HEALTH_INTERVAL_MS);
  f.intervals[0].fn();
  f.requests[0][1](null, { state: "live", matchId: 9 });
  assert.deepEqual(f.navigations, ["/game/9"]);
});

test("a found match is acknowledged only after the success hold", () => {
  const f = fixture();
  f.handlers["queue:joined"]({ selection: duel });
  f.handlers["match:found"]({ matchId: 5, selection: duel, players: [{ name: "Ann" }, { name: "Bo" }] });
  assert.equal(f.view.renders.at(-1).full, true);
  const ack = f.timeouts.at(-1);
  assert.equal(ack.ms, MATCHMAKING_SUCCESS_HOLD_MS);
  assert.equal(f.emits.some(([event]) => event === "ready:ack"), false);
  ack.fn();
  assert.deepEqual(f.emits.at(-1), ["ready:ack", { matchId: 5 }]);
});

test("a cancelled match resets the queue and the local ready state", () => {
  const f = fixture();
  f.handlers["queue:joined"]({ selection: duel });
  assert.equal(f.client.isQueued(), true);
  f.handlers["match:cancelled"]({ reason: "Ready check timed out" });
  assert.equal(f.client.isQueued(), false);
  assert.equal(f.view.hidden, true);
  assert.equal(f.readyResets, 1);
  assert.equal(f.notices[0][0], "Matchmaking stopped");
});

test("a queue error clears the queue so the next ready starts fresh", () => {
  const f = fixture();
  f.client.startSolo(duel);
  f.handlers["queue:error"]({ message: "Nope" });
  assert.equal(f.client.isQueued(), false);
  assert.equal(f.readyResets, 1);
  f.handlers["queue:error"]({ code: "MATCH_FOUND", message: "ignored" });
  assert.equal(f.readyResets, 1);
});

test("returning from battle suppresses stale queue events until the user readies again", () => {
  const f = fixture({ suppressed: true });
  f.client.restoreAfterBattleReturn();
  assert.deepEqual(f.view.hides.at(-1), { immediate: true });
  assert.ok(f.emits.some(([event]) => event === "lobby:heartbeat"));
  f.handlers["match:progress"]({ selection: duel, found: 1, total: 2 });
  f.handlers["match:found"]({ matchId: 3, selection: duel });
  assert.equal(f.view.shown, 0);
  f.client.resumeQueueing();
  f.handlers["match:progress"]({ selection: duel, found: 1, total: 2 });
  assert.equal(f.view.shown, 1);
});

test("progress for another selection is ignored and local humans hydrate server previews", () => {
  const f = fixture({ players: [{ name: "Ann", char_class: "wizard", selected_skin_id: "x" }] });
  f.handlers["queue:joined"]({ selection: duel });
  const rendered = f.view.renders.length;
  f.handlers["match:progress"]({ selection: { ...duel, mapId: 2 }, found: 1, total: 2 });
  assert.equal(f.view.renders.length, rendered);
  f.handlers["match:progress"]({ selection: duel, found: 2, total: 2, players: [{ name: "ANN" }, { name: "Bo" }] });
  const last = f.view.renders.at(-1);
  assert.equal(last.found, 2);
  assert.equal(last.players[0].selected_skin_id, "x");
  assert.equal(last.players[1].name, "Bo");
  assert.equal(last.full, false, "a full lobby is not found until the server locks the match");
});
