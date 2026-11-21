const assert = require('node:assert/strict');
const { test } = require('node:test');
const { advanceBall, sweepCircle } = require('../src/server/core/gameModes/broBall/physics');
const { BroBallGameMode } = require('../src/server/core/gameModes/broBall/BroBallGameMode');
const { updateBodyGeometry } = require('../src/server/core/gameRoom/inputManager');
const { ballRules: rules, broBallField, BRO_BALL_MODE, BRO_BALL_VARIANT } = require('../src/shared/broBall');
const { geometryFromMap, validateDocument, clone } = require('../src/shared/maps/mapDocument');
const { FIXED_DT_MS } = require('../src/shared/gameConstants');
const { characterDefinitions } = require('../src/shared/characters');
const { getResolvedCharacterSpecialConfig } = require('../src/shared/characters/characterTuning');
const { getResolvedAttackDescriptor } = require('../src/shared/combat/runtime/attackDescriptorResolver');
const { handleCharacterAction } = require('../src/shared/combat/runtime/characterActionRegistry');
const { requestSpecial } = require('../src/shared/combat/runtime/actions');
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

test('passive touches deflect a ball just outside its physical radius', () => {
  const body = player();
  const edge = body.right + rules.radius;
  const vx = -rules.bodyContactPadding / (4 * dt);
  const near = { x: edge + rules.bodyContactPadding * 1.125, y: kickoff.y, vx, vy: 0 };
  const far = { ...near, x: edge + rules.bodyContactPadding * 2 };
  const effects = [];

  step(far, [body], effects);
  step(near, [body], effects);

  assert.ok(far.vx < 0);
  assert.ok(near.vx > 0 && near.x > edge);
  assert.deepEqual(effects.map(event => event.kind), ['body']);
});

test('overhead touches have more reach than side touches', () => {
  const body = player();
  const sideReach = rules.radius + rules.bodyContactPadding;
  const topReach = sideReach + rules.bodyContactTopPadding;
  const gap = (sideReach + topReach) / 2;
  const overhead = { x: (body.left + body.right) / 2, y: body.top - gap, vx: 0, vy: 80 };
  const tooHigh = { ...overhead, y: body.top - topReach - rules.bodyContactTopPadding / 2 };
  const alongside = { x: body.right + gap, y: kickoff.y, vx: -80, vy: 0 };
  const effects = [];

  step(tooHigh, [body], effects);
  step(alongside, [body], effects);
  step(overhead, [body], effects);

  assert.ok(tooHigh.vy > 0);
  assert.ok(alongside.vx < 0);
  assert.ok(overhead.vy < 0);
  assert.deepEqual(effects.map(event => event.kind), ['body']);
});

