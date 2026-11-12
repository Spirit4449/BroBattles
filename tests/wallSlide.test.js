const test = require('node:test');
const assert = require('node:assert/strict');
const tuning = require('../src/shared/physics/movementPhysics.json');
const {
  resolveWallContact,
  applyWallSlide,
  resolveWallSlideFlipX,
} = require('../src/client/game/players/wallMovement');
const { stepBody } = require('../src/server/core/bots/physics');

function localSlide(overrides = {}) {
  const player = {
    _wallAttachSide: overrides.wallSide || "right", _wallAttachStartedAt: 0,
    body: { touching: { down: false }, velocity: { x: 0, y: 250 } },
    setAccelerationX(x) { this.ax = x; },
    setVelocityX(x) { this.body.velocity.x = x; },
    setVelocityY(y) { this.body.velocity.y = y; },
  };
  const context = { player, dead: false, movementLocked: false, wallSlideContact: true,
    wallSide: 'right', wallBrakeHeld: false, wallSlideMaxFallSpeed: tuning.wallSlideMaxFallSpeed,
    MOVEMENT_PHYSICS: tuning, ...overrides };
  context.result = applyWallSlide(context.player, context, overrides.Date?.now?.() ?? Date.now());
  return context;
}
test('neutral contact attaches and caps descent; holding up brakes further', () => {
  const normal = localSlide();
  assert.equal(normal.result, true);
  assert.equal(normal.player.body.velocity.x, 0);
  assert.equal(normal.player.body.velocity.y, 120);
  const brake = localSlide({ wallSide: 'left', wallBrakeHeld: true });
  assert.equal(brake.player.body.velocity.x, 0);
  assert.equal(brake.player.body.velocity.y, 75);
});

test('wall-slide pose follows the collision side instead of stale facing', () => {
  assert.equal(resolveWallSlideFlipX('left', -180, false), true);
  assert.equal(resolveWallSlideFlipX('right', 180, true), false);
  assert.equal(resolveWallSlideFlipX(null, -180, false), true);
  assert.equal(resolveWallSlideFlipX(null, 180, true), false);
  assert.equal(resolveWallSlideFlipX(null, 0, true), true);
});
test('no attachment away from walls or during ability locks; jumping suppression is read immediately', () => {
  assert.equal(localSlide({ wallSlideContact: false }).result, false);
  assert.equal(localSlide({ movementLocked: true }).result, false);
  const state = localSlide();
  state.player._wallSlideSuppressedUntil = Date.now() + 1000;
  assert.equal(localSlide({ player: state.player }).result, false);
  state.player._wallSlideSuppressedUntil = 0;
  state.player._wallAttachSide = "right";
  state.player._wallAttachStartedAt = 0;
  state.player.body.velocity.y = -100;
  const rising = localSlide({ player: state.player });
  assert.equal(rising.result, true);
  assert.equal(rising.player.body.velocity.y, -100);
  assert.equal(rising.player._jumpLaunch, undefined);
});

