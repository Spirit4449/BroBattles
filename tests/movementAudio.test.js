const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const terrainAudio = require('../src/shared/terrainAudio.json');
const maps = require('../src/shared/maps.catalog.json');
const exported = {};
const code = babel.transformSync(fs.readFileSync(require.resolve('../src/gameScene/movementAudio.js'), 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code;
vm.runInNewContext(code, { exports: exported, require: () => terrainAudio });
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

test('the first grounded movement frame plays a step for short key taps', () => {
  const playerSource = fs.readFileSync(require.resolve('../src/player.js'), 'utf8');
  assert.match(playerSource, /if \(!wasGroundWalking\) \{\s*playMovementStep\(groundSpeedRatio, false\);/);
  assert.match(playerSource, /wasGroundWalking = isGroundWalking;/);
});

test('opening landing is silent even when the countdown ends before touchdown', () => {
  const player = { _suppressSpawnLandingSound: true, body: { velocity: { y: 88 } } };
  assert.equal(shouldPlayLandingSound(player, false), false);
  assert.equal(shouldPlayLandingSound(player, false), false);
  player.body.velocity.y = 0;
  assert.equal(shouldPlayLandingSound(player, true), false);
  assert.equal(player._suppressSpawnLandingSound, false);
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
