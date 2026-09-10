const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const babel = require('@babel/core');
const Phaser = {
  Geom: { Point: class { constructor(x, y) { Object.assign(this, { x, y }); } },
    Line: class { constructor(x1, y1, x2, y2) { Object.assign(this, { x1, y1, x2, y2 }); } } },
  Math: { DegToRad: d => d * Math.PI / 180, Linear: (a, b, t) => a + (b - a) * t },
};
function load(file) {
  const path = require.resolve(file), exports = {};
  const { code } = babel.transformSync(fs.readFileSync(path, 'utf8'), {
    babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  });
  vm.runInNewContext(code, { exports, Phaser,
    require: id => id.includes('renderLayers') ? { RENDER_LAYERS: { RETICLES: 100 } } : createRequire(path)(id) });
  return exports;
}
const { resolveAttackAimContext } = require('../src/characters/shared/attackAim.js');
const { resolveGloopHookSocket } = require('../src/shared/gloopHookGeometry.js');
const { createAttackAimReticleController, getAttackGuideStyle } = load('../src/gameScene/attackAimReticle.js');
function context(character) {
  return resolveAttackAimContext({ character, player: { x: 200, y: 300, width: 80, height: 100 },
    family: 'basic', pointerWorldX: 700, pointerWorldY: 300, quick: false });
}
test('wizard guide reads longer and wider than ninja; arrows and slime retain curved samples', () => {
  const wizard = getAttackGuideStyle(context('wizard')), ninja = getAttackGuideStyle(context('ninja'));
  assert.ok(wizard.length > ninja.length);
  assert.ok(wizard.width > ninja.width);
  for (const character of ['huntress', 'gloop']) {
    const state = context(character), points = state.throwPreview.points;
    assert.ok(points.length > 2);
    const first = points[0], last = points.at(-1);
    assert.ok(points.some(p => Math.abs((p.x - first.x) * (last.y - first.y) - (p.y - first.y) * (last.x - first.x)) > 1));
    assert.ok(getAttackGuideStyle(state).length > 100);
  }
});
test('all basic attack shapes render finite geometry and directional guides visibly fade', () => {
  for (const character of ['wizard', 'ninja', 'huntress', 'gloop', 'draven', 'thorg']) {
    const styles = [], shapes = [];
    const scene = { add: { graphics() {
      const g = {};
      for (const key of ['setDepth', 'setVisible', 'clear', 'destroy']) g[key] = () => g;
      for (const key of ['fillStyle', 'lineStyle']) g[key] = (...args) => { styles.push(args); return g; };
      for (const key of ['strokeLineShape', 'fillPoints', 'strokePoints', 'fillEllipse', 'strokeEllipse']) {
        g[key] = (...args) => { shapes.push(args); return g; };
      }
      return g;
    } } };
    const renderer = createAttackAimReticleController(scene);
    renderer.update({ ...context(character), centerCue: { proximity: 1, held: true } });
    assert.ok(shapes.length > 0, character);
    assert.ok(!JSON.stringify(shapes).includes('null'), character);
    const alphas = styles.map(s => s.at(-1));
    assert.ok(Math.max(...alphas) >= 0.6, character);
    assert.ok(Math.min(...alphas) < 0.3, character);
    renderer.destroy();
  }
});

test('guide reach ignores drag strength and melee footprints remain fixed', () => {
  const wizard = context('wizard');
  assert.equal(getAttackGuideStyle({ ...wizard, previewStrength: 0.01 }).length,
    getAttackGuideStyle({ ...wizard, previewStrength: 1 }).length);
  for (const character of ['draven', 'thorg']) {
    const draws = [];
    const scene = { add: { graphics() {
      const g = {};
      for (const key of ['setDepth', 'setVisible', 'clear', 'destroy', 'fillStyle', 'lineStyle']) g[key] = () => g;
      for (const key of ['strokeLineShape', 'fillPoints', 'strokePoints', 'fillEllipse', 'strokeEllipse'])
        g[key] = (...args) => { draws.push([key, ...args]); return g; };
      return g;
    } } };
    const renderer = createAttackAimReticleController(scene);
    renderer.update({ ...context(character), previewStrength: 0.1 });
    const short = JSON.stringify(draws); draws.length = 0;
    renderer.update({ ...context(character), previewStrength: 1 });
    assert.equal(JSON.stringify(draws), short, character);
    renderer.destroy();
  }
});

test('Gloop super guide displays the hook full attack reach', () => {
  const state = resolveAttackAimContext({ character: 'gloop',
    player: { x: 200, y: 300, width: 80, height: 100 }, family: 'special',
    pointerWorldX: 900, pointerWorldY: 300, quick: false });
  assert.equal(getAttackGuideStyle(state).length, state.range);
  assert.equal(state.range, 760);
});

test('Gloop super guide starts at the same visible-body socket as the fired hand', () => {
  const player = { x: 200, y: 300, width: 128, height: 128,
    displayWidth: 153.6, displayHeight: 153.6,
    body: { width: 33.6, height: 45.6, center: { x: 200, y: 350 } } };
  const state = resolveAttackAimContext({ character: 'gloop', player,
    family: 'special', pointerWorldX: 900, pointerWorldY: 350, quick: false });
  const firedFrom = resolveGloopHookSocket(player, state.angle);
  assert.ok(Math.abs(state.anchorX - firedFrom.x) < 0.001);
  assert.ok(Math.abs(state.anchorY - firedFrom.y) < 0.001);
  assert.equal(state.baseX, state.anchorX);
  assert.equal(state.baseY, state.anchorY);
});

test('basic reticle turns red at zero ammo and returns to white when ammo reloads', () => {
  const colors = [];
  const scene = { add: { graphics() {
    const g = {};
    for (const key of ['setDepth', 'setVisible', 'clear', 'destroy']) g[key] = () => g;
    g.fillStyle = color => { colors.push(color); return g; };
    g.lineStyle = (_width, color) => { colors.push(color); return g; };
    for (const key of ['strokeLineShape', 'fillPoints', 'strokePoints', 'fillEllipse', 'strokeEllipse']) g[key] = () => g;
    return g;
  } } };
  let ammo = 0;
  const renderer = createAttackAimReticleController(scene, { getAmmoCharges: () => ammo });
  renderer.update(context('ninja'));
  assert.ok(colors.includes(0xff3030));
  assert.ok(!colors.includes(0xffffff));
  colors.length = 0;
  ammo = 1;
  renderer.update(context('ninja'));
  assert.ok(colors.includes(0xffffff));
  assert.ok(!colors.includes(0xff3030));
  renderer.destroy();
});