function contact({ side = 'right', upPress = false, spacePress = false, away = false, gap = tuning.wallSlideSnapDistance, solid = true } = {}) {
  const player = { body: { x: 100, y: 100, width: 30, height: 50,
    touching: {}, blocked: {}, velocity: { x: side === 'right' ? 200 : -200, y: -180 } } };
  const context = { player, scene: { _mapObjects: [{ body: {
    x: side === 'right' ? 130 + gap : 80 - gap, y: 80, width: 20, height: 200,
    checkCollision: { left: solid, right: solid },
  } }] }, wallSlideVerticalPadding: 6, wallSlideSnapDistance: tuning.wallSlideSnapDistance,
    wallJumpHorizontalGracePx: tuning.wallJumpHorizontalGracePx, wallJumpPressBufferMs: 120,
    wallSlideReentryDelayMs: tuning.wallSlideReentryDelayMs,
    cursors: { up: { isDown: upPress } }, keyW: { isDown: false },
    leftKey: away && side === 'right', rightKey: away && side === 'left',
    directionalUpFreshPress: upPress, jumpButtonFreshPress: spacePress, upKeyFreshPress: false };
  context.result = resolveWallContact(player, context.scene._mapObjects, {
    left: context.leftKey, right: context.rightKey,
    upHeld: upPress, jumpPressed: upPress || spacePress,
  });
  return context;
}
test('momentum near either wall attaches while rising with no held direction or collision flags', () => {
  for (const side of ['left', 'right']) {
    const state = contact({ side });
    assert.equal(state.result.wallSide, side);
    const sliding = localSlide({ player: Object.assign(state.player, {
      _wallAttachSide: side, _wallAttachStartedAt: 0,
      setAccelerationX(x) { this.ax = x; },
      setVelocityX(x) { this.body.velocity.x = x; },
      setVelocityY(y) { this.body.velocity.y = y; },
    }), wallSlideContact: state.result.wallSlideContact, wallSide: side });
    assert.equal(sliding.result, true);
    assert.equal(sliding.player.body.velocity.y, -180);
    assert.equal(Math.sign(sliding.player.body.velocity.x), side === 'left' ? -1 : 1);
  }
});
test('Up and Space both buffer a wall jump; moving away suppresses attachment', () => {
  for (const input of [{ upPress: true }, { spacePress: true }]) {
    const state = contact(input);
    assert.equal(state.result.bufferedJumpPressActive, true);
    assert.equal(state.result.effectiveWallSide, 'right');
  }
  assert.equal(contact({ away: true }).result.wallSlideSuppressed, true);
  assert.equal(contact({ gap: 50 }).result.wallSlideContact, false);
  assert.equal(contact({ solid: false }).result.wallSlideContact, false);
});


test('wall braking preserves ascent and jump ramp, then limits descent after the apex', () => {
  for (const wallBrakeHeld of [false, true]) {
    const { player } = localSlide();
    const launch = { startedAt: Date.now(), vy: -390 };
    player._jumpLaunch = launch;
    player.body.velocity.y = -240;
    localSlide({ player, wallBrakeHeld });
    assert.equal(player.body.velocity.y, -240);
    assert.equal(player._jumpLaunch, launch);
    player.body.velocity.y = 0;
    localSlide({ player, wallBrakeHeld });
    assert.equal(player.body.velocity.y, 0);
    // Arriving on the wall already falling (no apex ramp in progress).
    player._wallRiseDragAt = null;
    player.body.velocity.y = 200;
    localSlide({ player, wallBrakeHeld });
    assert.equal(player.body.velocity.y, wallBrakeHeld ? 75 : 120);
  }
});

test('brief edge contact never drags; sustained contact attaches after 50 ms', () => {
  const { player } = localSlide();
  player._wallAttachSide = null;
  player.body.velocity = { x: 180, y: 240 };
  let now = 1000;
  const tick = (overrides = {}) => localSlide({ player, Date: { now: () => now }, ...overrides });
  assert.equal(tick().result, false);
  now += 49;
  assert.equal(tick().result, false);
  assert.equal(player.body.velocity.x, 180);
  assert.equal(player.body.velocity.y, 240);
  tick({ wallSlideContact: false });
  now += 1;
  assert.equal(tick().result, false);
  now += 50;
  assert.equal(tick().result, true);
  assert.equal(player.body.velocity.y, 120);
  assert.equal(tick({ wallSide: 'left' }).result, false);
});

const REACH = tuning.wallSlideSnapDistance + tuning.wallJumpHorizontalGracePx;
test('wall jumps require current proximity within snap + grace reach, even after recent contact', () => {
  for (const side of ['left', 'right']) {
    assert.equal(contact({ side, gap: REACH, spacePress: true }).result.effectiveWallSide, side);
    for (const gap of [REACH + 1, 24, 40]) {
      const state = contact({ side, gap, spacePress: true });
      state.player._lastWallSide = side;
      state.player._lastWallContactTs = Date.now();
      const next = { ...state };
      next.result = resolveWallContact(next.player, next.scene._mapObjects, {
        left: next.leftKey, right: next.rightKey,
        jumpPressed: next.jumpButtonFreshPress,
      }).effectiveWallSide;
      assert.equal(next.result, null);
    }
  }
});

