const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const tuning = require('../src/shared/movementPhysics.json');

// Exercise the actual local movement block with a minimal Phaser body.
const source = fs.readFileSync(require.resolve('../src/player.js'), 'utf8');
const slideBlock = source.slice(source.indexOf('  const wallAttachNow ='), source.indexOf('  const wallSlideSpeedRatio ='));
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
  vm.runInNewContext(slideBlock + '\nresult = isWallSliding;', context);
  return context;
}
test('neutral contact attaches and caps descent; holding up brakes further', () => {
  const normal = localSlide();
  assert.equal(normal.result, true);
  assert.equal(normal.player.body.velocity.x, tuning.wallSlideAttachSpeed);
  assert.equal(normal.player.body.velocity.y, 120);
  const brake = localSlide({ wallSide: 'left', wallBrakeHeld: true });
  assert.equal(brake.player.body.velocity.x, -tuning.wallSlideAttachSpeed);
  assert.equal(brake.player.body.velocity.y, 75);
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

const contactBlock = source.slice(source.indexOf('  const touchingLeftNow ='), source.indexOf('  const nowTs = Date.now();', source.indexOf('  const touchingLeftNow =')));
function contact({ side = 'right', upPress = false, spacePress = false, away = false, gap = 8, solid = true } = {}) {
  const player = { body: { x: 100, y: 100, width: 30, height: 50,
    touching: {}, blocked: {}, velocity: { x: side === 'right' ? 200 : -200, y: -180 } } };
  const context = { player, scene: { _mapObjects: [{ body: {
    x: side === 'right' ? 130 + gap : 80 - gap, y: 80, width: 20, height: 200,
    checkCollision: { left: solid, right: solid },
  } }] }, wallSlideVerticalPadding: 6, wallSlideSnapDistance: tuning.wallSlideSnapDistance,
    wallJumpHorizontalGracePx: tuning.wallJumpHorizontalGracePx, wallJumpPressBufferMs: 120,
    wallContactGraceMs: tuning.wallContactGraceMs, wallSlideReentryDelayMs: tuning.wallSlideReentryDelayMs,
    cursors: { up: { isDown: upPress } }, keyW: { isDown: false },
    leftKey: away && side === 'right', rightKey: away && side === 'left',
    directionalUpFreshPress: upPress, jumpButtonFreshPress: spacePress, upKeyFreshPress: false };
  vm.runInNewContext(contactBlock + '\nresult = { wallSide, wallSlideContact, effectiveWallSide, bufferedJumpPressActive, wallSlideSuppressed, wallBrakeHeld };', context);
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

test('wall jumps require current proximity within 12 pixels, even after recent contact', () => {
  for (const side of ['left', 'right']) {
    assert.equal(contact({ side, gap: 12, spacePress: true }).result.effectiveWallSide, side);
    for (const gap of [13, 24, 40]) {
      const state = contact({ side, gap, spacePress: true });
      state.player._lastWallSide = side;
      state.player._lastWallContactTs = Date.now();
      const next = { ...state };
      vm.runInNewContext(contactBlock + '\nresult = effectiveWallSide;', next);
      assert.equal(next.result, null);
    }
  }
});
