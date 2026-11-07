const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe("Attack contact and launch", () => {
  const { test, describe } = require('node:test');


  describe("Delivery policies and contact shapes", () => {
    const { DELIVERIES, deliveryOf, clampDeliveryRewind, attackerPose, attachedRectShape, pathSweepShapes,
      shapeTouches } = require('../src/shared/combat/attackDelivery');
    const { ATTACK_RUNTIMES, createRuntimeAttack, tickRuntimeAttack } = require('../src/server/core/gameRoom/characterAttackRegistry');
    const { getResolvedAttackDescriptor } = require('../src/server/core/gameRoom/attackDescriptorResolver');
    const { attackDescriptors } = require('../src/shared/characters');
    const { getResolvedCharacterAttackConfig } = require('../src/shared/characters/characterTuning');
    const { updateBodyGeometry } = require('../src/server/core/gameRoom/inputManager');
    const { damageHitboxSnapshot } = require('../src/server/core/gameRoom/damageHitboxes');
    const { HIT_STALENESS_MAX_MS } = require('../src/server/core/gameRoomConfig');

    test('every attack runtime and every attack belongs to a delivery with a bounded rewind', () => {
      for (const kind of Object.keys(ATTACK_RUNTIMES)) assert.ok(deliveryOf(kind), `${kind} has a delivery`);
      for (const type of Object.keys(attackDescriptors)) {
        const kind = getResolvedAttackDescriptor(type)?.runtime?.kind;
        if (kind) assert.ok(deliveryOf(kind), `${type} (${kind}) has a delivery`);
      }
      // No delivery rewinds further than the server keeps a claimed view.
      for (const [name, policy] of Object.entries(DELIVERIES)) {
        assert.ok(policy.rewindCapMs <= HIT_STALENESS_MAX_MS, name);
        assert.equal(clampDeliveryRewind(name, 1e9), policy.rewindCapMs);
        assert.equal(clampDeliveryRewind(name, -5), 0);
        assert.equal(clampDeliveryRewind(name, 'x'), 0);
      }
      assert.ok(DELIVERIES.attached.rewindCapMs < DELIVERIES.released.rewindCapMs, 'a dodge counts sooner against melee');
      assert.equal(DELIVERIES.area.rewindCapMs, 0, 'warned areas favor the target');
    });

    // The server's attached runtime and the attacker's client must test the same
    // volume at the same moment of the attack, or a drawn hit becomes a miss.
    function serverShapes(type, character, elapsedTimes, { flip = false } = {}) {
      const player = { name: 'A', socketId: 'a', char_class: character, x: 500, y: 300, flip, isAlive: true,
        loaded: true, team: 'team1', effects: {} };
      updateBodyGeometry(player, { geometry: { colliders: [] } });
      const room = { matchData: { editorDebugHitboxes: true }, players: new Map([['a', player]]) };
      const now = 1_000_000;
      const attack = createRuntimeAttack(player, { type, id: type, direction: flip ? -1 : 1 }, now);
      return { player, shapes: elapsedTimes.map((elapsed) => {
        room._damageHitboxes?.clear();
        tickRuntimeAttack(room, attack, now + elapsed);
        return damageHitboxSnapshot(room, now + elapsed)?.[0] || null;
      }) };
    }

    const close = (a, b) => Math.abs(a - b) < 1e-6;

    test('Draven: the client predicts with the server splash volume at every moment of the attack', () => {
      const splash = getResolvedCharacterAttackConfig('draven', 'splash');
      const times = [0, splash.damageStartMs, splash.growDurationMs / 2, splash.growDurationMs, splash.activeWindowMs - 1];
      for (const flip of [false, true]) {
        const { player, shapes } = serverShapes('draven-splash', 'draven', times, { flip });
        times.forEach((elapsed, i) => {
          const [client] = attachedRectShape(attackerPose('draven', player.x, player.y, { flip }), splash, elapsed);
          if (!shapes[i]) { assert.equal(client, undefined, `nothing before damage starts (${elapsed} ms)`); return; }
          for (const edge of ['left', 'right', 'top', 'bottom']) {
            assert.ok(close(client[edge], shapes[i][edge]), `${edge} at ${elapsed} ms, flip ${flip}`);
          }
        });
      }
    });

    test('Thorg: the client predicts with the server sweep capsules at every moment of the attack', () => {
      const sweep = getResolvedCharacterAttackConfig('thorg', 'sweep');
      const times = [sweep.windupMs + 1, sweep.windupMs + sweep.strikeMs / 3, sweep.windupMs + sweep.strikeMs];
      for (const flip of [false, true]) {
        const direction = flip ? -1 : 1;
        const { player, shapes } = serverShapes('thorg-fall', 'thorg', times, { flip });
        let previous = 0;
        times.forEach((elapsed, i) => {
          const progress = Math.min(1, (elapsed - sweep.windupMs) / sweep.strikeMs);
          const client = pathSweepShapes(attackerPose('thorg', player.x, player.y, { flip }), direction, previous, progress).at(-1);
          previous = progress;
          for (const key of ['a', 'b']) {
            assert.ok(close(client[key].x, shapes[i][key].x) && close(client[key].y, shapes[i][key].y), `${key} at ${elapsed} ms`);
          }
          assert.ok(close(client.radius, shapes[i].radius));
        });
      }
    });

    test('shape contact covers rects, capsules and sectors against a box', () => {
      const box = { left: 100, right: 140, top: 0, bottom: 100 };
      assert.ok(shapeTouches({ kind: 'rect', left: 130, right: 200, top: 50, bottom: 60 }, box));
      assert.ok(!shapeTouches({ kind: 'rect', left: 141, right: 200, top: 50, bottom: 60 }, box));
      assert.ok(shapeTouches({ kind: 'capsule', a: { x: 0, y: 50 }, b: { x: 95, y: 50 }, radius: 6 }, box));
      assert.ok(!shapeTouches({ kind: 'capsule', a: { x: 0, y: 50 }, b: { x: 90, y: 50 }, radius: 6 }, box));
      const sector = { kind: 'sector', x: 0, y: 50, radius: 100, innerRadius: 0, angle: 0, halfSpread: Math.PI / 6 };
      assert.ok(!shapeTouches(sector, box), 'centre beyond the radius');
      assert.ok(shapeTouches(sector, box, { reach: 24 }), 'reach widens a sector');
      assert.ok(!shapeTouches({ ...sector, angle: Math.PI }, box, { reach: 24 }), 'behind the sector');
    });
  });

  describe("Projectile launch curves", () => {
    const { launchTravel, launchLagMs, launchDurationMs } = require('../src/shared/combat/launchRamp');
    const { getResolvedCharacterAttackConfig } = require('../src/shared/characters/characterTuning');

    const fireball = getResolvedCharacterAttackConfig('wizard', 'fireball');

    test('an eased launch starts slow, speeds up without jumps, then holds full speed', () => {
      const cfg = { speed: 400, launchEaseMs: 200, launchStartSpeed: 0.25 };
      const speedAt = ms => (launchTravel(ms + 1, cfg) - launchTravel(ms, cfg)) * 1000;
      assert.ok(Math.abs(speedAt(0) - 100) < 2, 'leaves at the start fraction');
      let last = speedAt(0);
      for (let ms = 0; ms <= 400; ms += 5) {
        const speed = speedAt(ms);
        assert.ok(speed >= last - 1e-6, `never slows down at ${ms} ms`);
        assert.ok(speed - last < 15, `no sudden kick at ${ms} ms`);
        last = speed;
      }
      assert.ok(Math.abs(speedAt(300) - 400) < 1e-6);
      // Once at speed it runs a fixed lag behind a constant-speed shot.
      assert.ok(Math.abs(launchTravel(600, cfg) - 400 * (0.6 - launchLagMs(cfg) / 1000)) < 1e-6);
    });

    test('without an ease the curve is constant speed', () => {
      const cfg = { speed: 450 };
      assert.equal(launchTravel(1000, cfg), 450);
      assert.equal(launchLagMs(cfg), 0);
      assert.equal(launchDurationMs(900, cfg), 2000);
    });

    test('the launch duration covers exactly the range, inside or past the ease', () => {
      const cfg = { speed: 450, launchEaseMs: 280, launchStartSpeed: 0.28 };
      for (const range of [20, 80, 1050]) {
        assert.ok(Math.abs(launchTravel(launchDurationMs(range, cfg), cfg) - range) < 1e-3, `range ${range}`);
      }
    });

    test('the server moves the fireball along the same curve the client draws', () => {
      assert.ok(fireball.launchEaseMs > 0 && fireball.launchStartSpeed < 1, 'wizard eases its launch');
      const { createRuntimeAttack, tickRuntimeAttack } = require('../src/server/core/gameRoom/characterAttackRegistry');
      const player = { name: 'A', socketId: 'a', x: 500, y: 300, isAlive: true, loaded: true, team: 'team1' };
      const room = { players: new Map([['a', player]]), FIXED_DT_MS: 1000 / 60,
        geometry: { world: { x: 0, y: 0, width: 4000, height: 1000 } } };
      const now = Date.now();
      const angle = -0.4;
      const attack = createRuntimeAttack(player, { type: 'wizard-fireball-release', id: 'f', angle }, now);
      const start = { x: attack.x, y: attack.y };
      let done = false, ticks = 0;
      while (!done && ticks < 400) {
        ticks++;
        done = tickRuntimeAttack(room, attack, now + ticks * room.FIXED_DT_MS);
        const expected = launchTravel(ticks * room.FIXED_DT_MS, fireball);
        assert.ok(Math.abs(Math.hypot(attack.x - start.x, attack.y - start.y) - expected) < 1e-6, `tick ${ticks}`);
      }
      assert.ok(done, 'the fireball ends at its range');
      assert.ok(Math.abs(ticks * room.FIXED_DT_MS - launchDurationMs(fireball.range, fireball)) <= room.FIXED_DT_MS,
        'the client flight duration matches the server lifetime');
    });
  });
});

describe("Arrow trajectory", () => {
  const model = require('../src/shared/characters/huntressProjectile');
  const { muzzleOf } = require('../src/shared/characters/characterRig');

  // Exercise the shared model used by both prediction and authoritative collision.
  test('normal and burning arrows launch from the same body socket', () => {
    const pose = { x: 100, y: 100, width: 150, height: 150 };
    for (const angle of [0, Math.PI, -Math.PI / 2]) {
      const shots = [false, true].map(special => model.createVolley(pose, model.resolveShot({ angle }, special), 'shot', 0));
      for (const volley of shots) {
        for (const p of volley) {
          // Both leave the bow muzzle in her rig (huntress.json rig.points).
          const direction = Math.atan2(p.vy, p.vx), cfg = model.attackConfig(p.special);
          const { pivot, reach } = muzzleOf('huntress', cfg.muzzle, pose);
          assert.ok(Math.abs(p.x - (pivot.x + Math.cos(direction) * reach)) < 1e-10);
          assert.ok(Math.abs(p.y - (pivot.y + Math.sin(direction) * reach)) < 1e-10);
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
});