test('wall slide never overrides sideways momentum or steering acceleration', () => {
 const state=localSlide();state.player.body.velocity.x=-200;state.player.ax=-3000;
 localSlide({player:state.player});
 assert.equal(state.player.body.velocity.x,-200);assert.equal(state.player.ax,-3000);
});

// A body beside a face, in the air, `height` px of face above the ground below it.
function besideFace({ side = 'right', height, touching = false, otherSide = null }) {
  const groundTop = 300, faceTop = groundTop - height;
  const player = { body: { x: 100, y: groundTop - 70, width: 30, height: 50,
    touching: touching ? { [side]: true } : {}, blocked: {}, velocity: { x: 0, y: 100 } } };
  const face = (faceSide) => ({ body: { x: faceSide === 'right' ? 134 : 56, y: faceTop, width: 40, height: 400 } });
  const objects = [face(side), { body: { x: 0, y: groundTop, width: 300, height: 50 } }];
  if (otherSide) objects.push({ body: { x: otherSide === 'right' ? 134 : 56, y: -500, width: 40, height: 1000 } });
  return { player, result: resolveWallContact(player, objects, { jumpPressed: true }) };
}

test('a step is neither slid on nor kicked off', () => {
  const height = tuning.wallMinFaceHeight - 1;
  for (const side of ['left', 'right']) for (const touching of [false, true]) {
    const { result } = besideFace({ side, height, touching });
    assert.equal(result.effectiveWallSide, null);
    assert.equal(result.wallSlideContact, false);
    assert.equal(result.wallSide, null);
  }
});

test('a face at the minimum height, a real wall opposite a step, and untracked walls all kick', () => {
  const height = tuning.wallMinFaceHeight;
  for (const side of ['left', 'right']) {
    assert.equal(besideFace({ side, height }).result.effectiveWallSide, side);
  }
  const short = tuning.wallMinFaceHeight - 1;
  assert.equal(besideFace({ side: 'right', height: short, otherSide: 'left' }).result.effectiveWallSide, 'left');
  const player = { body: { x: 100, y: 100, width: 30, height: 50, touching: { left: true }, blocked: {}, velocity: { x: 0, y: 0 } } };
  assert.equal(resolveWallContact(player, [], { jumpPressed: true }).effectiveWallSide, 'left');
});

test('bots follow the same rule: no slide or kick on a step, both on a wall', () => {
  const rect = (id, left, right, top, bottom) => ({ id, left, right, top, bottom, collision: { up: true, down: true, left: true, right: true } });
  const run = (height) => {
    const groundTop = 1000;
    const geometry = { world: { x: 0, y: 0, width: 2000, height: 2000 }, colliders: [
      rect('ground', 0, 2000, groundTop, 1100), rect('face', 500, 900, groundTop - height, 1100)] };
    const p = { char_class: 'ninja', x: 480, y: groundTop - height - 20, vx: 260, vy: 0, grounded: false, isAlive: true };
    let now = 1000, events = [];
    for (let i = 0; i < 40 && !p.wallSide; i++, now += 1000 / 60) stepBody(p, { direction: 1 }, geometry, 1000 / 60, now);
    assert.ok(p.wallSide, 'reached the face');
    p.grounded = false; p._lastGroundTime = -Infinity; p.y += 30;
    const falling = { ...p, vy: 400 };
    stepBody(falling, { direction: 1 }, geometry, 1000 / 60, now);
    events = stepBody(p, { direction: 1, jumpPressed: true }, geometry, 1000 / 60, now).events;
    return { events, fallSpeed: falling.vy };
  };
  const wall = run(tuning.wallMinFaceHeight + 200), step = run(tuning.wallMinFaceHeight - 1);
  assert.ok(wall.events.includes('wall-jump'));
  assert.equal(wall.fallSpeed, tuning.wallSlideMaxFallSpeed);
  assert.ok(!step.events.includes('wall-jump'));
  assert.ok(step.fallSpeed > 400);
});

