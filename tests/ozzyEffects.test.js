const { loadClientModule } = require('./helpers/clientModule');
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { POWERUP_CATALOG } = require('../src/shared/powerups');
const stubs = {
  '../../../../shared/characters/characterTuning.js': require('../src/shared/characters/characterTuning.js'),
  '../../../../shared/characters/characterRig.js': require('../src/shared/characters/characterRig.js'),
  '../shared/rig': require('../src/client/game/characters/shared/rig.js'),
  '../shared/attachToPlayer': require('../src/client/game/characters/shared/attachToPlayer.js'),
  '../../powerups/powerupConfig': {
    POWERUP_COLORS: Object.fromEntries(Object.entries(POWERUP_CATALOG).map(([key, entry]) => [key, entry.color])),
  },
};
const SURGE = require('../src/shared/characters/characterTuning.js').getResolvedCharacterSpecialConfig('ozzy', 'arcaneSurge');
const requireStub = id => stubs[id] || {};
stubs['./surgeFusion'] = loadClientModule('src/client/game/characters/ozzy/surgeFusion.js', { exports: {}, require: requireStub });

function fixture({ icons = false } = {}) {
  const api = {}, objects = [], tweens = [];
  loadClientModule('src/client/game/characters/ozzy/effects.js', { exports: api, require: requireStub });
  const special = {};
  loadClientModule('src/client/game/characters/ozzy/special.js', { exports: special, require: id => ({
    '../shared/animationState.js': { playSpriteAnimation() {} },
  })[id] || requireStub(id) });
  function object(_x, _y, texture) {
    const item = { calls: [], active: true, texture, alpha: 1, x: 0, y: 0, width: 112, height: 112,
      destroy() { this.active = false; } };
    for (const key of ['setDepth', 'setBlendMode', 'setDisplaySize', 'setOrigin', 'setScale', 'fillStyle', 'fillRect', 'clear', 'lineStyle', 'lineBetween', 'fillCircle', 'strokeCircle']) item[key] = (...args) => { item.calls.push({ key, args }); return item; };
    item.setScale = scale => { item.scaleX = scale; return item; };
    item.setAlpha = alpha => { item.alpha = alpha; return item; };
    item.setPosition = (x, y) => { item.x = x; item.y = y; return item; };
    objects.push(item);
    return item;
  }
  const scene = { events: new EventEmitter(), textures: { exists: key => icons && key.startsWith('pu-icon-') },
    add: { graphics: object, text: object, image: object }, tweens: { add(config) {
      const tween = { ...config, stopped: false, stop() { this.stopped = true; } };
      tweens.push(tween); return tween;
    } } };
  const sprites = Object.fromEntries(['ozzy', 'ally'].map((name, i) => [name,
    Object.assign(new EventEmitter(), { active: true, visible: true, body: { enable: true }, x: 100 + i * 200, y: 100, displayHeight: 110 })]));
  const surge = () => api.playOzzyArcaneSurge(scene, { caster: 'ozzy', recipients: [
    { username: 'ozzy', type: 'rage', isCaster: true }, { username: 'ally', type: 'shield' },
  ] }, name => sprites[name]);
  return { scene, sprites, objects, tweens, special, surge };
}

function setup() {
  const state = fixture();
  state.surge();
  return state;
}

// The cast as Phaser plays it: each frame shown for msPerFrame + duration.
function castAnimation(sprite) {
  const frames = Array.from({ length: 21 }, (_, i) => ({ textureFrame: `special${String(i).padStart(2, '0')}`, duration: 1000 / 14 - 10 }));
  sprite.anims = { currentAnim: { key: 'ozzy-special', msPerFrame: 10, frames }, currentFrame: frames[0], accumulator: 0 };
  return 3 * 1000 / 14; // the staff strikes the book on special03
}

const iconsOf = (objects, type) => objects.filter(item => item.texture === `pu-icon-${type}-webp`);

test('completion and shutdown dispose beam objects and listeners', () => {
  for (const finish of [s => s.tweens[0].onComplete(), s => s.scene.events.emit('shutdown'), s => s.scene.events.emit('presentation:reset'), s => s.sprites.ally.emit('destroy')]) {
    const state = setup();
    // The teammate's powerup is pushed out of the fusion before its beam leaves.
    assert.equal(state.tweens.length, 0);
    state.scene.events.emit('postupdate', 0, 200);
    assert.equal(state.tweens.length, 1);
    // The surge burst on the caster draws from the first frame...
    state.scene.events.emit('postupdate', 0, 100);
    assert.ok(state.objects.some(item => item.calls.some(call => call.key === 'fillRect')), 'the surge burst draws');
    finish(state);
    // ...and outlives the beam only until its own lifetime ends.
    state.scene.events.emit('postupdate', 0, 1000);
    assert.ok(state.objects.every(item => !item.active));
    assert.equal(state.scene.events.listenerCount('postupdate'), 0);
    assert.equal(state.scene.events.listenerCount('update'), 0);
    assert.equal(state.sprites.ozzy.listenerCount('destroy'), 0);
  }
});

