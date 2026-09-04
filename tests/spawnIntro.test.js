const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const babel = require('@babel/core');

function harness() {
  const effects = [];
  const exported = {};
  const code = babel.transformSync(fs.readFileSync(require.resolve('../src/gameScene/spawnIntro.js'), 'utf8'), { babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }).code;
  vm.runInNewContext(code, { exports: exported, require: name => name.includes('characters') ? { resolveAnimKey: (_s, _c, key) => key } : { spawnSpawnBurst: () => effects.push('land'), spawnFastFallTrail: () => effects.push('trail') } });
  const scene = { events: new EventEmitter(), time: { now: 0 }, _mapObjects: [], physics: { add: { collider: () => ({ destroy() { this.destroyed = true; } }) } }, add: { image: () => ({ setOrigin() { return this; }, setDisplaySize() { return this; }, setDepth() { return this; }, setPosition() { return this; }, setAngle() { return this; }, destroy() { this.destroyed = true; } }) } };
  const sprite = { active: true, username: 'player', x: 100, y: 200, depth: 20, _spawnLanding: { x: 100, y: 200, dropHeight: 180 }, anims: { play(key) { this.key = key; } }, setVelocity(x, y) { this.body.velocity = { x, y }; } };
  sprite.body = { allowGravity: false, moves: true, maxVelocity: { x: 900, y: 900 }, velocity: { x: 0, y: 0 }, blocked: {}, touching: {}, center: { x: 100 }, top: 150, left: 80, right: 120, reset(x, y) { sprite.x = x; sprite.y = y; this.top = y - 50; this.velocity = { x: 0, y: 0 }; }, updateFromGameObject() {}, setMaxVelocity(x, y) { this.maxVelocity = { x, y }; } };
  return { scene, sprite, effects, ...exported };
}

test('intro enables gravity, plays falling, lands once, and never resets at fight', () => {
  const h = harness(), { scene, sprite } = h;
  h.prepareSpawnIntro(scene, sprite, 'ninja', '', true);
  assert.equal(sprite.body.moves, false);
  h.startSpawnIntro(scene, { player: { x: 110, y: 210 } });
  assert.equal(sprite.y, 30);
  assert.equal(sprite.body.allowGravity, true);
  assert.equal(sprite.body.maxVelocity.y, 88);
  scene.events.emit('postupdate');
  assert.equal(sprite.anims.key, 'falling');
  sprite.y = 212; // Physics collision owns the actual settled position.
  sprite.body.blocked.down = true;
  scene.events.emit('postupdate');
  scene.events.emit('postupdate');
  assert.deepEqual(h.effects, ['land']);
  h.finishSpawnIntro(scene);
  assert.equal(sprite.y, 212, 'fight does not teleport');
  assert.equal(sprite.body.allowGravity, false, 'remote interpolation regains ownership');
  assert.equal(sprite.body.maxVelocity.y, 900);
  assert.equal(scene.events.listenerCount('postupdate'), 0);
});

test('low ceiling shortens drop and scene shutdown releases resources', () => {
  const h = harness();
  h.scene._mapObjects = [{ body: { enable: true, checkCollision: { up: true }, left: 0, right: 200, bottom: 140 } }];
  h.prepareSpawnIntro(h.scene, h.sprite, 'ninja', '');
  h.startSpawnIntro(h.scene);
  assert.equal(h.sprite.y, 194);
  h.scene.events.emit('shutdown');
  assert.equal(h.sprite.body.moves, true);
  assert.equal(h.scene.events.listenerCount('postupdate'), 0);
});

test('canopies use friendly/enemy colors with smaller, proportional sizing', () => {
  for (const friendly of [true, false]) {
    const h = harness();
    let texture, width, height;
    const create = h.scene.add.image;
    h.scene.add.image = (x, y, key) => {
      texture = key;
      const image = create();
      image.setDisplaySize = (w, v) => { width = w; height = v; return image; };
      return image;
    };
    h.prepareSpawnIntro(h.scene, h.sprite, 'ninja', '', true, friendly);
    h.startSpawnIntro(h.scene);
    assert.equal(texture, friendly ? 'spawn-parachute-blue' : 'spawn-parachute-red');
    assert.equal(height, 89);
    assert.ok(width < 94);
    h.finishSpawnIntro(h.scene);
  }
});

