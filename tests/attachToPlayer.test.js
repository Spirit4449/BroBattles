const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attachToPlayer, PLAYER_LAYERS } = require('../src/client/game/characters/shared/attachToPlayer.js');

function world() {
  const made = [];
  const scene = { events: new EventEmitter(), add: { graphics() {
    const g = { active: true, setDepth(d) { this.depth = d; return this; }, destroy() { this.active = false; } };
    made.push(g); return g;
  } } };
  const sprite = Object.assign(new EventEmitter(), { active: true, depth: 30, body: { enable: true } });
  const listeners = () => ['postupdate', 'shutdown', 'presentation:reset'].reduce((n, e) => n + scene.events.listenerCount(e), 0)
    + sprite.listenerCount('destroy') + sprite.listenerCount('attack:interrupted');
  return { scene, sprite, made, listeners };
}

test('an attachment draws on depth layers around the player and runs on real elapsed time', () => {
  const { scene, sprite, made, listeners } = world();
  const seen = [];
  const fx = attachToPlayer(scene, sprite, { layers: ['floor', 'front'], lifetimeMs: 200,
    update: (ms, dt, layers) => { seen.push([ms, dt, Object.keys(layers)]); } });
  assert.deepEqual(made.map(g => g.depth), [30 + PLAYER_LAYERS.floor, 30 + PLAYER_LAYERS.front]);
  assert.deepEqual(seen[0], [0, 0, ['floor', 'front']], 'drawn once straight away');
  scene.events.emit('postupdate', 0, 120);
  assert.deepEqual(seen[1].slice(0, 2), [120, 120], 'a long frame is not clamped');
  scene.events.emit('postupdate', 0, 90);
  assert.equal(fx.active, false, 'ends at its lifetime');
  assert.ok(made.every(g => !g.active));
  assert.equal(listeners(), 0);
});

test('every way an attachment can end cleans it up', () => {
  const endings = {
    'player dies': ({ sprite, scene }) => { sprite.body.enable = false; scene.events.emit('postupdate', 0, 16); },
    'player destroyed': ({ sprite }) => sprite.emit('destroy'),
    'scene shutdown': ({ scene }) => scene.events.emit('shutdown'),
    'presentation reset': ({ scene }) => scene.events.emit('presentation:reset'),
    'sprite event': ({ sprite }) => sprite.emit('attack:interrupted'),
    'update returns false': ({ scene, stop }) => { stop.now = true; scene.events.emit('postupdate', 0, 16); },
  };
  for (const [name, end] of Object.entries(endings)) {
    const w = world();
    const stop = { now: false };
    let ended = 0;
    const fx = attachToPlayer(w.scene, w.sprite, { layers: ['behind'], endOn: ['attack:interrupted'],
      onEnd: () => ended++, update: () => !stop.now });
    end({ ...w, stop });
    assert.equal(fx.active, false, name);
    assert.equal(ended, 1, name);
    assert.ok(w.made.every(g => !g.active), name);
    assert.equal(w.listeners(), 0, name);
  }
});

test('a keyed attachment replaces the previous one; detach hands its objects on', () => {
  const { scene, sprite } = world();
  const ball = { active: true, destroy() { this.active = false; } };
  const first = attachToPlayer(scene, sprite, { key: 'cast', objects: [ball] });
  const second = attachToPlayer(scene, sprite, { key: 'cast', objects: [ball] });
  assert.equal(first.active, false);
  assert.equal(ball.active, false, 'the replaced attachment took its objects with it');
  const kept = { active: true, destroy() { this.active = false; } };
  const third = attachToPlayer(scene, sprite, { key: 'cast', objects: [kept] });
  assert.equal(second.active, false);
  third.detach();
  assert.equal(third.active, false);
  assert.equal(kept.active, true, 'detached objects survive');
  assert.equal(sprite._bbAttachments.size, 0);
});
