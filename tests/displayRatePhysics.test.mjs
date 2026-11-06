import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  MAX_PHYSICS_STEP_MS, physicsStepsForFrame, primeWorldForFrame, integrateLikeReferenceStep,
} from "../src/client/game/scene/displayRatePhysics.js";

const require = createRequire(import.meta.url);
const Body = require("phaser/src/physics/arcade/Body");
const World = require("phaser/src/physics/arcade/World");
const PhaserSet = require("phaser/src/structs/Set");
const Vector2 = require("phaser/src/math/Vector2");
const movement = require("../src/shared/physics/movementPhysics.json");

// Phaser's real Arcade World and Body, without a scene: one running body and
// the accumulator, stepping and write-back a game frame runs.
function createWorld(gravity = 0) {
  const world = Object.assign(Object.create(World.prototype), {
    gravity: new Vector2(0, gravity), OVERLAP_BIAS: 4, TILE_BIAS: 16, forceX: false,
    defaults: {}, useTree: false, isPaused: false, fixedStep: true, timeScale: 1,
    _elapsed: 0, stepsLastFrame: 0, drawDebug: false,
    bodies: new PhaserSet(), staticBodies: new PhaserSet(), pendingDestroy: new PhaserSet(),
    colliders: { update: () => [] },
    steps: [],
    emit(event, delta) { if (event === "worldstep") this.steps.push(delta); },
  });
  world.setFPS(60);
  const sprite = { x: 0, y: 0, displayWidth: 40, displayHeight: 80, scaleX: 1, scaleY: 1,
    displayOriginX: 20, displayOriginY: 40, angle: 0, rotation: 0 };
  sprite.body = new Body(world, sprite);
  sprite.body.setMaxVelocity(10000, 10000);
  world.bodies.set(sprite.body);
  return { world, sprite };
}

function frame(world, delta, prime = true) {
  if (prime) primeWorldForFrame(world, delta);
  world.steps.length = 0;
  world.update(0, delta);
  world.postUpdate();
  return world.steps.length;
}

test("a long frame splits into equal steps no longer than one 60 Hz step", () => {
  assert.deepEqual(physicsStepsForFrame(1000 / 120), { steps: 1, stepMs: 1000 / 120 });
  assert.equal(physicsStepsForFrame(1000 / 60).steps, 1);
  assert.equal(physicsStepsForFrame(1000 / 60 + 0.5).steps, 2);
  const hitch = physicsStepsForFrame(100);
  assert.equal(hitch.steps, 6);
  assert.ok(hitch.stepMs <= MAX_PHYSICS_STEP_MS);
  assert.equal(physicsStepsForFrame(0).steps, 0);
  assert.equal(physicsStepsForFrame(Number.NaN).steps, 0);
});

test("the world steps exactly as often as the frame needs, at any refresh rate", () => {
  for (const delta of [1000 / 240, 1000 / 144, 1000 / 120, 1000 / 75, 1000 / 60, 1000 / 50, 1000 / 30, 117.3, 400]) {
    const { world } = createWorld();
    const expected = physicsStepsForFrame(delta).steps;
    for (let i = 0; i < 200; i++) assert.equal(frame(world, delta), expected, `delta ${delta} frame ${i}`);
  }
});

test("a running fighter advances the same distance on every 120 Hz frame", () => {
  const speed = 360;
  // Unprimed, Arcade's fixed 60 Hz accumulator moves the body on alternate frames.
  const fixed = createWorld();
  fixed.sprite.body.velocity.set(speed, 0);
  const fixedMoves = [];
  for (let i = 0; i < 120; i++) {
    const before = fixed.sprite.x;
    frame(fixed.world, 1000 / 120, false);
    fixedMoves.push(fixed.sprite.x - before);
  }
  assert.ok(fixedMoves.filter((d) => d === 0).length >= 50, "baseline: half the frames hold still");

  const { world, sprite } = createWorld();
  sprite.body.velocity.set(speed, 0);
  for (let i = 0; i < 120; i++) {
    const before = sprite.x;
    frame(world, 1000 / 120);
    assert.ok(Math.abs(sprite.x - before - speed / 120) < 1e-6, `frame ${i} moved ${sprite.x - before}`);
  }
  // Total travel matches elapsed time, as with the fixed step.
  assert.ok(Math.abs(sprite.x - fixed.sprite.x) < 1e-6);
});

// A running jump with the game's tuning: launch, air acceleration and drag,
// then fast-fall gravity on the way down. Returns the body's path per 60 Hz
// instant (interpolated between frames) and its apex.
function runningJump(hz, { reference = true } = {}) {
  const { world, sprite } = createWorld(movement.gravity);
  const body = sprite.body;
  body.setMaxVelocity(movement.maxSpeed, movement.maxVerticalSpeed);
  if (reference) integrateLikeReferenceStep(body);
  body.velocity.set(movement.maxSpeed * 0.5, -movement.jumpSpeed * movement.jumpLaunchSpeedMult);
  body.acceleration.x = movement.airAccel;
  body.setDrag(movement.dragAir, 0);
  const dt = 1000 / hz;
  const samples = [{ t: 0, x: 0, y: 0 }];
  let apex = 0;
  for (let t = dt; t <= 900 + 1e-6; t += dt) {
    body.setGravityY(body.velocity.y > movement.fallGravityMinSpeed
      ? movement.gravity * (movement.fallGravityFactor - 1) : 0);
    frame(world, dt);
    samples.push({ t, x: sprite.x, y: sprite.y });
    apex = Math.min(apex, sprite.y);
  }
  const at = (t) => {
    const i = samples.findIndex((s) => s.t >= t - 1e-6);
    const a = samples[Math.max(0, i - 1)], b = samples[i];
    const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  };
  return { apex: -apex, at };
}

test("jumps and falls trace the 60 Hz path at any refresh rate", () => {
  const reference = runningJump(60, { reference: false });
  // A 60 Hz step is Arcade's own, unchanged.
  const sixty = runningJump(60);
  assert.equal(sixty.apex, reference.apex);
  for (const hz of [75, 120, 144, 165, 240]) {
    const plain = runningJump(hz, { reference: false });
    const matched = runningJump(hz);
    assert.ok(plain.apex - reference.apex > 0.5, `${hz} Hz baseline apex ${plain.apex} vs ${reference.apex}`);
    // Sampled at frame instants, so the peak itself can fall between frames.
    assert.ok(Math.abs(matched.apex - reference.apex) < 0.3, `${hz} Hz apex ${matched.apex} vs ${reference.apex}`);
    // Fast-fall gravity switches on at the first frame past the apex. Rates
    // that share 60 Hz frame instants switch together and match; others
    // switch up to a frame apart, which grows to a pixel or two by the end of
    // a long fall (the uncorrected step was off by up to 5.6 px). Reaching the
    // run-speed cap partway through a step leaves ~0.1 px horizontally.
    const tolerance = hz % 60 === 0 ? 0.15 : 2;
    for (let t = 50; t <= 850; t += 100) {
      const a = matched.at(t), b = reference.at(t);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < tolerance, `${hz} Hz at ${t} ms: ${a.y} vs ${b.y}`);
    }
  }
});
