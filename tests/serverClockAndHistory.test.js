const test = require('node:test');
const assert = require('node:assert/strict');
const input = require('../src/server/core/gameRoom/inputManager');
const { getHistoricalPosition } = require('../src/shared/combat/runtime/combatValidation.js');
const { SparrowReplica, CombatClock } = require('../src/shared/characters/sparrowReplication');
const { POSITION_HISTORY_MS } = require('../src/shared/combat/matchConfig.js');
const loadServerClock = require('./helpers/serverClockModule');
const WORLD = require('../src/shared/maps/arenas').arenaFor('duels-1v1').world;

test('humans record one history sample per accepted packet and rewind linearly between them', t => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const player = { socketId: 'p', name: 'P', char_class: 'ninja', x: 0, y: 0, isAlive: true, connected: true };
  const room = { players: new Map([['p', player]]), geometry: { colliders: [], world: WORLD }, io: { to: () => ({ emit() {} }) } };
  input.resetMovementBudget(player, now);
  // A teleport (spawn) starts history afresh at the new position.
  assert.deepEqual(player._posHistory.map(({ x, y, t }) => ({ x, y, t })), [{ x: 0, y: 0, t: now }]);
  assert.ok(player._posHistory[0].body._bodyHalfHeight > 0);
  now += 30; input.handlePlayerInput(room, 'p', { x: 0, y: 0, sequence: 1 });
  now += 30; input.handlePlayerInput(room, 'p', { x: 9, y: 0, sequence: 2 });
  assert.equal(player._posHistory.length, 3);
  assert.equal(getHistoricalPosition(player, now - 15).x, 4.5);
});

test('a teleport discards older history so rewinds never reach a pre-respawn position', () => {
  const player = { x: 500, y: 0, isAlive: true, isBot: true };
  for (let t = 0; t <= 200; t += 50) input.recordBotHistory(player, t);
  Object.assign(player, { x: -800, y: 40 });
  input.resetMovementBudget(player, 250);
  assert.deepEqual(getHistoricalPosition(player, 100), { x: -800, y: 40 });
});

test('position history spans about one second regardless of sample rate', () => {
  const player = { x: 0, y: 0, isAlive: true, isBot: true };
  for (let t = 0; t <= 3000; t += 1000 / 60) {
    player.x = t;
    input.recordBotHistory(player, t);
  }
  const history = player._posHistory;
  const span = history[history.length - 1].t - history[0].t;
  assert.ok(span <= POSITION_HISTORY_MS + 1000 / 60 && span >= POSITION_HISTORY_MS - 1000 / 60, `span ${span}`);
});

test('a replica given the shared clock never resets it', () => {
  const clock = new CombatClock();
  clock.reset('room');
  clock.synchronize({ epoch: 'room', sentMono: 500, simMono: 500 }, 100, 120);
  const replica = new SparrowReplica(clock);
  replica.reset('room');
  replica.reset();
  assert.equal(clock.epoch, 'room');
  assert.equal(clock.samples.length, 1);
  const owned = new SparrowReplica();
  owned.reset('other');
  assert.equal(owned.clock.epoch, 'other');
});

test('the match clock bursts on a new epoch, keeps the lowest-RTT offset and reports server time', () => {
  let now = 0;
  const timeouts = [];
  const clockModule = loadServerClock({ performance: { now: () => now },
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; } });
  const pending = [];
  const socket = { connected: true, timeout: () => ({ emit: (name, data, ack) => pending.push({ ack, sent: now }) }) };
  clockModule.startServerClockSync(socket);
  assert.equal(clockModule.serverNowMono(), null);
  // A delayed first snapshot alone would suggest the wrong offset (1050).
  clockModule.observeServerClockSnapshot({ snapshotEpoch: 'room', sentMono: 1050, tMono: 1040 }, 0);
  assert.equal(timeouts.length, 5);
  for (const t of timeouts) t.fn();
  assert.equal(pending.length, 5);
  // Server clock is exactly 1000 ms ahead. Slow round trips are asymmetric, so
  // their midpoint estimate is wrong; only the fastest sample is trusted.
  [40, 10, 80, 12, 200].forEach((rtt, i) => {
    const { ack, sent } = pending[i];
    now = sent + rtt;
    const serverMono = sent + rtt / 2 + 1000 + (rtt === 10 ? 0 : rtt / 4);
    ack(null, { epoch: 'room', sentMono: serverMono, simMono: serverMono });
  });
  now = 5000;
  assert.equal(clockModule.serverNowMono(), 6000);
  // Same epoch: no new burst. New room instance: reset and burst again.
  clockModule.observeServerClockSnapshot({ snapshotEpoch: 'room', sentMono: 6000, tMono: 6000 }, now);
  assert.equal(timeouts.length, 5);
  clockModule.observeServerClockSnapshot({ snapshotEpoch: 'room-2', sentMono: 10, tMono: 10 }, now);
  assert.equal(timeouts.length, 10);
  assert.equal(clockModule.getServerClockDiagnostics().epoch, 'room-2');
  clockModule.stopServerClockSync();
});