test('side-on attacks and supers send the ball forward with a shallow lift', () => {
  for (const special of [false, true]) {
    const body = player();
    const ball = { x: body.right + rules.radius + 1, y: kickoff.y, vx: 0, vy: 0 };
    const effects = [];
    let kicks = 0;
    body.kick = { special, consume: () => kicks++ };
    step(ball, [body], effects);
    assert.equal(kicks, 1);
    assert.ok(-ball.vy > 0 && -ball.vy < ball.vx * 0.75);
    assert.deepEqual(effects.map(event => event.kind), [special ? 'super' : 'kick']);
    const [hit] = effects;
    assert.deepEqual(hit.contact, { x: hit.x - rules.radius, y: hit.y, nx: 1, ny: 0 });
    assert.ok(hit.angle < 0, 'the shot lifts even though the contact faces sideways');
  }
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

test('goals credit the last player to touch the ball on the scoring team', () => {
  const { mode, state } = fixture();
  const body = { ...player(), id: 'p1', name: 'First', team: 'team1' };
  const ball = state.ball;
  Object.assign(ball, { x: body.right + rules.radius + 2, y: kickoff.y, vx: -300, vy: 0 });
  step(ball, [body]);
  mode.scoreGoal('team2', 1000);
  assert.deepEqual(mode.buildModeState().playerGoals, { First: 1 });
  mode.scoreGoal('team2', 2000);
  assert.deepEqual(mode.buildModeState().playerGoals, { First: 2 });
  ball.lastTouch = { id: 'p2', name: 'Second', team: 'team2' };
  mode.scoreGoal('team2', 3000);
  assert.deepEqual(mode.buildModeState().playerGoals, { First: 2 });
});

test('Bro Ball respawns without protection even if an opening shield is still active', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
  const { mode, room } = fixture();
  const spawn = { x: kickoff.x - 100, y: floor - 50 };
  const fighter = athlete(room, 1, kickoff.x);
  fighter.isAlive = false;
  fighter.maxHealth = 100;
  fighter.activeEffects = { respawnShield: { until: Date.now() + 10000 } };
  const arrivals = [];
  room.spawnStateFor = () => spawn;
  room.broadcast = (event, payload) => { if (event === 'player:respawn') arrivals.push(payload); };
  room.broadcastHealthUpdate = () => {};
  const { scheduleRespawn } = require('../src/server/core/gameRoom/respawn');
  scheduleRespawn(room, fighter, mode.getRespawnPlan(fighter));
  t.mock.timers.tick(rules.respawnMs);
  assert.equal(fighter.isAlive, true);
  assert.equal(fighter.health, fighter.maxHealth);
  assert.equal(fighter.activeEffects.respawnShield, undefined);
  assert.equal(arrivals.length, 1);
  assert.equal(arrivals[0].shieldMs, 0);
  assert.deepEqual({ x: arrivals[0].x, y: arrivals[0].y }, spawn);
});

test('own goal pauses combat and the kickoff teleport clears the previous rally', () => {
  const { mode, room, state } = fixture();
  const draven = athlete(room, 1, kickoff.x);
  draven.effects = { dravenInfernoUntil: Infinity };
  draven.activeEffects = { freeze: { until: Infinity } };
  draven._gloopPullState = { until: Infinity };
  room.activeAttacks = [{ attackerParticipantId: draven.participantId }];
  room._scheduledActions.push({ callback() {}, at: 10000 });
  const spawn = { x: kickoff.x - 100, y: kickoff.y };
  room.spawnStateFor = () => spawn;
  const arrivals = [];
  room.broadcast = (event, payload) => { if (event === 'player:respawn') arrivals.push(payload); };
  room.broadcastHealthUpdate = () => {};
  const now = 10000;
  Object.assign(state.ball, { x: goals.team1.x - rules.radius + 2,
    y: goals.team1.bottom - rules.radius - 10, vx: -rules.dashSpeed, vy: 0 });
  mode.tick(now);
  assert.deepEqual(state.score, { team1: 0, team2: 1 });
  assert.equal(mode.isCombatPaused(), true);
  assert.equal(draven.effects.dravenInfernoUntil, Infinity);
  assert.equal(draven.activeEffects.freeze.until, Infinity);
  assert.ok(draven._gloopPullState);
  assert.equal(room.activeAttacks.length, 1);
  assert.equal(room._scheduledActions.length, 1);
  assert.equal(arrivals.length, 0);
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
  assert.equal(mode.isCombatPaused(), false);
  assert.deepEqual([draven.x, draven.y], [spawn.x, spawn.y]);
  assert.deepEqual(draven.effects, {});
  assert.deepEqual(draven.activeEffects, {});
  assert.equal(draven._gloopPullState, undefined);
  assert.equal(room.activeAttacks.length, 0);
  assert.equal(room._scheduledActions.length, 0);
  assert.equal(arrivals.length, 1);
  assert.equal(arrivals[0].kickoff, true);
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

test('a scheduled death respawn waits for the kickoff teleport during a goal pause', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
  const { mode, room } = fixture();
  room.gameMode = mode;
  const fighter = athlete(room, 1, kickoff.x);
  fighter.isAlive = false;
  const arrivals = [];
  room.spawnStateFor = () => ({ x: kickoff.x - 100, y: kickoff.y });
  room.broadcast = (event, payload) => { if (event === 'player:respawn') arrivals.push(payload); };
  room.broadcastHealthUpdate = () => {};
  const { scheduleRespawn } = require('../src/server/core/gameRoom/respawn');
  scheduleRespawn(room, fighter, { ...mode.getRespawnPlan(fighter), delayMs: FIXED_DT_MS });
  mode.scoreGoal('team1', Date.now());
  t.mock.timers.tick(Math.ceil(FIXED_DT_MS));
  assert.equal(fighter.isAlive, false);
  assert.equal(arrivals.length, 0);
  mode.tick(10000 + rules.goalPauseMs);
  assert.equal(fighter.isAlive, true);
  assert.equal(arrivals.length, 1);
  assert.equal(arrivals[0].kickoff, true);
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

test('landing on a grounded ball pops it toward the contact side or the player’s facing', () => {
  for (const [offset, flip, direction] of [[0, true, -1], [0, false, 1], [12, true, 1], [-12, false, -1]]) {
    const { mode, room, state } = fixture();
    const ball = { x: kickoff.x, y: floor - rules.radius, vx: 0, vy: 0 };
    Object.assign(state.ball, ball);
    const p = athlete(room, 1, ball.x - offset);
    p.flip = flip;
    p.y = ball.y - rules.radius - rules.bodyContactPadding - 42 - 2;
    mode.tick(1000);

    p.y += 350 * dt;
    mode.tick(1000 + FIXED_DT_MS);

    assert.ok(direction * state.ball.vx > 0, 'the ball goes in the expected direction');
    assert.ok(state.ball.y < ball.y && state.ball.vy < 0, 'the ball lifts off the pitch');
    assert.deepEqual(state.impacts.map(impact => impact.kind), ['body']);
    assert.equal(mode.buildMovementState().impacts[0].contact.foot, true);
    for (let i = 2; i < 8; i++) {
      p.y = Math.min(floor - 42, p.y + 350 * dt);
      mode.tick(1000 + i * FIXED_DT_MS);
    }
    assert.equal(state.impactSequence, 1, 'one landing produces one impact');
  }
});

test('a foot impact compresses the visible top of the ball and keeps the bottom in place', () => {
  const { loadClientModule } = require('./helpers/clientModule');
  const { createBallSprite, footPressAt } = loadClientModule('src/client/game/modes/broBall/ballArt.js');
  let image;
  const context = {
    createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: frame => { image = frame; },
  };
  const texture = { setFilter() {}, refresh() {}, getContext: () => context };
  const scene = {
    textures: { exists: () => false, createCanvas: () => texture },
    add: { image: () => ({ setDisplaySize() { return this; } }) },
  };
  const sphere = createBallSprite(scene, { Textures: { FilterMode: { NEAREST: 0 } } }, rules.radius * 2);
  function visibleRows() {
    const rows = [];
    for (let i = 3; i < image.data.length; i += 4) {
      if (image.data[i]) rows.push(Math.floor((i - 3) / 4 / image.width));
    }
    return [rows[0], rows.at(-1)];
  }
  const round = visibleRows();
  const impact = { strength: 350, contact: { nx: 0, ny: 1, foot: true } };
  const contactPose = footPressAt(impact, 0, rules.maxSpeed);
  const heldPose = footPressAt(impact, 45, rules.maxSpeed);
  assert.equal(contactPose.release, 0);
  assert.equal(heldPose.release, 0, 'the ball stays at contact during the squish');
  assert.equal(heldPose.stretch, contactPose.stretch);
  sphere.paint({ dt: 0, press: contactPose });
  const pressed = visibleRows();
  assert.ok(pressed[0] - round[0] >= (round[1] - round[0]) * 0.2, 'the top visibly squishes inward');
  assert.equal(pressed[1], round[1], 'the opposite edge stays planted');

  const releasePose = footPressAt(impact, 135, rules.maxSpeed);
  assert.ok(releasePose.release > 0 && releasePose.release < 1, 'the ball starts moving as it springs back out');
  sphere.paint({ dt: 0, press: releasePose });
  assert.ok(visibleRows()[0] < pressed[0], 'the ball springs back out');
  sphere.paint({ dt: 0, press: footPressAt(impact, 280, rules.maxSpeed) });
  assert.deepEqual(visibleRows(), round);
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

test('Bro Ball kicks on late contact during a swing or around the firing moment', () => {
  const { actionFlow } = getResolvedAttackDescriptor(characterDefinitions.ozzy.basicAction);
  const { runtime } = getResolvedAttackDescriptor(characterDefinitions.thorg.basicAction);
  const inferno = getResolvedCharacterSpecialConfig('draven', 'inferno');

  for (const [character, elapsed, special] of [
    ['ozzy', actionFlow.startupMs + rules.kickWindowMs / 2, false],
    ['thorg', runtime.windupMs + runtime.activeWindowMs - FIXED_DT_MS, false],
    ['draven', inferno.firstDamageDelayMs + rules.kickWindowMs / 2, true],
  ]) {
    const { state, advance, approach } = kickTimingFixture(character, special);
    advance(elapsed - FIXED_DT_MS);
    assert.equal(state.impacts.length, 0, character);
    approach();
    assert.deepEqual(state.impacts.map(impact => impact.kind), [special ? 'super' : 'kick'], character);

    // Put the ball back beside the same player while the move could still kick.
    Object.assign(state.ball, { x: kickoff.x, y: floor - rules.radius, vx: 0, vy: 0 });
    advance(FIXED_DT_MS);
    assert.equal(state.impactSequence, 1, character);
  }
});

test('Inferno stops kicking the ball after its opening burst', () => {
  const inferno = getResolvedCharacterSpecialConfig('draven', 'inferno');
  const { state, advance, approach } = kickTimingFixture('draven', true);
  advance(inferno.firstDamageDelayMs + rules.kickWindowMs + 2 * FIXED_DT_MS);
  approach();
  assert.equal(state.impacts.length, 0);
});

test('an expired or interrupted cast cannot kick the ball', () => {
  const { actionFlow } = getResolvedAttackDescriptor(characterDefinitions.ozzy.basicAction);
  const expired = kickTimingFixture('ozzy');
  expired.advance(actionFlow.startupMs + rules.kickWindowMs + 2 * FIXED_DT_MS);
  expired.approach();
  assert.equal(expired.state.impacts.length, 0);

  const interrupted = kickTimingFixture('ozzy');
  interrupted.player._attackInterruptSeq = 1;
  interrupted.advance(actionFlow.startupMs);
  interrupted.approach();
  assert.equal(interrupted.state.impacts.length, 0);
});

function kickTimingFixture(character, special = false) {
  const { mode, room, state } = fixture();
  const actionAt = 10000;
  const reach = 26 + rules.radius + rules.kickReach;
  const player = athlete(room, 1, kickoff.x - reach - 8);
  Object.assign(player, { char_class: character, superCharge: player.maxSuperCharge });
  Object.assign(state.ball, { x: kickoff.x, y: floor - rules.radius, vx: 0, vy: 0 });
  room.gameMode = mode;
  room.broadcast = () => {};
  room.combatClock = { now: () => actionAt + (room.tickId - 1) * FIXED_DT_MS };
  room.scheduleAction = (callback, delay) => {
    room._scheduledActions.push({ callback, at: actionAt + delay });
  };

  function advance(ms) {
    const steps = Math.round(ms / FIXED_DT_MS);
    for (let i = 0; i < steps; i++) {
      room.tickId++;
      const now = room.combatClock.now();
      if (room._scheduledActions[0]?.at <= now) room._scheduledActions.shift().callback();
      mode.tick(now);
    }
  }
  if (special) {
    assert.equal(requestSpecial(room, `user:${player.user_id}`, { broBallRally: state.reset }), true);
  } else {
    const action = { type: characterDefinitions[character].basicAction, id: 'kick-test' };
    assert.ok(handleCharacterAction(room, player, action));
  }
  return {
    player, state, advance,
    approach() {
      player.x += 12;
      advance(FIXED_DT_MS);
    },
  };
}

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

test('a human Sparrow releases one damaging bolt in the current Bro Ball rally', t => {
  const { room, players: [sparrow, ninja], events } = makeRoom({ map: 6, characters: ['sparrow', 'ninja'] });
  t.after(() => room.cleanup());
  const { createLocalPlayerFixture } = require('./helpers/localPlayerFixture');
  const { SERAPH, boltOrigin } = require('../src/shared/characters/sparrowLightBolt');
  const ability = require('../src/shared/combat/runtime/abilities/sparrowSeraphAbility');
  const sparrowCombat = require('../src/shared/combat/runtime/sparrowCombat');
  const angle = -Math.PI / 6;
  const f = createLocalPlayerFixture({ character: 'sparrow', characterClass: {
    followUpActive: () => true,
    getFollowUpAngle: () => angle,
    releaseFollowUp: (_scene, _player, aim) => ({ type: 'sparrow-light-bolt', id: 'manual-release', angle: aim }),
  } });
  t.after(() => f.destroy());
  const state = room.gameMode.getModeState();
  state.reset = 2;
  room.simulationMono = 10000;
  f.scene._modeRuntime = { rally: state.reset };
  const packets = [];
  f.socket.on('game:action', action => packets.push(action));
  Object.assign(sparrow, { isBot: false, loaded: true, superCharge: sparrow.maxSuperCharge, x: kickoff.x - 300, y: kickoff.y });
  const origin = boltOrigin(sparrow, angle);
  Object.assign(ninja, { loaded: true, x: origin.x + Math.cos(angle) * 240, y: origin.y + Math.sin(angle) * 240 });
  const health = ninja.health;
  assert.equal(room.requestSpecial(sparrow.participantId, { broBallRally: state.reset }), true);

  f.press('attack');
  f.frame();
  assert.equal(packets.length, 1);
  const [release] = packets;
  assert.equal(room.handlePlayerAction(sparrow.participantId, { ...release, broBallRally: state.reset - 1 }), false);
  assert.equal(room.handlePlayerAction(sparrow.participantId, release), true, 'the client release is accepted in this rally');
  assert.equal(room.handlePlayerAction(sparrow.participantId, release), false, 'the same release cannot fire twice');
  for (let frame = 0; frame < 5; frame++) {
    room.simulationMono += FIXED_DT_MS;
    sparrowCombat.tick(room);
  }
  assert.equal(ninja.health, health - sparrow.specialDamage, 'damage lands on the manual shot');
  ability.tick(room, sparrow, Date.now() + SERAPH.aimMs + SERAPH.releaseGraceMs);
  const bolts = events.filter(({ payload }) => payload?.action?.type === 'sparrow-bolt');
  assert.equal(bolts.length, 1, 'no fallback shot fires after a successful release');
  assert.equal(bolts[0].payload.action.auto, false);
});

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

test('a body crossing the whole ball between samples still knocks it away', () => {
  const { mode, room, state } = fixture();
  const startX = kickoff.x;
  Object.assign(state.ball, { x: startX, y: floor - rules.radius, vx: 0, vy: 0 });
  const p = athlete(room, 1, startX - 100);
  mode.tick(1000);
  p.x = startX + 100;
  mode.tick(1000 + FIXED_DT_MS);
  assert.ok(state.ball.x > startX && state.ball.vx > 0);
  assert.equal(state.impacts.filter(event => event.kind === 'body').length, 1);
});

test('walking or landing on a ball pinned against the goal step dislodges it once', () => {
  for (const overhead of [false, true]) {
    const ball = { x: rightGoal.x - rules.radius, y: floor - rules.radius, vx: 0, vy: 0 };
    const x = ball.x, y = ball.y;
    const body = overhead
      ? { left: x - 20, right: x + 20, top: y - 75, bottom: y - 15, vx: 0, vy: 350 }
      : { left: x - 65, right: x - 15, top: y - 40, bottom: floor, vx: 260, vy: 0 };
    const effects = [];
    step(ball, [{ id: 'p', ...body, vx: 0, vy: 0 }], effects);
    assert.equal(effects.length, 0, 'resting overlap alone has no impact');
    for (let i = 0; i < 5; i++) {
      step(ball, [{ id: 'p', ...body }], effects);
      body.left += body.vx * dt;
      body.right += body.vx * dt;
      body.top += body.vy * dt;
      body.bottom += body.vy * dt;
    }
    assert.ok(ball.y < y && ball.vy < 0, 'the ball pops out of the corner');
    assert.ok(ball.x <= x + 0.1, 'the goal step still blocks the ball');
    if (overhead) assert.ok(ball.vx < 0, 'the landing uses the open side when facing the step');
    assert.equal(effects.filter(event => event.kind === 'body').length, 1, 'one impact per encounter');
    body.kick = { consume() {} };
    step(ball, [{ id: 'p', ...body }], effects);
    assert.ok(effects.some(event => event.kind === 'kick'), 'a pinned player can still kick');
  }
});

for (const id of ['platform-left', 'platform-right', 'wall-log-left', 'wall-log-right']) {
  test(`a chaser starting on the pitch plays a stationary ball on ${id}`, t => {
    let now = 1000000;
    t.mock.method(Date, 'now', () => now);
    t.mock.method(console, 'log', () => {});
    const h = makeRoom({ map: 6, characters: ['ninja'] });
    t.after(() => h.room.cleanup());
    const mode = h.room.gameMode;
    h.room._loopRunning = true;
    mode.onStart();
    const p = h.players[0];
    p.loaded = true;
    h.place(p, kickoff.x, h.room.geometry.anchors['pitch-floor']);
    const deck = mode.field.colliders.find(s => s.id === id);
    const state = mode.getModeState();
    Object.assign(state.ball, { x: deck.x, y: deck.top - rules.radius, vx: 0, vy: 0 });
    let touched = false, cleared = false;
    for (let i = 0; i < 60 * 14 && !cleared; i++) {
      now += FIXED_DT_MS;
      h.tick(now);
      mode.tick(now);
      touched ||= state.impacts.some(hit => ['super', 'kick', 'body', 'smash'].includes(hit.kind));
      cleared = touched && (state.ball.x < deck.left || state.ball.x > deck.right);
    }
    assert.ok(cleared,
      `stopped at ${p.x}, ${p.y} on ${p.platformId}`);
  });
}

for (const powered of [false, true]) {
  test(`an advanced teammate receives a ${powered ? 'dash' : 'regular'} pass`, t => {
    let now = 1000000;
    t.mock.method(Date, 'now', () => now);
    t.mock.method(console, 'log', () => {});
    const h = makeRoom({ map: 6, characters: ['ninja', 'thorg', 'ozzy'] });
    t.after(() => h.room.cleanup());
    h.room._loopRunning = true;
    const mode = h.room.gameMode;
    mode.onStart();
    const [kicker, defender, receiver] = h.players;
    const pitch = h.room.geometry.anchors['pitch-floor'];
    for (const p of h.players) p.loaded = true;
    h.place(kicker, 370, pitch);
    h.place(receiver, powered ? 1050 : 850, pitch);
    h.place(defender, 1650, pitch);
    const state = mode.getModeState();
    Object.assign(state.ball, { x: powered ? 475 : 435, y: pitch.top - rules.radius, vx: 0, vy: 0 });
    const effects = require('../src/shared/combat/runtime/effects/effectManager');
    const brain = h.room.botControllers.get(kicker.participantId);
    brain.think(null, effects.getModifiers(kicker, now), now);
    if (powered) assert.ok(brain.intent.dash);
    brain.nextThink = now + 140;
    const plan = h.room._broBallPlans[kicker.team];
    assert.equal(plan.receiver, receiver.participantId);
    let released = false, received = false, jumpedEarly = false;
    for (let i = 0; i < 120 && !received; i++) {
      now += FIXED_DT_MS;
      h.tick(now);
      mode.tick(now);
      released ||= state.impacts.some(hit => hit.kind === (powered ? 'super' : 'kick'));
      jumpedEarly ||= receiver.vy < 0 && state.ball.x < receiver.x - 100;
      received = released && state.impacts.some(hit =>
        ['super', 'body', 'kick'].includes(hit.kind) && Math.abs(hit.x - receiver.x) < 100);
    }
    assert.ok(released, 'the pass connects');
    if (powered) assert.ok(jumpedEarly, 'receiver takes off before the ball arrives');
    assert.ok(received, 'the teammate meets the moving ball');
  });
}
