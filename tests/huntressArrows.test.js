const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/shared/huntressProjectile');

// Exercise the shared model used by both prediction and authoritative collision.
test('normal and burning arrows launch from the same body socket', () => {
  const pose = { x: 100, y: 100, width: 150, height: 150 };
  for (const angle of [0, Math.PI, -Math.PI / 2]) {
    const shots = [false, true].map(special => model.createVolley(pose, model.resolveShot({ angle }, special), 'shot', 0));
    for (const volley of shots) {
      for (const p of volley) {
        const direction = Math.atan2(p.vy, p.vx), cfg = model.attackConfig(p.special);
        assert.ok(Math.abs(p.x - (pose.x + Math.cos(direction) * pose.width * cfg.forwardOffset)) < 1e-10);
        assert.ok(Math.abs(p.y - (pose.y - pose.height * cfg.verticalOffset + Math.sin(direction) * pose.width * cfg.forwardOffset)) < 1e-10);
      }
    }
  }
});

test('swept contacts hit point-blank targets and targets crossed in one step', () => {
  for (const [from, to, bounds] of [
    [{ x: 100, y: 124 }, { x: 110, y: 124 }, { left: 95, right: 120, top: 110, bottom: 170 }],
    [{ x: 100, y: 124 }, { x: 220, y: 124 }, { left: 150, right: 170, top: 110, bottom: 170 }],
    [{ x: 100, y: 124 }, { x: 0, y: 124 }, { left: 40, right: 60, top: 110, bottom: 170 }],
  ]) {
    assert.equal(model.firstContact(from, to, 16, [], [{ name: 'enemy', bounds }]).target, 'enemy');
  }
});

test('terrain in front of a target wins the swept collision', () => {
  const from = { x: 100, y: 124 }, to = { x: 220, y: 124 };
  const terrain = [{ id: 'wall', left: 115, right: 120, top: 0, bottom: 300 }];
  const targets = [{ name: 'enemy', bounds: { left: 150, right: 170, top: 110, bottom: 170 } }];
  assert.equal(model.firstContact(from, to, 16, terrain, targets).reason, 'terrain');
});

test('arrows gain downward velocity and speed while falling', () => {
  const arrow = model.createVolley({ x: 100, y: 100, width: 150, height: 150 }, model.resolveShot({ angle: 0 }), 'shot', 0)[1];
  const first = model.sample(arrow, model.STEP_MS), second = model.sample(arrow, 2 * model.STEP_MS);
  assert.ok(second.vy > first.vy);
  assert.ok(Math.hypot(second.vx, second.vy) > Math.hypot(first.vx, first.vy));
});
