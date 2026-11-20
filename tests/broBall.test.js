const assert = require('node:assert/strict');
const { test } = require('node:test');
const { advanceBall, sweepCircle } = require('../src/server/core/gameModes/broBall/physics');
const { BroBallGameMode } = require('../src/server/core/gameModes/broBall/BroBallGameMode');
const { updateBodyGeometry } = require('../src/server/core/gameRoom/inputManager');
const { ballRules: rules, broBallField, BRO_BALL_MODE, BRO_BALL_VARIANT } = require('../src/shared/broBall');
const { geometryFromMap, validateDocument, clone } = require('../src/shared/maps/mapDocument');
const { FIXED_DT_MS } = require('../src/shared/gameConstants');
const { createSelectionCatalog } = require('../src/shared/gameSelection');
const { selectionToLegacyMode } = require('../src/server/services/match/gameSelectionCatalog');
const { formatModeLabel } = require('../src/server/services/match/battleLog');
const { mapsCatalog } = require('../src/shared/maps');
const map = require('../src/shared/maps/6.json');

const { goals, kickoff } = map.objectiveLayout.broBall;
const geometry = geometryFromMap(map);
const field = broBallField(geometry, map.objectiveLayout.broBall);
const { floor } = field;
const dt = FIXED_DT_MS / 1000;
const rightGoal = goals.team2;
const player = () => ({
  id: 'player', left: kickoff.x - 57, right: kickoff.x - 7,
  top: kickoff.y - 46, bottom: kickoff.y + 46, vx: 0, vy: 0,
});

function step(ball, players = [], effects = [], seconds = dt) {
  return advanceBall(ball, seconds, field, players,
    (kind, contact) => effects.push({ kind, ...contact }));
}

test('the shipped arena resolves as the only Bro Ball formation and is available for public matchmaking', () => {
  const catalog = createSelectionCatalog(() => mapsCatalog.maps);
  const selection = catalog.normalizeSelection({ modeId: BRO_BALL_MODE });
  assert.deepEqual(selection, { modeId: BRO_BALL_MODE, modeVariantId: BRO_BALL_VARIANT, mapId: map.id });
  assert.equal(selectionToLegacyMode(selection.modeId, selection.modeVariantId), 2);
  assert.equal(formatModeLabel(selection.modeId, selection.modeVariantId), "Bro Ball 2v2");
  assert.equal(catalog.isSelectionQueueable(selection), true);
  assert.deepEqual(validateDocument(map), []);
  const broken = clone(map);
  broken.objectiveLayout.broBall.goals.team1.x += 10;
  assert.match(validateDocument(broken).join('\n'), /goal must line up/);
});

test('the raised goal step turns back a ball rolling along the turf', () => {
  const ball = { x: rightGoal.x - rules.radius - 40, y: floor - rules.radius, vx: 900, vy: 0 };
  const impacts = [];
  for (let i = 0; i < 20; i++) assert.equal(step(ball, [], impacts), null);
  assert.ok(ball.vx < 0);
  assert.ok(ball.x < rightGoal.x);
  assert.equal(impacts[0].kind, 'post');
  assert.equal(impacts[0].contact, undefined);
});

test('a high drop retains more of its incoming speed on the first rebound', () => {
  function reboundRatio(y) {
    const ball = { x: kickoff.x, y, vx: 0, vy: 0 };
    const impacts = [];
    for (let i = 0; i < 120 && !impacts.length; i++) step(ball, [], impacts);
    assert.equal(impacts[0]?.kind, 'wall', 'the ball rebounded off the turf');
    return -ball.vy / impacts[0].strength;
  }

  const lowDrop = reboundRatio(floor - rules.radius * 3);
  assert.ok(reboundRatio(kickoff.y) > lowDrop * 1.1);
});

test('swept circle resolves a rounded post corner instead of its enclosing square', () => {
  const rect = { left: 10, right: 50, top: 10, bottom: 50 };
  assert.equal(sweepCircle(5, 5, 1, 1, rect, 5), null);
  const hit = sweepCircle(5, 5, 8, 8, rect, 5);
  assert.ok(hit.t > 0 && hit.t < 1);
  assert.ok(hit.x < 0 && hit.y < 0);
});

