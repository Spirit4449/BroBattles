const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const { EventEmitter } = require('node:events');
function load(path, dependencies = {}, extra = {}) {
  const exports = {};
  const code = babel.transformSync(fs.readFileSync(path, 'utf8'), {
    babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  vm.runInNewContext(code, { exports, require: key => {
    assert.ok(key in dependencies, key); return dependencies[key];
  }, ...extra });
  return exports;
}
const audio = load('src/gameScene/playerAudio.js');
const movement = load('src/gameScene/movementAudio.js', {
  './playerAudio': audio, '../shared/terrainAudio.json': require('../src/shared/terrainAudio.json'),
});
function fixture() {
  let time = 0;
  const calls = [], sounds = [];
  const sprite = Object.assign(new EventEmitter(), { active: true, x: 200, y: 200 });
  const scene = { events: new EventEmitter(), _terrainType: 'grass',
    _localPlayerAudioSprite: { active: true, x: 200, y: 200 },
    cameras: { main: { worldView: { x: 0, y: 0, width: 1000, height: 700 } } },
    sound: { play(key, options) { calls.push({ key, ...options }); return true; },
      add(key) {
        const sound = { key, isPlaying: false, destroyed: 0,
          setVolume(v) { this.volume = v; }, setRate(v) { this.rate = v; },
          play(options) { Object.assign(this, options); this.isPlaying = true; return true; },
          stop() { this.isPlaying = false; }, destroy() { this.destroyed++; },
        }; sounds.push(sound); return sound;
      } },
  };
  const module = load('src/gameScene/remoteMovementAudio.js', {
    './playerAudio': audio, './movementAudio': movement,
    '../shared/movementPhysics.json': require('../src/shared/movementPhysics.json'),
    '../effects': { MOVEMENT_VFX_CONFIG: { fastFallMaxVelocity: 760, runSpeedReference: 260,
      landingMaxVelocity: 760, landingShockwaveMinFallPx: 150 } },
  }, { performance: { now: () => time } });
  const controller = module.createRemoteMovementAudio(scene, sprite);
  function update(state, delta = 16) { time += delta; controller.update(state); scene.events.emit('postupdate'); }
  return { scene, sprite, calls, sounds, controller, update,
    tick(delta) { time += delta; scene.events.emit('postupdate'); } };
}
test('terrain footsteps have cadence and use shared distance and spectator volumes', () => {
  const f = fixture(), state = { grounded: true, vx: 260, vy: 0, movementFxSeq: 0 };
  f.update(state); f.update(state, 20); assert.equal(f.calls.length, 1);
  const base = movement.footstepVolume(1, false, 'grass');
  assert.ok(Math.abs(f.calls[0].volume - base * .9) < 1e-12);
  f.update(state, 150); assert.equal(f.calls.length, 2);
  assert.notEqual(f.calls[0].key, f.calls[1].key);
  f.scene._spectatorModeActive = true; f.scene._spectatedPlayerAudioSprite = f.sprite;
  f.update(state, 150); assert.equal(f.calls[2].volume, base);
  f.scene._spectatorModeActive = false; f.sprite.x = 1600;
  f.update(state, 150); assert.equal(f.calls.length, 3);
  f.controller.destroy();
});
test('event IDs suppress repeated jump, wall jump and landing audio and historical joins', () => {
  const f = fixture();
  f.update({ grounded: true, movementFxSeq: 5, movementFxType: 'jump' });
  assert.equal(f.calls.length, 0);
  const jump = { grounded: false, vy: -300, movementFxSeq: 6, movementFxType: 'jump' };
  f.update(jump); f.update(jump); assert.equal(f.calls.length, 1);
  const wallJump = { grounded: false, vx: 250, vy: -300, movementFxSeq: 7, movementFxType: 'wall-jump' };
  f.update(wallJump); f.update(wallJump); assert.equal(f.calls.length, 2);
  const land = { grounded: true, movementFxSeq: 8, movementFxType: 'land', movementFxImpactVelocity: 700, movementFxFallDistance: 200 };
  f.update(land); f.update(land);
  assert.deepEqual(f.calls.map(c => c.key), ['sfx-jump', 'sfx-walljump', 'sfx-grass-land']);
  f.controller.reset(); f.update(land); assert.equal(f.calls.length, 3);
  f.controller.destroy();
});
test('legacy movement transitions play once and dashes do not produce footsteps or jumps', () => {
  const f = fixture();
  f.update({ grounded: true });
  f.update({ grounded: false, vy: -250 }); f.update({ grounded: false, vy: -250 });
  assert.equal(f.calls.filter(c => c.key === 'sfx-jump').length, 1);
  f.update({ grounded: false, wallSliding: true, vy: 100 });
  f.update({ grounded: false, wallSliding: false, vx: 300, vy: -250 });
  assert.equal(f.calls.filter(c => c.key === 'sfx-walljump').length, 1);
  f.controller.reset(); const count = f.calls.length;
  f.update({ grounded: true, animation: 'dashing', vx: 560 });
  f.update({ grounded: false, animation: 'dashing', vy: -560 });
  assert.equal(f.calls.length, count);
  f.controller.destroy();
});
test('fall and slide loops follow distance and spectator switches, and stop on landing', () => {
  const f = fixture(), falling = { grounded: false, vy: 700 };
  f.update(falling); f.update(falling, 250);
  const wind = f.sounds.find(s => s.key === 'sfx-fall-air'); assert.ok(wind.isPlaying);
  const nearby = wind.volume;
  f.sprite.x = 950; f.tick(1); assert.ok(wind.volume < nearby);
  f.sprite.x = 1600; f.tick(1); assert.equal(wind.isPlaying, false);
  f.scene._spectatorModeActive = true; f.scene._spectatedPlayerAudioSprite = f.sprite;
  f.tick(1); assert.equal(wind.isPlaying, true); assert.ok(wind.volume > nearby);
  f.update({ grounded: false, wallSliding: true, vy: 100 });
  const slide = f.sounds.find(s => s.key === 'sfx-sliding');
  assert.ok(slide.isPlaying); assert.equal(wind.isPlaying, false);
  f.update({ grounded: true }); assert.equal(slide.isPlaying, false);
  f.controller.destroy(); assert.ok(f.sounds.every(s => s.destroyed === 1));
});
test('stale movement, presentation resets, shutdown and sprite destruction release loops', () => {
  for (const end of ['stale', 'reset', 'shutdown', 'destroy']) {
    const f = fixture();
    f.update({ grounded: false, wallSliding: true, vy: 100 });
    assert.ok(f.sounds[0].isPlaying);
    if (end === 'stale') f.tick(301);
    if (end === 'reset') f.scene.events.emit('presentation:reset');
    if (end === 'shutdown') f.scene.events.emit('shutdown');
    if (end === 'destroy') f.sprite.emit('destroy');
    assert.equal(f.sounds[0].isPlaying, false); assert.equal(f.sounds[0].destroyed, 1);
    f.controller.destroy();
    assert.equal(f.scene.events.listenerCount('postupdate'), 0);
    assert.equal(f.scene.events.listenerCount('presentation:reset'), 0);
    assert.equal(f.sprite.listenerCount('destroy'), 0);
  }
});

test('spawn intro and locked audio stay silent; invisible fighters still produce movement cues', () => {
  const f = fixture(), walking = { grounded: true, vx: 260 };
  f.scene._spawnIntroActive = true;
  f.update(walking); assert.equal(f.calls.length, 0);
  f.scene._spawnIntroActive = false;
  f.scene.sound.locked = true;
  f.update(walking); f.update({ grounded: false, wallSliding: true, vy: 100 });
  assert.equal(f.calls.length, 0); assert.equal(f.sounds.length, 0);
  f.scene.sound.locked = false;
  f.sprite.alpha = 0; f.sprite._powerupInvisible = true;
  f.controller.reset(); f.update(walking);
  assert.equal(f.calls.length, 1);
  f.controller.destroy();
});
