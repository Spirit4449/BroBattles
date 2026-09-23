const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

const audio = {};
vm.runInNewContext(babel.transformSync(fs.readFileSync('src/gameScene/playerAudio.js', 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code, { exports: audio });

function scene() {
  const calls = [];
  const local = { active: true, x: 200, y: 200 };
  return { calls, local, _localPlayerAudioSprite: local,
    cameras: { main: { midPoint: { x: 200, y: 200 },
      worldView: { x: 0, y: 0, width: 1000, height: 700 } } },
    sound: { play: (...args) => { calls.push(args); return true; } } };
}

test('nearby player sounds stay just below the listener sound and fade with distance', () => {
  const s = scene();
  assert.equal(audio.playerSoundVolume(s, s.local, 0.7), 0.7);
  assert.ok(Math.abs(audio.playerSoundVolume(s, { x: 200, y: 200 }, 0.7) - 0.63) < 1e-12);
  const midway = audio.playerSoundVolume(s, { x: 625, y: 200 }, 0.7);
  assert.ok(midway < 0.63 && midway > 0.4);
  assert.equal(audio.playerSoundVolume(s, { x: 2000, y: 200 }, 0.7), 0);
});

test('effects above unity preserve their local mix level and invisible fighters remain audible', () => {
  const s = scene();
  assert.equal(audio.playerSoundVolume(s, s.local, 1.75), 1.75);
  const invisible = { active: true, visible: false, x: 200, y: 200 };
  assert.ok(Math.abs(audio.playerSoundVolume(s, invisible, 1.75) - 1.575) < 1e-12);
});

test('offscreen fade reaches silence beyond the view while preserving a soft edge', () => {
  const s = scene();
  const edge = audio.playerSoundVolume(s, { x: 1000, y: 200 }, 0.6);
  const justOutside = audio.playerSoundVolume(s, { x: 1100, y: 200 }, 0.6);
  assert.ok(edge > justOutside && justOutside > 0);
  assert.equal(audio.playerSoundVolume(s, { x: 1360, y: 200 }, 0.6), 0);
  assert.equal(audio.playPlayerSound(s, { x: 1600, y: 200 }, 'attack', { volume: 0.6 }), false);
  assert.equal(s.calls.length, 0);
});

test('spectating makes the watched fighter the full-volume listener and follows switches', () => {
  const s = scene();
  const watched = { active: true, x: 800, y: 300 };
  const other = { active: true, x: 800, y: 300 };
  s._spectatorModeActive = true;
  s._spectatedPlayerAudioSprite = watched;
  assert.equal(audio.playerAudioListener(s), watched);
  assert.equal(audio.playerSoundVolume(s, watched, 0.65), 0.65);
  assert.ok(Math.abs(audio.playerSoundVolume(s, other, 0.65) - 0.585) < 1e-12);
  assert.ok(audio.playerSoundVolume(s, s.local, 0.65) < 0.65);
  s._spectatedPlayerAudioSprite = other;
  assert.equal(audio.playerSoundVolume(s, other, 0.65), 0.65);
  assert.ok(audio.playerSoundVolume(s, watched, 0.65) < 0.65);
  audio.playPlayerSound(s, other, 'special', { volume: 0.65, rate: 1.1 });
  assert.equal(s.calls[0][1].volume, 0.65);
  assert.equal(s.calls[0][1].rate, 1.1);
});

test('spectator fallback listens from the camera until another fighter is selected', () => {
  const s = scene();
  s._spectatorModeActive = true;
  assert.equal(audio.playerAudioListener(s), s.cameras.main.midPoint);
  assert.ok(audio.playerSoundVolume(s, { x: 200, y: 200 }, 0.5) > 0);
});