test('body contact deflects the ball without commanding a kick', () => {
  const body = player();
  const ball = { x: body.right + rules.radius + 2, y: kickoff.y, vx: -300, vy: 0 };
  const effects = [];
  step(ball, [body], effects);
  assert.ok(ball.vx > 0 && ball.vx < 300);
  assert.deepEqual(effects.map(event => event.kind), ['body']);
  const [hit] = effects;
  assert.deepEqual(hit.contact, { x: hit.x - rules.radius, y: hit.y, nx: 1, ny: 0 });
});

test('an attack kick sends the ball away from the kicker and steeply upward', () => {
  const body = player();
  const ball = { x: body.right + rules.radius + 1, y: kickoff.y, vx: 0, vy: 0 };
  const effects = [];
  let kicks = 0;
  body.kick = { consume: () => kicks++ };
  step(ball, [body], effects);
  assert.equal(kicks, 1);
  assert.ok(ball.vx > 0);
  assert.ok(-ball.vy > ball.vx * 0.8, 'a level kick still climbs steeply');
  assert.deepEqual(effects.map(event => event.kind), ['kick']);
  const [hit] = effects;
  assert.deepEqual(hit.contact, { x: hit.x - rules.radius, y: hit.y, nx: 1, ny: 0 });
  assert.ok(hit.angle < 0, 'the shot lifts even though the contact faces sideways');
});

test('a sweeping dash kicks before an armed attack and spends one activation', () => {
  const body = player();
  Object.assign(body, { dash: { x: 1, y: 0 }, vx: 650 });
  const ball = { x: body.right + rules.radius + 6, y: kickoff.y, vx: 0, vy: 0 };
  const effects = [];
  let dashes = 0;
  body.consumeDash = () => dashes++;
  body.kick = { consume() {} };
  step(ball, [body], effects);
  assert.equal(dashes, 1);
  assert.ok(ball.vx > rules.kickSpeed);
  assert.deepEqual(effects.map(event => event.kind), ['super']);
});

test('follow-up attacks, supers and dashes build ball speed up to the cap', () => {
  const actions = [
    { kick: { consume() {} } },
    { kick: { special: true, consume() {} } },
    { dash: { x: 1, y: 0 }, consumeDash() {} },
  ];
  for (const action of actions) {
    function hit(vx, vy) {
      const body = { ...player(), ...action };
      const ball = { x: body.right + rules.radius + 1, y: kickoff.y, vx, vy };
      const effects = [];
      step(ball, [body], effects);
      const [impact] = effects;
      assert.ok(Math.abs(Math.hypot(ball.vx, ball.vy) - impact.strength) < 1e-6);
      return ball;
    }
    const speed = ball => Math.hypot(ball.vx, ball.vy);
    const first = hit(0, 0);
    const second = hit(first.vx, first.vy);
    assert.ok(speed(second) > speed(first));
    const third = hit(second.vx, second.vy);
    assert.ok(Math.abs(speed(third) - rules.maxSpeed) < 1e-6);
    const reversal = hit(-first.vx, -first.vy);
    assert.ok(Math.abs(speed(reversal) - speed(first)) < 1e-6);
    assert.ok(reversal.vx > 0);
  }
});

test('goal requires the entire ball to clear the line and a high shot hits the frame', () => {
  const ball = { x: rightGoal.x - 2, y: rightGoal.bottom - rules.radius - 10, vx: rules.dashSpeed, vy: 0 };
  const mouth = { left: rightGoal.x, right: rightGoal.backX, top: rightGoal.top, bottom: rightGoal.bottom };
  assert.ok(!geometry.colliders.some(rect => rect.left < mouth.right && rect.right > mouth.left &&
    rect.top < mouth.bottom && rect.bottom > mouth.top), 'players can walk into the goal');
  assert.equal(step(ball), null);
  assert.ok(ball.x > rightGoal.x);
  assert.equal(step(ball), 'team2');

  Object.assign(ball, { x: rightGoal.x - rules.radius - 5, y: rightGoal.top + 2, vx: rules.dashSpeed, vy: 0 });
  const impacts = [];
  assert.equal(step(ball, [], impacts), null);
  assert.ok(ball.vx < 0);
  assert.equal(impacts[0].kind, 'post');
});