test('server latency acknowledgments follow clock socket lifecycle without duplicate listeners', () => {
  const { EventEmitter } = require('node:events');
  const first = new EventEmitter(), second = new EventEmitter();
  const clock = loadServerClock({ performance: { now: () => 0 } });
  clock.startServerClockSync(first);
  clock.startServerClockSync(first);
  assert.equal(first.listenerCount('game:latency'), 1);
  let replies = 0;
  first.emit('game:latency', {}, () => replies++);
  assert.equal(replies, 1);
  clock.startServerClockSync(second);
  assert.equal(first.listenerCount('game:latency'), 0);
  second.emit('game:latency', {}, () => replies++);
  assert.equal(replies, 2);
  clock.stopServerClockSync();
  assert.equal(second.listenerCount('game:latency'), 0);
});

// Fairness for the victim of a released shot: an enemy projectile overlaps
// this player on their own screen exactly when the server registers the hit.
// A real human input path (playout, history), real server clock packets and
// the real replica draw a victim running at run speed under arrows fired
// straight down across their path, with clock skew, an asymmetric link,
// uplink jitter, step lag and a 120 ms shooter rewind.
function victimFairnessRun({ lead = true, up = 20, down = 40, rewindMs = 120, offsets, pingJitter = 0 }) {
  const { publishedMotion, reportedPlayoutMs, reportedHistoryMs } = require('../src/server/core/gameRoom/humanPlayout');
  const { positionAt } = require('../src/shared/combat/runtime/lagCompensation.js');
  const { characterHitBounds } = require('../src/shared/combat/shotContact');
  const { sample, insetBounds } = require('../src/shared/characters/sparrowProjectile');
  const STEP = 1000 / 60, RUN = 300, FOOT_Y = 900, RADIUS = 6;
  // Server real time tau: monotonic M = tau + 10000, wall W = tau + 2e6.
  // The victim's browser: performance.now = tau + 333, Date.now = tau + 5e5.
  const M = tau => tau + 10000, W = tau => tau + 2e6, local = tau => tau + 333, clientDate = tau => tau + 5e5;
  const selfX = tau => 100 + RUN * tau / 1000;
  const box = x => insetBounds(characterHitBounds('ninja', x, FOOT_Y));
  const distance = (p, b) => Math.hypot(p.x - Math.max(b.left, Math.min(p.x, b.right)), p.y - Math.max(b.top, Math.min(p.y, b.bottom))) - RADIUS;
  let now = W(0);
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const player = { socketId: 'v', name: 'V', char_class: 'ninja', x: selfX(0), y: FOOT_Y, isAlive: true, connected: true };
    const room = { players: new Map([['v', player]]), geometry: { colliders: [], world: { x: 0, y: 0, width: 4000, height: 1000 } }, io: { to: () => ({ emit() {} }) } };
    input.resetMovementBudget(player, now);
    const clock = new CombatClock(); clock.reset('room'); clock.projectileLead = lead;
    clock.wallOffset = () => clientDate(0) - local(0);
    const replica = new SparrowReplica(clock);
    // Events in time order; ones scheduled while running are inserted in place.
    const events = [];
    let order = 0;
    const at = (tau, run) => {
      const event = { tau, run, order: order++ };
      let lo = 0, hi = events.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (events[mid].tau <= tau) lo = mid + 1; else hi = mid; }
      events.splice(lo, 0, event);
    };
    // The victim's own movement packets, 60 Hz, 0-6 ms of uplink jitter.
    for (let i = 1, tau = STEP; tau < 4200; i++, tau += STEP) {
      const sent = tau, x = selfX(sent);
      at(sent + up + (i * 7919 % 7), () => { now = W(sent + up + (i * 7919 % 7));
        input.handlePlayerInput(room, 'v', { x, y: FOOT_Y, vx: RUN, vy: 0, grounded: true, sequence: i, timestamp: clientDate(sent) }); });
    }
    // Clock pings every 400 ms (the server answers with its clocks on arrival).
    // `pingJitter` delays some pings' uplink (but no input packet beyond
    // 6 ms): half the best ping then overstates the uplink history keys by.
    for (let tau = 0; tau < 4200; tau += 400) {
      const late = pingJitter ? pingJitter * (0.3 + 0.7 * ((tau / 400) % 3) / 2) : 0;
      at(tau + up + late, () => {
        const response = { epoch: 'room', sentMono: M(tau + up + late), simMono: M(tau + up + late) - 2 };
        at(tau + up + late + down + late, () => clock.synchronize(response, local(tau), local(tau + up + late + down + late)));
      });
    }
    const shots = new Map();
    const LAUNCH_STEP = 150;
    for (let n = 1; n * STEP < 4200; n++) {
      const sim = M(0) + n * STEP, lag = 1 + n % 4, tau = n * STEP + lag;
      at(tau, () => {
        now = W(tau);
        if (n === LAUNCH_STEP) {
          // Fired straight down, timed to cross the victim's path about 1.3 s later:
          // long enough for the drawn shot to have caught up to its full lead.
          for (const offset of offsets) {
            const p = { id: `s${offset}`, x: selfX(tau + 1300) + offset, y: FOOT_Y - 1200, vx: 0, vy: 900, gravity: 0,
              maxLifetimeMs: 2000, radius: RADIUS, launchMono: sim, viewRewindMs: rewindMs, ownerName: 'foe' };
            shots.set(p.id, { p, server: Infinity, client: Infinity, last: sample(p, 0) });
            at(tau + down, () => replica.launch(p));
          }
        } else if (n > LAUNCH_STEP) {
          // Each step sweeps its segment against the victim as history has them R ago.
          const target = box(positionAt(player, rewindMs, now).x);
          for (const shot of shots.values()) {
            const next = sample(shot.p, sim - shot.p.launchMono);
            for (let k = 0; k <= 40; k++) {
              const point = { x: shot.last.x + (next.x - shot.last.x) * k / 40, y: shot.last.y + (next.y - shot.last.y) * k / 40 };
              shot.server = Math.min(shot.server, distance(point, target));
            }
            shot.last = next;
          }
        }
        if (n % 2 === 0) {
          // Snapshot: playout slews here; this human reads its own delay from it.
          publishedMotion(player, W(tau));
          const snapshot = { epoch: 'room', sentMono: M(tau) + 0.3, simMono: sim, playoutMs: reportedPlayoutMs(player),
            historyMs: reportedHistoryMs(player, W(tau) - M(tau)) };
          at(tau + down, () => { clock.observe(snapshot, local(tau + down)); clock.notePlayout(snapshot.playoutMs); clock.noteHistory(snapshot.historyMs); });
        }
      });
    }
    // The victim's frames, 2 ms apart: its own body as drawn against the drawn arrows.
    for (let tau = 0; tau < 4200; tau += 2) at(tau + 0.5, () => {
      for (const [id, shot] of shots) {
        const point = replica.position(id, local(tau + 0.5), true);
        if (point && point.age >= 0) shot.client = Math.min(shot.client, distance(point, box(selfX(tau + 0.5))));
      }
    });
    while (events.length) events.shift().run();
    return { shots: [...shots.values()], playoutMs: clock.playoutMs, leadMs: clock.enemyLeadMs(rewindMs), bestRtt: clock.bestSample()?.rtt };
  } finally {
    Date.now = realNow;
  }
}

