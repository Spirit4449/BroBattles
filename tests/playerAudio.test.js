const { loadClientModule } = require('./helpers/clientModule');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const path = require('node:path');

describe("Spatial mix and spectating", () => {
  const audio = {};
  loadClientModule('src/client/game/audio/playerAudio.js', { exports: audio });

  function scene() {
    const calls = [];
    const local = { active: true, x: 200, y: 200 };
    return { calls, local, _localPlayerAudioSprite: local,
      cameras: { main: { midPoint: { x: 200, y: 200 },
        worldView: { x: 0, y: 0, width: 1000, height: 700 } } },
      sound: { play: (...args) => { calls.push(args); return true; } } };
  }

  test('spectating makes the watched fighter the full-volume listener and follows switches', () => {
    const s = scene();
    const watched = { active: true, x: 800, y: 300 };
    const other = { active: true, x: 800, y: 300 };
    s._spectatorModeActive = true;
    s._spectatedPlayerAudioSprite = watched;
    assert.equal(audio.playerAudioListener(s), watched);
    assert.equal(audio.playerSoundVolume(s, watched, 0.65), 0.65);
    assert.ok(audio.playerSoundVolume(s, other, 0.65) > 0 && audio.playerSoundVolume(s, other, 0.65) < 0.65);
    assert.ok(audio.playerSoundVolume(s, s.local, 0.65) < 0.65);
    s._spectatedPlayerAudioSprite = other;
    assert.equal(audio.playerSoundVolume(s, other, 0.65), 0.65);
    assert.ok(audio.playerSoundVolume(s, watched, 0.65) < 0.65);
    audio.playPlayerSound(s, other, 'special', { volume: 0.65, rate: 1.1 });
    assert.equal(s.calls[0][1].volume, 0.65);
    assert.equal(s.calls[0][1].rate, 1.1);
  });

});

describe("Local movement cues", () => {
  const terrainAudio = require('../src/shared/physics/terrainAudio.json');

  const exported = {};

  loadClientModule(require.resolve('../src/client/game/audio/movementAudio.js'), { exports: exported, require: key => key.includes('movementSounds') ? require('../src/shared/physics/movementSounds') : terrainAudio });
  const { getTerrainSteps, footstepVolume, terrainLandingSound, shouldPlayLandingSound, preloadTerrainAudio } = exported;

  test('terrain preload queues each registered sound once and resolves its files', () => {
    const loads = [];
    preloadTerrainAudio({ load: { audio: (key, urls) => loads.push({ key, urls }) } }, '/assets');
    const expectedKeys = new Set(Object.values(terrainAudio.terrains).flatMap(terrain =>
      [...terrain.steps, terrain.landing].filter(Boolean).map(sound => sound.key)));
    assert.deepEqual(new Set(loads.map(sound => sound.key)), expectedKeys);
    assert.equal(loads.length, expectedKeys.size, 'shared samples queue once');
    for (const sound of loads) for (const url of sound.urls) {
      assert.ok(fs.statSync(path.join(__dirname, '../public', url)).size > 0, url);
    }
  });

  test('the opening spawn settle is silent and a real jump re-arms landing audio', () => {
    const player = { _suppressSpawnLandingSound: true, body: { velocity: { y: 88 } } };
    assert.equal(shouldPlayLandingSound(player, false), false);
    assert.equal(shouldPlayLandingSound(player, false), false);
    player.body.velocity.y = 0;
    assert.equal(shouldPlayLandingSound(player, true), false);
    assert.equal(player._suppressSpawnLandingSound, true);
    player.body.velocity.y = -400;
    assert.equal(shouldPlayLandingSound(player, false), true);
    player.body.velocity.y = 0;
    assert.equal(shouldPlayLandingSound(player, true), true, 'normal jump landing remains audible');
  });

});

describe("Replicated movement cues", () => {
  const { EventEmitter } = require('node:events');
  function load(path, dependencies = {}, extra = {}) {
    const exports = {};

    loadClientModule(path, { exports, require: key => {
      if (key.includes('movementSounds')) return require('../src/shared/physics/movementSounds');
      assert.ok(key in dependencies, key); return dependencies[key];
    }, ...extra });
    return exports;
  }
  const audio = load('src/client/game/audio/playerAudio.js');
  const movement = load('src/client/game/audio/movementAudio.js', {
    './playerAudio': audio, '../../../shared/physics/terrainAudio.json': require('../src/shared/physics/terrainAudio.json'),
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
    const module = load('src/client/game/audio/remoteMovementAudio.js', {
      './playerAudio': audio, './movementAudio': movement,
      '../../../shared/physics/movementPhysics.json': require('../src/shared/physics/movementPhysics.json'),
      '../scene/effects': { MOVEMENT_VFX_CONFIG: { fastFallMaxVelocity: 760, runSpeedReference: 260,
        landingMaxVelocity: 760, landingShockwaveMinFallPx: 150 } },
    }, { performance: { now: () => time } });
    const controller = module.createRemoteMovementAudio(scene, sprite);
    function update(state, delta = 16) { time += delta; controller.update(state); scene.events.emit('postupdate'); }
    return { scene, sprite, calls, sounds, controller, update,
      tick(delta) { time += delta; scene.events.emit('postupdate'); } };
  }

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

  test('locked audio stays silent; invisible fighters still produce movement cues', () => {
    const f = fixture(), walking = { grounded: true, vx: 260 };
    f.scene.sound.locked = true;
    f.update(walking); f.update({ grounded: false, wallSliding: true, vy: 100 });
    assert.equal(f.calls.length, 0); assert.equal(f.sounds.length, 0);
    f.scene.sound.locked = false;
    f.sprite.alpha = 0; f.sprite._powerupInvisible = true;
    f.controller.reset(); f.update(walking);
    assert.equal(f.calls.length, 1);
    f.controller.destroy();
  });

});