function fixture() {
  const results = [];
  const room = {
    status: 'active', _loopRunning: true, geometry, FIXED_DT_MS,
    tickId: 1, players: new Map(), _scheduledActions: [],
    matchData: { modeId: BRO_BALL_MODE }, mapSnapshot: { map },
    broadcastWorldState() {}, broadcastSnapshot() {},
    finishGame: (winner, meta) => results.push({ winner, ...meta }),
  };
  const mode = new BroBallGameMode(room);
  mode.onStart();
  return { mode, room, results, state: mode.getModeState() };
}

test('own goal awards the other side once and kickoff invalidates previous attacks', () => {
  const { mode, room, state } = fixture();
  const now = 10000;
  Object.assign(state.ball, { x: goals.team1.x - rules.radius + 2,
    y: goals.team1.bottom - rules.radius - 10, vx: -rules.dashSpeed, vy: 0 });
  mode.tick(now);
  assert.deepEqual(state.score, { team1: 0, team2: 1 });
  assert.equal(mode.acceptsCombatInput({ broBallRally: 0 }), false);
  assert.equal(state.impacts.filter(event => event.kind === 'goal').length, 1);
  const remaining = state.remainingMs;
  room.tickId++;
  mode.tick(now + FIXED_DT_MS);
  assert.ok(state.ball.x < goals.team1.x - rules.radius);
  assert.equal(mode.buildMovementState().destroyed, false);
  for (let elapsed = FIXED_DT_MS * 2; elapsed < rules.goalPauseMs && !state.ball.destroyed; elapsed += FIXED_DT_MS) {
    room.tickId++;
    mode.tick(now + elapsed);
  }
  assert.equal(state.ball.x, goals.team1.backX + rules.radius);
  assert.equal(mode.buildMovementState().destroyed, true);
  assert.equal(state.remainingMs, remaining);
  assert.equal(state.score.team2, 1);
  room.tickId++;
  mode.tick(now + rules.goalPauseMs);
  assert.equal(mode.acceptsCombatInput({ broBallRally: 0 }), false);
  assert.equal(mode.acceptsCombatInput({ broBallRally: 1 }), true);
  // The new ball drops straight away from the kickoff point with a little drift.
  assert.equal(state.ball.x, kickoff.x);
  assert.equal(state.ball.y, kickoff.y);
  assert.ok(Math.abs(state.ball.vx) <= rules.kickoffDrift && state.ball.vy === 0);
  room.tickId++;
  mode.tick(now + rules.goalPauseMs + FIXED_DT_MS);
  assert.ok(state.ball.vy > 0 && state.ball.y > kickoff.y);
});

test('a slow goal rolls to a stop and disappears short of the back net', () => {
  const { mode, room, state } = fixture();
  const now = 10000;
  const line = rightGoal.x + rules.radius;
  const speed = rules.rollingDrag * dt * 8;
  Object.assign(state.ball, { x: line - speed * dt / 2,
    y: rightGoal.bottom - rules.radius, vx: speed, vy: 0 });
  mode.tick(now);
  assert.equal(state.score.team1, 1);
  const entrySpeed = state.ball.vx;

  room.tickId++;
  mode.tick(now + FIXED_DT_MS);
  assert.ok(state.ball.x > line);
  assert.ok(state.ball.vx > 0 && state.ball.vx < entrySpeed);
  assert.equal(mode.buildMovementState().destroyed, false);

  for (let elapsed = FIXED_DT_MS * 2; elapsed < rules.goalPauseMs && !state.ball.destroyed; elapsed += FIXED_DT_MS) {
    room.tickId++;
    mode.tick(now + elapsed);
  }
  assert.equal(mode.buildMovementState().destroyed, true);
  assert.equal(state.ball.vx, 0);
  assert.equal(state.ball.vy, 0);
  assert.ok(state.ball.x > line && state.ball.x < rightGoal.backX - rules.radius);
  assert.equal(state.score.team1, 1);
});