test('echo grows subtly with roster size, stays bounded, and stops on landing/shutdown', () => {
  const h = harness();
  const small = h.parachuteSoundLayers(2), large = h.parachuteSoundLayers(6);
  assert.equal(small.length, 2);
  assert.equal(large.length, 4);
  assert.ok(large[1].volume > small[1].volume);
  assert.ok(large.reduce((sum, layer) => sum + layer.volume, 0) < 0.27);
  assert.ok(large[3].delay < 0.5);
  assert.ok(large.every(layer => layer.loop === false && layer.rate === 1), 'opening plays once at its natural pitch');
  const sounds = [];
  h.scene.cache = { audio: { exists: () => true } };
  h.scene.sound = { add: (key, config) => {
    const sound = { key, config, play() { this.played = true; }, destroy() { this.destroyed = true; } };
    sounds.push(sound);
    return sound;
  } };
  h.prepareSpawnIntro(h.scene, h.sprite, 'ninja', '');
  h.startSpawnIntro(h.scene);
  assert.ok(sounds.every(s => s.played));
  assert.ok(sounds.every(s => s.key === 'sfx-parachute-open'), 'uses the dedicated parachute sample, not the wind loop');
  h.sprite.body.blocked.down = true;
  h.scene.events.emit('postupdate');
  assert.ok(sounds.every(s => s.destroyed));
  h.scene.events.emit('shutdown');
  assert.equal(h.scene._parachuteSounds.length, 0);
});

test('glide moves one way from an offset launch and reaches spawn across frame rates', () => {
  const h = harness();
  for (const fps of [30, 60, 144]) for (const offset of [-36, 36]) {
    const sprite = { x: 100 + offset, y: 20, body: { velocity: { x: 0, y: 88 } } };
    const entry = { sprite, target: { x: 100, y: 200 }, dropHeight: 180, launchOffsetX: offset };
    const dt = 1 / fps;
    for (let time = 0; sprite.y < 200; time += dt * 1000) {
      const vx = h.parachuteBreezeVelocity(entry, time, dt * 1000);
      assert.ok(Math.abs(vx) <= 24);
      assert.ok(vx * offset <= 0, 'never reverses direction');
      sprite.x += vx * dt;
      sprite.y += 88 * dt;
    }
    assert.ok(Math.abs(sprite.x - 100) < 0.01, 'returns to landing X without teleporting');
  }
});

test('breeze respects platform edges and nearby walls', () => {
  const h = harness();
  const body = { left: 80, right: 120, top: 150, bottom: 200 };
  const floor = { body: { enable: true, left: 75, right: 200, top: 202, bottom: 230, checkCollision: { up: true } } };
  assert.equal(h.parachuteBreezeClearance(body, [floor], 180), 3);
  const wall = { body: { enable: true, left: 122, right: 140, top: 20, bottom: 180 } };
  assert.equal(h.parachuteBreezeClearance(body, [floor, wall], 180, 1), 0);
  assert.equal(h.parachuteBreezeClearance(body, [floor, wall], 180, -1), 3);
});

test('canopy leans smoothly toward movement, with no independent oscillation', () => {
  const h = harness();
  for (const direction of [-1, 1]) {
    let angle = 0;
    for (let i = 0; i < 60; i++) {
      const next = h.parachuteTilt(angle, direction * 18, 1000 / 60);
      assert.ok(next * direction >= angle * direction);
      assert.ok(Math.abs(next - angle) < 1.1);
      angle = next;
    }
    assert.ok(angle * direction > 10 && Math.abs(angle) <= 12);
    assert.ok(Math.abs(h.parachuteTilt(angle, 0, 1000 / 60)) < Math.abs(angle));
  }
});
