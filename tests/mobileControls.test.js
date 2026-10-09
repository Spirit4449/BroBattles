const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

const { code } = babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/scene/mobileControls.js'), 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
});

function events(target = {}) {
  const handlers = new Map();
  return Object.assign(target, {
    addEventListener(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); },
    removeEventListener(name, fn) { handlers.get(name)?.delete(fn); },
    emit(name, event = {}) { for (const fn of handlers.get(name) || []) fn({ type: name, preventDefault() {}, stopPropagation() {}, ...event }); },
  });
}

function element() {
  const classes = new Set();
  return events({
    children: [], style: { setProperty() {} },
    set className(value) { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name) },
    appendChild(child) { this.children.push(child); },
    setAttribute() {}, remove() {},
  });
}

function setup({ superRatio = 1 } = {}) {
  const win = events({ innerWidth: 844, innerHeight: 390, __BB_FORCE_MOBILE_CONTROLS: true,
    getComputedStyle: () => ({}) });
  const body = element();
  body.contains = () => true;
  const context = { exports: {}, window: win, navigator: { maxTouchPoints: 5 },
    document: { body, createElement: element } };
  vm.runInNewContext(code, context);
  const fired = [];
  const player = { x: 100, y: 200, flipX: false };
  const controller = context.exports.createMobileControlsController({
    getPlayer: () => player,
    getAimBasePoint: () => ({ baseX: player.x, baseY: player.y }),
    resolveAimContext: ({ family, pointerWorldX, pointerWorldY }) => ({ family, aimed: true, pointerWorldX, pointerWorldY }),
    resolveQuickContext: (family) => ({ family, quick: true }),
    getSuperChargeRatio: () => superRatio,
    onBasicFire: (ctx) => fired.push(ctx),
    onSpecialFire: (ctx) => fired.push(ctx),
    onSpecialNotReady: () => fired.push('not-ready'),
  });
  controller.ensure({ game: {} });
  const root = body.children[0];
  const [, moveZone, , duck, jump, dash, special, basic] = root.children;
  const press = (el, id, x, y) => el.emit('pointerdown', { pointerId: id, clientX: x, clientY: y });
  const drag = (id, x, y) => win.emit('pointermove', { pointerId: id, clientX: x, clientY: y });
  const lift = (id) => win.emit('pointerup', { pointerId: id });
  return { controller, fired, player, els: { moveZone, duck, jump, dash, special, basic }, press, drag, lift };
}

test('dash button is a single fresh press and the movement stick steers its direction', () => {
  const h = setup();
  h.press(h.els.moveZone, 1, 150, 300);
  h.drag(1, 150, 220);
  assert.equal(h.controller.isAimingUp(), true);
  assert.equal(h.controller.isAimingDown(), false);
  h.press(h.els.dash, 2, 760, 170);
  assert.equal(h.controller.consumeDashFreshPress(), true);
  assert.equal(h.controller.consumeDashFreshPress(), false, 'holding dash does not repeat it');
  h.lift(2);
  h.press(h.els.dash, 3, 760, 170);
  assert.equal(h.controller.consumeDashFreshPress(), true);
});

test('duck is held by its button or by pulling the stick straight down, not by running diagonally', () => {
  const h = setup();
  h.press(h.els.duck, 4, 520, 330);
  assert.equal(h.controller.isDuckHeld(), true);
  h.lift(4);
  assert.equal(h.controller.isDuckHeld(), false);

  h.press(h.els.moveZone, 5, 150, 250);
  h.drag(5, 150, 320);
  assert.equal(h.controller.isDuckHeld(), true);
  h.drag(5, 210, 300);
  assert.equal(h.controller.isDuckHeld(), false);
  assert.equal(h.controller.isMovingRight(), true);
  h.lift(5);
  assert.equal(h.controller.isMovingRight(), false);
});

test('tapping attack auto-aims, dragging aims, and an uncharged super only gives feedback', () => {
  const h = setup();
  h.press(h.els.basic, 6, 700, 300);
  h.lift(6);
  assert.deepEqual({ ...h.fired.pop() }, { family: 'basic', quick: true });

  h.press(h.els.basic, 7, 700, 300);
  h.drag(7, 640, 300);
  h.lift(7);
  const aimed = h.fired.pop();
  assert.equal(aimed.aimed, true);
  assert.ok(aimed.pointerWorldX < h.player.x, 'dragging left aims left');

  const empty = setup({ superRatio: 0.4 });
  empty.press(empty.els.special, 8, 640, 220);
  empty.lift(8);
  assert.deepEqual(empty.fired, ['not-ready']);
});
