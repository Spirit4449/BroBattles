import test from "node:test";
import assert from "node:assert/strict";
import { releaseMovementForFocus } from "../src/players/focusMomentum.mjs";

function movingPlayer(grounded = false) {
  const player = {
    _jumpLaunch: { vy: -500 },
    body: {
      touching: { down: grounded },
      blocked: { down: false },
      velocity: { x: 210, y: -340 },
      acceleration: { x: 1200, y: 40 },
      drag: { x: 0 },
    },
    setAccelerationX(value) { this.body.acceleration.x = value; },
    setDragX(value) { this.body.drag.x = value; },
  };
  return player;
}

test("switching focus preserves horizontal and vertical momentum in the air", () => {
  const player = movingPlayer(false);
  const grounded = releaseMovementForFocus(player, {
    dragGround: 1200,
    dragAir: 260,
  });
  assert.equal(grounded, false);
  assert.deepEqual(player.body.velocity, { x: 210, y: -340 });
  assert.deepEqual(player.body.acceleration, { x: 0, y: 40 });
  assert.equal(player.body.drag.x, 260);
  assert.equal(player._jumpLaunch, null);
});

test("ground drag resumes after focus loss without freezing knockback", () => {
  const player = movingPlayer(true);
  releaseMovementForFocus(player, { dragGround: 1200, dragAir: 260 });
  assert.equal(player.body.drag.x, 1200);
  assert.deepEqual(player.body.velocity, { x: 210, y: -340 });

  releaseMovementForFocus(player, {
    dragGround: 1200,
    dragAir: 260,
    shockwaveActive: true,
  });
  assert.equal(player.body.drag.x, 0);
  assert.deepEqual(player.body.velocity, { x: 210, y: -340 });
});