test('score limit, golden goal, and overtime draw settle with the final score', () => {
  const cap = fixture();
  cap.state.score.team1 = rules.scoreLimit - 1;
  cap.mode.scoreGoal('team2', 2000);
  assert.equal(cap.mode.buildMovementState().impacts.at(-1).winner, 'team1');
  cap.mode.tick(2000 + rules.goalPauseMs);
  assert.deepEqual(cap.results, [{ winner: 'team1', broBallScore: { team1: rules.scoreLimit, team2: 0 } }]);

  const golden = fixture();
  golden.state.remainingMs = 0;
  golden.mode.checkClock();
  assert.equal(golden.state.phase, 'overtime');
  assert.equal(golden.state.remainingMs, rules.overtimeMs);
  golden.mode.scoreGoal('team1', 2000);
  assert.equal(golden.mode.buildMovementState().impacts.at(-1).winner, 'team2');
  golden.mode.tick(2000 + rules.goalPauseMs);
  assert.deepEqual(golden.results, [{ winner: 'team2', broBallScore: { team1: 0, team2: 1 } }]);

  const draw = fixture();
  draw.state.remainingMs = 0;
  draw.mode.checkClock();
  draw.state.remainingMs = 0;
  draw.mode.checkClock();
  assert.deepEqual(draw.results, [{ winner: null, broBallScore: { team1: 0, team2: 0 } }]);
});

test('Map Studio solo rooms keep playing after a fifth goal and leave the clock stopped', () => {
  const { mode, room, state, results } = fixture();
  room.matchData.editorSoloPlaytest = true;
  mode.tick(1000);
  assert.equal(mode.buildModeState().practice, true);
  assert.equal(state.remainingMs, rules.regulationMs);
  state.score.team1 = rules.scoreLimit - 1;
  mode.scoreGoal('team2', 2000);
  assert.equal(mode.buildMovementState().impacts.at(-1).winner, null);
  mode.tick(2000 + rules.goalPauseMs);
  assert.equal(state.score.team1, rules.scoreLimit);
  assert.equal(state.reset, 1);
  assert.deepEqual(results, []);
});

test('a grounded side touch lifts the ball and an airborne deflection keeps its natural angle', () => {
  const body = player();
  body.bottom = floor;
  const ball = { x: body.right + rules.radius + 2, y: floor - rules.radius, vx: -240, vy: 0 };
  step(ball, [body]);
  assert.ok(ball.vx > 0);
  assert.ok(ball.vy <= -rules.bodyLift);
  assert.ok(ball.y < floor - rules.radius);

  const airborne = { x: body.right + rules.radius + 2, y: kickoff.y - 12, vx: -240, vy: 0 };
  step(airborne, [body]);
  assert.ok(airborne.vx > 0);
  assert.ok(airborne.vy >= 0);
});

test('a downward dash smashes a grounded ball upfield instead of flattening it into the floor', () => {
  const ball = { x: kickoff.x, y: floor - rules.radius, vx: 0, vy: 0 };
  const body = {
    ...player(), top: ball.y - 115, bottom: ball.y - rules.radius - 19,
    left: ball.x - 24, right: ball.x + 24, vx: 0, vy: 840,
    dash: { x: 0, y: 1, facing: -1 },
  };
  const effects = [];
  let dashes = 0;
  body.consumeDash = () => dashes++;
  step(ball, [body], effects);
  assert.equal(dashes, 1);
  assert.deepEqual(effects.map(event => event.kind), ['smash']);
  assert.ok(ball.vy < 0);
  assert.ok(ball.vx < -rules.kickSpeed, 'sent upfield harder than a kick');
});

test('an accepted super kicks harder than an attack, and bots kick on a cooldown without attacking', () => {
  const { mode, room, state } = fixture();
  const p = {
    user_id: 3, isAlive: true, loaded: true, connected: true,
    x: kickoff.x - rules.radius - 27, y: kickoff.y,
  };
  room.players.set('player', p);
  mode.onAttackAccepted(p, {}, true);
  mode.tick(1000);
  assert.equal(state.impacts[0].kind, 'super');
  assert.ok(Math.hypot(state.ball.vx, state.ball.vy) > rules.kickSpeed);

  assert.equal(mode.botKick(p), true);
  assert.equal(mode.botKick(p), false, 'inside the cooldown');
});

const { acceptDash } = require('../src/shared/physics/dash');

// A fixture player standing on the pitch, ready to play.
function athlete(room, id, x, team = 'team1') {
  const p = {
    user_id: id, name: `p${id}`, team, isAlive: true, loaded: true, connected: true,
    superCharge: 0, maxSuperCharge: 100, x, y: floor - 42, vx: 0, vy: 0,
  };
  room.players.set(`p${id}`, p);
  return p;
}

