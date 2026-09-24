import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { deferSceneAudio } from '../src/gameScene/deferredAudio.js';

function fixture() {
  const queued = [], played = [], cached = new Set();
  let starts = 0;
  const scene = { events: new EventEmitter(), cache: { audio: { exists: key => cached.has(key) } },
    sound: { play(key) { played.push(key); return true; } },
    load: { audio(...args) { queued.push(args); return this; }, start() { starts++; } },
  };
  return { scene, queued, played, cached, get starts() { return starts; } };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
test('audio cannot block visual creation; early sounds are skipped and ready sounds play', async () => {
  const f = fixture();
  deferSceneAudio(f.scene);
  assert.equal(f.scene.load.audio('attack', ['/attack.mp3']), f.scene.load);
  assert.equal(f.queued.length, 0);
  assert.equal(f.scene.sound.play('attack'), false);
  f.scene.events.emit('create');
  assert.equal(f.starts, 0);
  await tick();
  assert.deepEqual(f.queued, [['attack', ['/attack.mp3']]]);
  assert.equal(f.starts, 1);
  f.cached.add('attack');
  assert.equal(f.scene.sound.play('attack'), true);
  assert.deepEqual(f.played, ['attack']);
  assert.equal(f.scene.sound.play('failed'), false);
  f.scene.events.emit('shutdown');
});
test('leaving before background loading starts cancels work and restores methods', async () => {
  const f = fixture();
  const audio = f.scene.load.audio, play = f.scene.sound.play;
  deferSceneAudio(f.scene);
  f.scene.load.audio('attack', '/attack.mp3');
  f.scene.events.emit('create');
  f.scene.events.emit('shutdown');
  await tick();
  assert.equal(f.starts, 0);
  assert.equal(f.scene.load.audio, audio);
  assert.equal(f.scene.sound.play, play);
  assert.equal(f.scene.events.listenerCount('create'), 0);
});