test('jumping straight up beside a wall never starts a slide; jumping into it still does', () => {
  for (const side of ['left', 'right']) {
    const toward = side === 'left' ? -1 : 1;
    let now = 1000;
    const { player } = localSlide({ wallSide: side, wallSlideContact: false });
    const tick = (overrides = {}) => applyWallSlide(player, {
      dead: false, movementLocked: false, wallSlideContact: true, wallSide: side,
      wallBrakeHeld: false, ...overrides }, now);
    player.body.velocity = { x: 0, y: -300 };
    assert.equal(tick(), false);
    now += 200;
    assert.equal(tick(), false, 'neutral rise stays detached');
    assert.equal(tick({ drivingIntoWall: true }), false);
    now += 60;
    assert.equal(tick({ drivingIntoWall: true }), true, 'held input into the wall attaches while rising');
    assert.equal(tick(), true, 'an attach under way holds after releasing');

    const momentum = localSlide({ wallSide: side, wallSlideContact: false }).player;
    momentum.body.velocity = { x: 200 * toward, y: -300 };
    assert.equal(applyWallSlide(momentum, { wallSlideContact: true, wallSide: side }, 0), false);
    momentum.body.velocity.x = 0;
    assert.equal(applyWallSlide(momentum, { wallSlideContact: true, wallSide: side }, 60), true,
      'momentum into the wall attaches even after collision zeroes it');
  }
  const falling = localSlide({ wallSlideContact: false }).player;
  falling.body.velocity = { x: 0, y: 200 };
  applyWallSlide(falling, { wallSlideContact: true, wallSide: 'right' }, 0);
  assert.equal(applyWallSlide(falling, { wallSlideContact: true, wallSide: 'right' }, 60), true);
});

test('wall contact reports held input toward the wall', () => {
  const run = (side, left, right) => resolveWallContact(
    { body: { x: 100, y: 100, width: 30, height: 50, touching: {}, blocked: { [side]: true }, velocity: { x: 0, y: -100 } } },
    [], { left, right }, 0).drivingIntoWall;
  assert.equal(run('right', false, true), true);
  assert.equal(run('right', false, false), false);
  assert.equal(run('right', true, false), false);
  assert.equal(run('left', true, false), true);
});

test('rising while wall-sliding bleeds upward speed each frame, but not during the jump ramp', () => {
  const { player } = localSlide();
  player.body.velocity.y = -300;
  let now = 1000;
  const tick = () => localSlide({ player, Date: { now: () => now } });
  tick();
  assert.equal(player.body.velocity.y, -300);
  now += 16;
  tick();
  const afterOneFrame = player.body.velocity.y;
  assert.ok(afterOneFrame > -300 && afterOneFrame < 0);
  for (let i = 0; i < 60; i++) { now += 16; tick(); }
  assert.equal(player.body.velocity.y, 0, 'drag stops at the apex instead of pushing down');

  // Gravity would snap the slide to full speed; the descent ramps in gently.
  now += 16;
  player.body.velocity.y = 990 * 0.016;
  tick();
  const firstFall = player.body.velocity.y;
  assert.ok(firstFall > 0 && firstFall < 990 * 0.016);
  for (let i = 0; i < 3; i++) { now += 16; player.body.velocity.y += 990 * 0.016; tick(); }
  assert.ok(player.body.velocity.y < tuning.wallSlideMaxFallSpeed);
  for (let i = 0; i < 60; i++) { now += 16; player.body.velocity.y += 990 * 0.016; tick(); }
  assert.equal(player.body.velocity.y, tuning.wallSlideMaxFallSpeed);

  player.body.velocity.y = -300;
  player._jumpLaunch = { startedAt: now, vy: -300 };
  now += 16;
  tick();
  assert.equal(player.body.velocity.y, -300);
});