test('standing up pops the ball into the air while jumping sends it higher', () => {
  function hitBall(jumpDistance) {
    const { mode, room, state } = fixture();
    const p = athlete(room, 1, kickoff.x);
    p.char_class = 'ninja';
    updateBodyGeometry(p, room);
    p.y += floor - (p.y + p._bodyCenterOffsetY + p._bodyHalfHeight);
    p.ducking = true;
    updateBodyGeometry(p, room);
    assert.equal(p.ducking, true);
    mode.tick(1000);
    Object.assign(state.ball, {
      x: p.x + p._bodyCenterOffsetX,
      y: p.y + p._bodyCenterOffsetY - p._bodyHalfHeight - rules.radius,
      vx: 0, vy: 0,
    });

    p.ducking = false;
    p.y -= jumpDistance;
    updateBodyGeometry(p, room);
    mode.tick(1000 + FIXED_DT_MS);
    const bodyTop = p.y + p._bodyCenterOffsetY - p._bodyHalfHeight;
    assert.ok(state.ball.y + rules.radius <= bodyTop, 'the standing hitbox clears the ball');
    const launchSpeed = -state.ball.vy;
    const launchY = state.ball.y;
    while (state.ball.vy < 0 && room.tickId < Math.ceil(1 / dt)) {
      room.tickId++;
      mode.tick(1000 + room.tickId * FIXED_DT_MS);
    }
    return { launchSpeed, rise: launchY - state.ball.y };
  }

  const standing = hitBall(0);
  assert.ok(standing.rise > rules.radius / 2, 'the ball visibly rises after clearing the head');
  assert.ok(standing.launchSpeed < rules.bodyLift, 'the pop is softer than a grounded side touch');
  assert.ok(hitBall(5).launchSpeed > standing.launchSpeed, 'jumping still gives the ball more lift');
});

test('a ball dropped squarely onto a stationary player falls to the pitch', () => {
  const body = { ...player(), left: kickoff.x - 26, right: kickoff.x + 26, top: floor - 84, bottom: floor };
  const ball = { x: kickoff.x, y: body.top - rules.radius - 40, vx: 0, vy: 0 };
  for (let i = 0; i < Math.ceil(2 / dt); i++) step(ball, [body]);
  assert.equal(ball.y, floor - rules.radius);
  assert.equal(ball.vy, 0);
});

test('moving sideways kicks a ball off the head in the direction of travel', () => {
  for (const direction of [-1, 1]) {
    const body = {
      ...player(), left: kickoff.x - 26, right: kickoff.x + 26, top: floor - 84, bottom: floor,
      vx: direction * 180,
    };
    const ball = { x: kickoff.x, y: body.top - rules.radius, vx: 0, vy: 0 };
    const effects = [];
    step(ball, [body], effects);
    assert.ok(direction * ball.vx > 0, 'the ball leaves in the direction of travel');
    assert.ok(Math.abs(ball.vx) < Math.abs(body.vx), 'a brush transfers only part of the run speed');
    assert.equal(effects[0]?.kind, 'body');
  }
});

test('an off-center head contact keeps its exit side and preserves a fast crossing', () => {
  for (const direction of [-1, 1]) {
    const body = {
      ...player(), left: kickoff.x - 26, right: kickoff.x + 26, top: floor - 84, bottom: floor,
      vx: direction * 180,
    };
    const trailing = { x: kickoff.x - direction * 20, y: body.top - rules.radius, vx: 0, vy: 20 };
    step(trailing, [body]);
    assert.ok(direction * trailing.vx <= 0, 'the player moves out from under a ball on the trailing side');

    body.vx = 0;
    const falling = { x: trailing.x, y: body.top - rules.radius, vx: 0, vy: 80 };
    step(falling, [body]);
    assert.ok(direction * falling.vx < 0, 'a slow off-center ball falls toward the nearer edge');

    const crossing = { x: trailing.x, y: body.top - rules.radius, vx: direction * 200, vy: 80 };
    step(crossing, [body]);
    assert.ok(direction * crossing.vx > 0, 'a fast crossing keeps its sideways momentum');
    assert.ok(Math.abs(crossing.vx) <= 200, 'a flat landing does not speed up a fast crossing');
  }
});

