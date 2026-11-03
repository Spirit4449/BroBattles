import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COIN_SPIN_FRAMES,
  coinSpinFrame,
  crateStage,
  crateShake,
  createCrateSpring,
  homingPoint,
  kickCrate,
  settleCoinSpin,
  stepCrateSpring,
  stepLooseCoin,
} from '../src/client/game/modes/bankBust/coinMotion.mjs';

const STEP = 1 / 60;

test('a thrown coin rises, falls, bounces lower each time and comes to rest on its floor', () => {
  const coin = { x: 0, y: 100, vx: 80, vy: -400, floorY: 100 };
  const peaks = [];
  let peak = Infinity;
  for (let i = 0; i < 600 && !coin.resting; i++) {
    peak = Math.min(peak, coin.y);
    if (stepLooseCoin(coin, STEP)) {
      peaks.push(peak);
      peak = Infinity;
    }
    assert.ok(coin.y <= 100, 'never through the floor');
  }
  assert.equal(coin.resting, true);
  assert.ok(peaks.length >= 2, 'it bounces');
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] > peaks[i - 1], 'each bounce is lower');
  const x = coin.x;
  stepLooseCoin(coin, STEP);
  assert.equal(coin.x, x, 'a resting coin stays put');
});

test('a coin past the edge of its floor falls away instead of landing on air', () => {
  const coin = { x: 110, y: 90, vx: 0, vy: 0, floorY: 100, floorLeft: -100, floorRight: 100 };
  for (let i = 0; i < 60; i++) stepLooseCoin(coin, STEP);
  assert.ok(coin.y > 100);
  assert.notEqual(coin.resting, true);
});

test('a homing coin starts where it was, ends on the target and gathers speed', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 500, y: -200 };
  const bow = { x: 60, y: -40 };
  assert.deepEqual(homingPoint(from, bow, to, 0), from);
  assert.deepEqual(homingPoint(from, bow, to, 1), to);
  assert.deepEqual(homingPoint(from, bow, to, 7), to, 'late frames do not overshoot');
  const speedAt = (t) => {
    const a = homingPoint(from, bow, to, t);
    const b = homingPoint(from, bow, to, t + 0.01);
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  assert.ok(speedAt(0.8) > speedAt(0.1));
});

test('the spin always lands on a real frame, in either direction', () => {
  for (const value of [0, 3.9, 8, 100.5, -0.5, -9, -100]) {
    const frame = coinSpinFrame(value);
    assert.ok(Number.isInteger(frame) && frame >= 0 && frame < COIN_SPIN_FRAMES, `${value} -> ${frame}`);
  }
});

test('a coin at rest turns until it faces front, then stays there', () => {
  for (const start of [1, 2.5, 3, 6.2, -1.5]) {
    let spin = start;
    for (let i = 0; i < 120; i++) spin = settleCoinSpin(spin, STEP);
    assert.equal(coinSpinFrame(spin) % (COIN_SPIN_FRAMES / 2), 0, `from ${start}`);
    assert.equal(settleCoinSpin(spin, STEP), spin);
  }
});

test('a hit rattles the crate away from the attacker, and it settles fast', () => {
  const spring = createCrateSpring();
  kickCrate(spring, 1);
  assert.ok(crateShake(spring).x > 0, 'jolts the way it was pushed');
  assert.ok(spring.squashSpeed < 0, 'and flattens');

  const other = createCrateSpring();
  kickCrate(other, -1);
  assert.ok(crateShake(other).x < 0);

  // A quick back-and-forth rattle, not one slow sway.
  let flips = 0;
  let last = Math.sign(crateShake(spring).x);
  for (let t = 0; t < 0.15; t += STEP / 4) {
    stepCrateSpring(spring, STEP / 4);
    const sign = Math.sign(crateShake(spring).x);
    if (sign && sign !== last) { flips++; last = sign; }
  }
  assert.ok(flips >= 4, `rattles (${flips} flips)`);
  for (let i = 0; i < 60; i++) stepCrateSpring(spring, STEP);
  assert.ok(Math.abs(crateShake(spring).x) < 1e-9, "and stops dead");
  assert.ok(Math.abs(spring.squash) < 0.002);
});

test('a slow frame or a pile of hits cannot throw the crate over', () => {
  const spring = createCrateSpring();
  for (let i = 0; i < 12; i++) kickCrate(spring, 1, 1.5);
  let widest = 0;
  for (let i = 0; i < 40; i++) {
    stepCrateSpring(spring, 0.05);
    const { x, tilt } = crateShake(spring);
    widest = Math.max(widest, Math.abs(x));
    assert.ok(Number.isFinite(x) && Number.isFinite(spring.squash));
    assert.ok(Math.abs(tilt) < 0.1);
  }
  assert.ok(widest < 20, 'stays on its plinth');
});

test('the crate falls apart in order as it loses health', () => {
  assert.equal(crateStage(1), 'intact');
  assert.equal(crateStage(0.01), 'broken');
  const order = ['intact', 'damaged', 'broken'];
  let last = 0;
  for (let ratio = 1; ratio >= 0; ratio -= 0.05) {
    const index = order.indexOf(crateStage(ratio));
    assert.ok(index >= last);
    last = index;
  }
  assert.equal(last, 2);
});