test('an enemy projectile touches the victim on their screen exactly when the server hits them', () => {
  const offsets = []; for (let o = -90; o <= 90; o += 6) offsets.push(o);
  // The server sweeps each step's segment against the victim held at that
  // step, so up to one step of run (5 px) separates it from a continuous screen.
  const TOLERANCE = 300 / 60 + 1;
  // The last link's pings (not its inputs) are jittered: half the best ping
  // would overstate the uplink the server keys history by.
  for (const link of [{ up: 20, down: 40 }, { up: 90, down: 60 }, { up: 30, down: 30, pingJitter: 24 }]) {
    const led = victimFairnessRun({ offsets, ...link });
    assert.ok(led.playoutMs > 10, `playout delay reported (${led.playoutMs} ms)`);
    // Lead = rewind + own playout + the uplink history keys by, on this
    // clock (half the round trip of an unjittered ping, path asymmetry
    // included); the report rounds to a ms and moves in steps over 2 ms.
    assert.ok(Math.abs(led.leadMs - (120 + (link.up + link.down) / 2 + led.playoutMs)) <= 3, `lead ${led.leadMs}`);
    if (link.pingJitter) assert.ok(led.bestRtt / 2 - (link.up + link.down) / 2 >= 6, 'half the best ping would overstate it');
    let hits = 0;
    for (const { server, client, p } of led.shots) {
      if (server <= 0) hits++;
      assert.ok(Math.abs(server - client) <= TOLERANCE, `${p.id}: server clearance ${server.toFixed(1)} px, on screen ${client.toFixed(1)} px`);
      // Hit on the server if and only if it touched the victim on screen (a few px either way).
      if (Math.abs(server) > TOLERANCE) assert.equal(server <= 0, client <= 0, p.id);
    }
    assert.ok(hits > 3 && hits < led.shots.length - 3, `both hits and misses (${hits}/${led.shots.length})`);
  }
  // Without the lead the victim sees clean misses that the server counts as hits.
  const unled = victimFairnessRun({ lead: false, offsets });
  const worst = Math.max(...unled.shots.map(s => Math.abs(s.server - s.client)));
  assert.ok(worst > 25, `the unled screen disagrees by ${worst.toFixed(1)} px`);
});