test('one-way platforms catch a falling ball and let a rising ball through', () => {
  const platform = geometry.colliders.find(rect => rect.id === 'platform-left');
  const falling = { x: (platform.left + platform.right) / 2, y: platform.top - rules.radius - 30, vx: 0, vy: 300 };
  for (let i = 0; i < 20; i++) step(falling);
  assert.ok(falling.y + rules.radius <= platform.top + 1, 'landed on top');
  const rising = { x: falling.x, y: platform.bottom + rules.radius + 4, vx: 0, vy: -700 };
  for (let i = 0; i < 12; i++) step(rising);
  assert.ok(rising.y < platform.top - rules.radius, 'passed up through it');
  const short = { x: falling.x, y: platform.top - rules.radius / 2, vx: 0, vy: -20 };
  for (let i = 0; i < 30; i++) step(short);
  assert.ok(short.y > platform.bottom, 'falls back through after only partly clearing the deck');
});

test('Bro Ball players can dash again when the full recharge ends after the burst', () => {
  const { mode, room } = fixture();
  const p = athlete(room, 1, kickoff.x);
  mode.tick(1000);
  const input = { dashSeq: 1, dashX: 1, dashY: 0 };
  assert.equal(acceptDash(p, input, 5000), true);
  const readyAt = p._dashUntil + rules.dashCooldownMs;
  assert.equal(acceptDash(p, { ...input, dashSeq: 2 }, readyAt - 1), false);
  assert.equal(acceptDash(p, { ...input, dashSeq: 3 }, readyAt), true);
});

const { makeRoom } = require('./helpers/botRoom');

test('bots keep one ball chaser, give the other a support strategy, and play the ball', (t) => {
  let now = 1000000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(Math, 'random', () => 0.5);
  t.mock.method(console, 'log', () => {});
  const h = makeRoom({ map: 6, characters: ['ninja', 'thorg', 'sparrow', 'ozzy'], seed: 3 });
  t.after(() => h.room.cleanup());
  const { room } = h, mode = room.gameMode;
  room._loopRunning = true;
  mode.onStart();
  room.finishGame = () => { room.status = 'ended'; };
  const played = new Set();
  const chasingTeams = new Set(), supportingTeams = new Set();
  for (const p of h.players) {
    Object.assign(p, room.spawnStateFor(p), { loaded: true });
    // Check each role against the current team plan when the bot thinks.
    // Teammates can still have assignments from earlier think ticks.
    Object.defineProperty(p, '_broBallRole', {
      set(role) {
        assert.equal(role === 'chaser', room._broBallPlans[p.team].chaser === p.participantId);
        if (role === 'chaser') chasingTeams.add(p.team);
        else {
          assert.ok(['keeper', 'advancer', 'hunter'].includes(role), role);
          supportingTeams.add(p.team);
        }
      },
    });
  }
  for (let i = 0; i < 60 * 8 && room.status === 'active'; i++) {
    now += FIXED_DT_MS;
    h.tick(now);
    mode.tick(now);
    for (const impact of mode.getModeState().impacts) played.add(impact.kind);
  }
  assert.ok(['kick', 'super', 'body'].some(kind => played.has(kind)), [...played].join());
  assert.equal(chasingTeams.size, 2);
  assert.equal(supportingTeams.size, 2);
});

test('sustained pressure against the step or floor does not repeatedly strike a trapped ball', () => {
  for (const overhead of [false, true]) {
    const ball = { x: rightGoal.x - rules.radius, y: floor - rules.radius, vx: 0, vy: 0 };
    const x = ball.x, y = ball.y;
    const body = overhead
      ? { left: x - 20, right: x + 20, top: y - 75, bottom: y - 15, vx: 0, vy: 350 }
      : { left: x - 65, right: x - 15, top: y - 40, bottom: floor, vx: 260, vy: 0 };
    const effects = [];
    for (let i = 0; i < 60; i++) {
      step(ball, [{ id: 'p', ...body }], effects);
      assert.ok(Math.hypot(ball.x - x, ball.y - y) < 0.1, 'passive pressure holds the corner');
      // Walk or land far enough to overlap the ball's center.
      if (i < 5) {
        body.left += body.vx * dt;
        body.right += body.vx * dt;
        body.top += body.vy * dt;
        body.bottom += body.vy * dt;
      } else {
        body.vx = body.vy = 0;
      }
    }
    assert.equal(effects.length, 0);
    body.kick = { consume() {} };
    step(ball, [{ id: 'p', ...body }], effects);
    assert.ok(effects.some(event => event.kind === 'kick'), 'a pinned player can still kick');
  }
});
