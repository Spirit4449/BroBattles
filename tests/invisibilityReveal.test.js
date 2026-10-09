const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

const clock = { now: 1000 };
const load = (path, context) => {
  const exports = {};
  vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve(path), 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code, { exports, performance: { now: () => clock.now }, ...context });
  return exports;
};
const reveal = load('../src/client/game/powerups/invisibilityReveal');
const { markOneShotAnimation } = load('../src/client/game/characters/shared/animationState');
// Every character's attack (local or remote) marks its sprite through here.
const attack = (sprite, kind = 'throw') => markOneShotAnimation(sprite, kind, 400, { remote: true });
const api = load('../src/client/game/players/RemotePlayer', {
  require: id => id === '../../../shared/characters/index.js' ? require('../src/shared/characters')
    : id === '../powerups/invisibilityReveal.js' ? reveal
    : new Proxy({}, { get: () => () => {} }),
});

function invisibleRemote() {
  const sprite = { active: true, alpha: 1, setVisible() {}, setAlpha(a) { this.alpha = a; } };
  const remote = Object.assign(Object.create(api.default.prototype), {
    opponent: sprite, presenceConnected: true, presenceLoaded: true, _spawnPresented: true,
  });
  remote.setPowerupInvisible(true);
  return { remote, sprite };
}

test('an invisible remote player stays hidden until they attack', () => {
  const { remote, sprite } = invisibleRemote();
  assert.equal(sprite.alpha, 0);

  attack(sprite);
  remote.setPowerupInvisible(true);
  assert.ok(sprite.alpha > 0 && sprite.alpha < 1, `faded silhouette, got ${sprite.alpha}`);
});

test('the attack silhouette fades back out while invisibility lasts', () => {
  const { remote, sprite } = invisibleRemote();
  attack(sprite, 'special');
  remote.setPowerupInvisible(true);
  const peak = sprite.alpha;

  clock.now += 500;
  remote.setPowerupInvisible(true);
  assert.ok(sprite.alpha > 0 && sprite.alpha < peak, `fading, got ${sprite.alpha}`);

  clock.now += 2000;
  remote.setPowerupInvisible(true);
  assert.equal(sprite.alpha, 0);
});

test('movement animations do not reveal an invisible player', () => {
  const { remote, sprite } = invisibleRemote();
  markOneShotAnimation(sprite, 'jumping', 400, { remote: true });
  remote.setPowerupInvisible(true);
  assert.equal(sprite.alpha, 0);
});

test('attacking while visible does not change the sprite', () => {
  const { remote, sprite } = invisibleRemote();
  remote.setPowerupInvisible(false);
  attack(sprite);
  remote.setPowerupInvisible(false);
  assert.equal(sprite.alpha, 1);
  // A later cloak does not replay an attack made while visible.
  remote.setPowerupInvisible(true);
  assert.equal(sprite.alpha, 0);
});

test('the attacker sees their own ghost brighten and settle back to its usual alpha', () => {
  const { INVISIBLE_ALPHA, invisibleAttackAlpha } = reveal;
  const { base, peak } = INVISIBLE_ALPHA.local;

  assert.equal(invisibleAttackAlpha(-Infinity, INVISIBLE_ALPHA.local, 0), base);
  assert.equal(invisibleAttackAlpha(1000, INVISIBLE_ALPHA.local, 1000), peak);
  const fading = invisibleAttackAlpha(1000, INVISIBLE_ALPHA.local, 1500);
  assert.ok(fading > base && fading < peak, `fading, got ${fading}`);
  assert.equal(invisibleAttackAlpha(1000, INVISIBLE_ALPHA.local, 5000), base);
  // Local ghost is always more visible than what remote viewers see.
  assert.ok(base > INVISIBLE_ALPHA.remote.base && peak > INVISIBLE_ALPHA.remote.peak);
});