test('the victim lead grows in after spawn and follows changes without jumping or running backwards', () => {
  const { advanceShownLead, LEAD_CATCHUP } = require('../src/shared/characters/sparrowReplication');
  const state = {};
  let previousAge = -Infinity, previousLead = null;
  for (let t = 0; t <= 3000; t += 4) {
    // The target lead changes abruptly (a new best ping, a playout restart).
    const target = t < 600 ? 160 : t < 1200 ? 90 : 210;
    const lead = advanceShownLead(state, target, t);
    if (t === 0) assert.equal(lead, 0, 'no lead on the first frame');
    if (t === 596) assert.equal(lead, 160, 'caught up to the first target');
    const age = t + lead;
    assert.ok(age >= previousAge, `age never decreases (${t} ms)`);
    if (previousLead !== null) assert.ok(lead - previousLead <= 4 * LEAD_CATCHUP + 1e-9 && previousLead - lead <= 4 * 0.1 + 1e-9, 'drawn speed stays within the catch-up bound');
    if (previousLead !== null && t > 596) assert.ok(Math.abs(lead - previousLead) <= 4 * 0.1 + 1e-9, 'once caught up, within 10%');
    previousAge = age; previousLead = lead;
  }
  assert.equal(previousLead, 210);
  // A flight drawn from the hand (age 0) catches up to server age at the same bounded speed.
  const hand = {};
  assert.equal(advanceShownLead(hand, 0, 0, -45), -45);
  assert.ok(advanceShownLead(hand, 0, 60, -45) < 0, 'still catching up');
  assert.equal(advanceShownLead(hand, 0, 200, -45), 0);
  // Absent rewind (an older server) and the A/B switch mean no lead.
  const clock = new CombatClock(); clock.reset('room');
  clock.synchronize({ epoch: 'room', sentMono: 100, simMono: 98 }, 0, 60); clock.notePlayout(30);
  assert.equal(clock.enemyLeadMs(undefined), 0);
  assert.equal(clock.enemyLeadMs(100), 160);
  clock.projectileLead = false;
  assert.equal(clock.enemyLeadMs(100), 0);
});