test('every candidate powerup circles ozzy from the book strike and fuses on the staff', () => {
  const state = fixture({ icons: true });
  const touchMs = castAnimation(state.sprites.ozzy);
  state.special.perform({ scene: state.scene, player: state.sprites.ozzy });
  const icons = SURGE.powerups.map(type => iconsOf(state.objects, type)[0]);
  assert.ok(icons.every(Boolean), 'an icon for every candidate');
  state.scene.events.emit('postupdate', 0, touchMs - 20);
  assert.ok(icons.every(icon => icon.alpha === 0), 'nothing before the book is struck');
  state.scene.events.emit('postupdate', 0, 420);
  assert.ok(icons.every(icon => icon.alpha > 0), 'all circle him after the strike');
  assert.equal(new Set(icons.map(icon => `${icon.x},${icon.y}`)).size, icons.length, 'spread around the circle');
  state.scene.events.emit('postupdate', 0, SURGE.surgeMs - touchMs - 400 + 20);
  assert.ok(icons.every(icon => icon.alpha === 0), 'fused once the surge lands');

  // The server's surge ends the orbit and pushes out what it picked.
  state.surge();
  assert.deepEqual(icons.filter(icon => icon.active), [iconsOf(state.objects, 'rage')[0], iconsOf(state.objects, 'shield')[0]]);
  const own = iconsOf(state.objects, 'rage').at(-1);
  const pushed = iconsOf(state.objects, 'shield').at(-1);
  const distanceToAlly = () => Math.hypot(pushed.x - state.sprites.ally.x, pushed.y - state.sprites.ally.y);
  const distanceFromStaff = distanceToAlly();
  state.scene.events.emit('postupdate', 0, 100);
  assert.ok(own.alpha > 0 && pushed.alpha > 0, 'the picked powerups come out of the fusion');
  assert.ok(distanceToAlly() < distanceFromStaff, "the teammate's is kicked towards them");
  state.scene.events.emit('postupdate', 0, 600);
  assert.equal(own.alpha, 0, "the caster's own has gone into him");
  assert.ok(own.active, 'its absorb ring is still playing');
  const beam = state.tweens[0];
  const launch = [pushed.x, pushed.y];
  beam.onUpdate();
  assert.deepEqual([pushed.x, pushed.y], launch);
  assert.equal(pushed.alpha, 1);
  beam.targets.elapsed = 300;
  beam.onUpdate();
  assert.deepEqual([pushed.x, pushed.y], [state.sprites.ally.x, state.sprites.ally.y - state.sprites.ally.displayHeight * 0.18]);
  assert.equal(iconsOf(state.objects, 'shield').length, 1);
  state.scene.events.emit('postupdate', 0, 1000);
  assert.ok(pushed.active, 'beam owns the carried sprite');
  beam.onComplete();
  assert.equal(pushed.active, false);
});

test('presentation reset and shutdown clear the orbit and the push-out', () => {
  for (const event of ['presentation:reset', 'shutdown']) {
    const state = fixture({ icons: true });
    castAnimation(state.sprites.ozzy);
    state.special.perform({ scene: state.scene, player: state.sprites.ozzy });
    state.scene.events.emit('postupdate', 0, 500);
    state.scene.events.emit(event);
    assert.ok(state.objects.every(item => !item.active));
    state.surge();
    state.scene.events.emit(event);
    state.scene.events.emit('postupdate', 0, 300);
    assert.equal(state.tweens.length, 0, 'no beam launches after a reset');
    assert.ok(state.objects.every(item => !item.active));
    assert.equal(state.scene.events.listenerCount('postupdate'), 0);
    assert.equal(state.sprites.ozzy.listenerCount('destroy'), 0);
  }
});

test('an interrupted cast breaks off the orbit', () => {
  const state = fixture({ icons: true });
  castAnimation(state.sprites.ozzy);
  state.special.perform({ scene: state.scene, player: state.sprites.ozzy });
  state.scene.events.emit('postupdate', 0, 400);
  state.sprites.ozzy.anims.currentAnim = { key: 'ozzy-idle', frames: [] };
  state.scene.events.emit('postupdate', 0, 16);
  assert.ok(state.objects.every(item => !item.active));
});

test('turning mid-orbit preserves the spin and an early surge continues from the visible icon', () => {
  const orbit = flip => {
    const state = fixture({ icons: true });
    castAnimation(state.sprites.ozzy);
    state.special.perform({ scene: state.scene, player: state.sprites.ozzy });
    state.scene.events.emit('postupdate', 0, 650);
    state.sprites.ozzy.flipX = flip;
    state.scene.events.emit('postupdate', 0, 16);
    const [a, b] = ['rage', 'shield'].map(type => iconsOf(state.objects, type)[0]);
    const offset = [a.x - b.x, a.y - b.y];
    const pose = [b.x, b.y, b.alpha, b.scaleX];
    state.surge();
    assert.deepEqual([b.x, b.y, b.alpha, b.scaleX], pose);
    return offset;
  };
  const normal = orbit(false), flipped = orbit(true);
  assert.ok(normal.every((value, i) => Math.abs(value - flipped[i]) < 1e-8));
});
