const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const terrainAudio = require('../src/shared/physics/terrainAudio.json');
const maps = require('../src/shared/maps').mapsCatalog;
const exported = {};
const code = babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/audio/movementAudio.js'), 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code;
vm.runInNewContext(code, { exports: exported, require: key => key.includes('movementSounds') ? require('../src/shared/physics/movementSounds') : terrainAudio });
const { getTerrainSteps, footstepVolume, terrainLandingSound, shouldPlayLandingSound, preloadTerrainAudio } = exported;

test('all maps specify a registered terrain and Bank Bust retains its original footsteps', () => {
  for (const map of maps.maps) {
    assert.ok(terrainAudio.terrains[map.terrain]);
    assert.equal(map.terrain, map.id === 4 ? 'hard' : 'grass');
  }
  assert.equal(getTerrainSteps('hard')[0].key, 'sfx-step-1');
  assert.equal(getTerrainSteps('grass')[0].key, 'sfx-grass-step-1');
  assert.equal(getTerrainSteps('unknown'), getTerrainSteps('hard'));
});

test('registry preloads every variant once and all sample files exist', () => {
  const loads = [];
  preloadTerrainAudio({ load: { audio: (key, urls) => loads.push({ key, urls }) } }, '/assets');
  assert.equal(loads.length, 9);
  assert.equal(new Set(loads.map(l => l.key)).size, 9);
  for (const load of loads) for (const url of load.urls) {
    const file = path.join(__dirname, '../public', url);
    assert.ok(fs.statSync(file).size > 0, file);
  }
});

test('walking and direction-change sounds are quieter at every speed, especially on grass', () => {
  for (const speed of [0, 0.5, 1]) for (const turn of [false, true]) {
    const previous = (turn ? 0.52 : 0.4) + speed * (turn ? 0.13 : 0.15);
    assert.ok(Math.abs(footstepVolume(speed, turn, 'hard') - previous * 0.6) < 1e-12);
    assert.ok(Math.abs(footstepVolume(speed, turn, 'grass') - previous * 0.6 * 0.65) < 1e-12);
  }
});

test('grass footsteps share predictable playback gain and landings follow terrain', () => {
  assert.ok(footstepVolume(0.5, false, 'grass') < footstepVolume(0.5, false, 'hard'));
  assert.equal(terrainLandingSound('grass', 0.5).key, 'sfx-grass-land');
  assert.equal(terrainLandingSound('grass', 0.5).volume, 0.325);
  assert.equal(terrainLandingSound('hard', 0.5).key, 'sfx-hard-land');
  assert.equal(terrainLandingSound('hard', 0.5).volume, 0.45);
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

test('jumping immediately at fight start does not mute that jump landing', () => {
  const player = { _suppressSpawnLandingSound: true, body: { velocity: { y: -400 } } };
  assert.equal(shouldPlayLandingSound(player, false), true);
  player.body.velocity.y = 0;
  assert.equal(shouldPlayLandingSound(player, true), true);
});

test('startup contact flicker and small upward corrections remain silent', () => {
  const player = { y: 200, _suppressSpawnLandingSound: true };
  assert.equal(shouldPlayLandingSound(player, true, 0), false);
  assert.equal(shouldPlayLandingSound(player, true, 0), false);
  player.y = 199;
  assert.equal(shouldPlayLandingSound(player, false, -2), false);
  player.y = 202;
  assert.equal(shouldPlayLandingSound(player, false, 50), false);
  assert.equal(shouldPlayLandingSound(player, true, 0), false);
});

test('walking off the spawn platform re-arms the next landing', () => {
  const player = { y: 200, _suppressSpawnLandingSound: true };
  assert.equal(shouldPlayLandingSound(player, true, 0), false);
  player.y = 201;
  assert.equal(shouldPlayLandingSound(player, false, 20), false);
  player.y = 220;
  assert.equal(shouldPlayLandingSound(player, false, 180), true);
  assert.equal(shouldPlayLandingSound(player, true, 0), true);
});


test('Bank Bust preloads isolated metal footsteps and landings and preserves other movement cues', () => {
  const registry = require('../src/shared/physics/movementSounds');
  const api = {};
  const source = babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/modes/bankBust/preloadAssets.js'), 'utf8'), {
    babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  vm.runInNewContext(source, { exports: api, require: key => key.includes('movementSounds')
    ? registry : require('../src/client/game/modes/bankBust/propFrames.json') });
  const loads = new Map();
  const scene = { load: { image() {}, spritesheet() {}, audio(key, url) { loads.set(key, url); } } };
  api.preloadBankBustAssets(scene, '/assets');
  assert.ok(registry.bankBustMovementSounds[terrainLandingSound('hard', 1).key], 'Bank Bust overrides terrain landing');
  for (const key of Object.keys(registry.bankBustMovementSounds)) {
    const selected = registry.movementSoundKey(scene, key);
    assert.notEqual(selected, key);
    assert.equal(registry.movementSoundKey({}, key), key, 'other modes retain shared samples');
    const file = fs.readFileSync(path.join(__dirname, '../public', loads.get(selected)));
    assert.equal(file.toString('ascii', 0, 4), 'RIFF');
    assert.equal(file.toString('ascii', 8, 12), 'WAVE');
    assert.ok(file.length > 44);
  }
  for (const key of ['sfx-jump', 'sfx-walljump', 'sfx-dash', 'sfx-stomp', 'sfx-sliding', 'sfx-fall-air', 'sfx-duck-transition', 'sfx-duck-block', 'sfx-damage']) {
    assert.equal(registry.movementSoundKey(scene, key), key);
  }
});


test('Bank Bust landing has extra gain without changing other modes or exceeding full volume', () => {
  const bank = { _bankBustMovementAudio: true };
  assert.ok(terrainLandingSound('hard', 0.3, bank).volume > terrainLandingSound('hard', 0.3, {}).volume);
  assert.equal(terrainLandingSound('hard', 1, bank).volume, 1);
  assert.equal(terrainLandingSound('hard', 0.3, {}).volume, terrainLandingSound('hard', 0.3).volume);
});
