const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const exportsObject = {};
const { code } = babel.transformSync(fs.readFileSync(require.resolve('../src/gameScene/combatMouse.js'), 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
});
vm.runInNewContext(code, { exports: exportsObject });
const { COMBAT_MOUSE_CONFIG, createCombatMouseController } = exportsObject;
function events() {
  const handlers = new Map();
  return {
    addEventListener(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); },
    removeEventListener(name, fn) { handlers.get(name)?.delete(fn); },
    emit(name, event = {}) { for (const fn of handlers.get(name) || []) fn(event); },
    count() { return [...handlers.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}
function setup({ canCapture } = {}) {
  const win = events();
  const doc = Object.assign(events(), { defaultView: win, hidden: false, hasFocus: () => true,
    body: { appendChild() {} }, createElement: () => ({ style: {}, remove() {} }) });
  const canvas = Object.assign(events(), { ownerDocument: doc, style: {}, requestPointerLock() {} });
  doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.emit('pointerlockchange'); };
  const graphic = {};
  for (const name of ['setDepth', 'setVisible', 'clear', 'fillStyle', 'fillRect', 'destroy']) graphic[name] = () => graphic;
  let allowed = true, releases = 0;
  const base = { baseX: 10, baseY: 20 };
  const scene = { game: { canvas }, add: { graphics: () => graphic }, events: { on() {}, off() {} }, cameras: { main: { zoom: 1.8 } } };
  const controller = createCombatMouseController({ scene, canPlay: () => allowed, canCapture, getBase: () => base,
    onRelease: () => releases++, depth: 10, config: { ...COMBAT_MOUSE_CONFIG, mouseSensitivity: 0.36 } });
  const capture = () => { assert.equal(controller.beginInput(), false); doc.pointerLockElement = canvas; doc.emit('pointerlockchange'); };
  return { controller, scene, doc, win, canvas, base, capture, block: () => { allowed = false; }, releases: () => releases };
}
function move(h, x, y) {
  h.doc.emit('mousemove', { target: h.canvas, movementX: x, movementY: y });
  h.controller.update();
}
test('production aiming sensitivity is reduced', () => {
  assert.equal(COMBAT_MOUSE_CONFIG.mouseSensitivity, 0.24);
});
test('gameplay hides cursor before clicking; movement captures and Escape keeps it visible', () => {
  const h = setup();
  let requests = 0;
  h.canvas.requestPointerLock = () => { requests++; };
  assert.equal(h.canvas.style.cursor, 'none');
  assert.equal(h.controller.isActive(), false);
  h.doc.emit('keydown', { key: 'w' });
  assert.equal(requests, 1);
  h.doc.pointerLockElement = h.canvas;
  h.doc.emit('pointerlockchange');
  assert.equal(h.controller.isActive(), true);
  h.doc.emit('keydown', { key: 'Escape' });
  h.controller.update();
  assert.equal(h.canvas.style.cursor, '');
  h.doc.emit('keydown', { key: 'w', repeat: true });
  assert.equal(requests, 1);
  h.doc.emit('keydown', { key: 'ArrowLeft' });
  assert.equal(requests, 2);
  h.controller.destroy();
});
test('typing, shortcuts and blocked gameplay do not capture the mouse', () => {
  const h = setup();
  let requests = 0;
  h.canvas.requestPointerLock = () => { requests++; };
  h.doc.emit('keydown', { key: 'w', target: { tagName: 'INPUT' } });
  h.doc.emit('keydown', { key: 'a', target: { isContentEditable: true } });
  h.doc.emit('keydown', { key: 'w', metaKey: true });
  h.block();
  h.controller.update();
  h.doc.emit('keydown', { key: 'w' });
  assert.equal(requests, 0);
  assert.equal(h.canvas.style.cursor, '');
  h.controller.destroy();
});
test('death keeps capture for spectating; battle end shows cursor and blocks recapture', () => {
  let battleActive = true;
  const h = setup({ canCapture: () => battleActive });
  h.capture();
  h.controller.beginDrag();
  move(h, 50, 0);
  h.block();
  h.controller.update();
  assert.equal(h.canvas.style.cursor, 'none');
  assert.equal(h.doc.pointerLockElement, h.canvas);
  assert.equal(h.controller.isAiming(), false);
  let prevented = false;
  h.doc.emit('keydown', { key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(h.doc.pointerLockElement, h.canvas);
  battleActive = false;
  h.controller.update();
  assert.equal(h.canvas.style.cursor, '');
  assert.equal(h.doc.pointerLockElement, null);
  h.doc.emit('keydown', { key: 'ArrowLeft' });
  assert.equal(h.controller.isActive(), false);
  h.controller.destroy();
});
test('press establishes a new center; return hides aim and release clears it', () => {
  const h = setup(); h.capture();
  move(h, 100, 0);
  assert.equal(h.controller.shouldShowReticle(), false);
  h.controller.beginDrag();
  assert.equal(h.controller.isDefaultAim(), true);
  assert.equal(h.controller.isAiming(), false);
  move(h, 50, 20);
  assert.equal(h.controller.isAiming(), true);
  move(h, -50, -20);
  assert.equal(h.controller.isAiming(), false);
  assert.equal(h.controller.getStrength(), 0);
  move(h, -40, 0);
  assert.equal(h.controller.getDirection().x, -1);
  h.controller.endDrag();
  assert.equal(h.controller.isAiming(), false);
  assert.equal(h.scene._combatAimLook, null);
  h.controller.beginDrag(); move(h, 0, 30);
  assert.equal(h.controller.getDirection().y, 1);
  h.controller.destroy();
});
test('reticle and camera seek use direction without scaling from drag distance', () => {
  const h = setup(); h.capture(); h.controller.beginDrag();
  move(h, 30, 0); const near = h.controller.getStrength();
  const nearDistance = h.controller.getDistanceRatio();
  move(h, 60, 0); const far = h.controller.getStrength();
  const farDistance = h.controller.getDistanceRatio();
  assert.equal(near, 1);
  assert.equal(far, near);
  assert.ok(farDistance > nearDistance);
  assert.equal(h.scene._combatAimLook.x, 72);
  move(h, -60, 0);
  assert.equal(h.controller.getStrength(), near);
  move(h, 1000, 0);
  assert.equal(h.controller.getStrength(), 1);
  assert.equal(h.scene._combatAimLook.x, 72);
  move(h, -1030, 0);
  assert.equal(h.controller.isAiming(), false);
  assert.equal(h.scene._combatAimLook.x, 0);
  h.controller.destroy();
});
test('stable direction in every quadrant survives player movement, camera zoom and small corrections', () => {
  const h = setup(); h.capture();
  for (const [x, y] of [[80, 80], [-80, 80], [-80, -80], [80, -80]]) {
    h.controller.beginDrag(); move(h, x, y);
    assert.equal(Math.atan2(h.controller.getDirection().y, h.controller.getDirection().x), Math.atan2(y, x));
    const before = { ...h.controller.getDirection() };
    h.base.baseX += 200; h.scene.cameras.main.zoom = 2;
    move(h, 0, 0);
    assert.deepEqual({ ...h.controller.getDirection() }, before);
    move(h, 1, 0);
    assert.ok(Math.abs(h.controller.getDirection().y - before.y) < 0.01);
  }
  h.controller.destroy();
});
test('click stays hidden; crossing the threshold reveals directional aim', () => {
  const h = setup(); h.capture(); h.controller.beginDrag(-1);
  assert.equal(h.controller.shouldShowReticle(), false);
  assert.equal(h.controller.getDirection().x, -1);
  assert.equal(h.controller.getStrength(), 0);
  move(h, 1, 0);
  assert.equal(h.controller.isDefaultAim(), true);
  move(h, 30, 0);
  assert.equal(h.controller.isDefaultAim(), false);
  assert.equal(h.controller.shouldShowReticle(), true);
  move(h, -31, 0);
  assert.equal(h.controller.isAiming(), false);
  h.controller.endDrag(); h.controller.beginDrag(1);
  assert.equal(h.controller.getDirection().x, 1);
  h.controller.destroy();
});
test('Escape, focus loss, menus and lifecycle cleanup release capture and cancel input', () => {
  const h = setup(); h.capture();
  h.doc.emit('keydown', { key: 'Escape' });
  assert.equal(h.controller.isActive(), false);
  assert.equal(h.canvas.style.cursor, '');
  assert.equal(h.releases(), 1);
  h.capture(); h.win.emit('blur');
  assert.equal(h.controller.isActive(), false);
  h.capture(); h.block(); h.controller.update();
  assert.equal(h.doc.pointerLockElement, null);
  assert.equal(h.releases(), 3);
  h.controller.destroy();
  assert.equal(h.doc.count() + h.win.count() + h.canvas.count(), 0);
});
test('short throws hold their heading through center and switch only beyond the exit zone', () => {
  const h = setup(); h.capture(); h.controller.beginDrag(1, true);
  assert.equal(h.controller.getCenterCue(), null);
  assert.equal(h.controller.shouldShowReticle(), false);
  move(h, 94, 0);
  assert.ok(h.controller.getDistanceRatio() > 0);
  move(h, -60, 0);
  assert.equal(h.controller.getCenterCue().held, true);
  assert.equal(h.controller.getDistanceRatio(), 0);
  move(h, -74, 2);
  assert.equal(h.controller.getDirection().x, 1);
  assert.equal(h.controller.getDistanceRatio(), 0);
  assert.equal(h.controller.shouldShowReticle(), true);
  assert.equal(h.scene._combatAimLook.x, 72);
  move(h, -80, -2);
  assert.equal(h.controller.getDirection().x, -1);
  assert.equal(h.controller.getCenterCue().held, false);
  assert.ok(h.controller.getDistanceRatio() > 0);
  h.controller.endDrag();
  assert.equal(h.controller.getCenterCue(), null);
  h.controller.destroy();
});
test('throw range discards overshoot in every direction and retracts on the first inward movement', () => {
  const h = setup(); h.capture();
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0.6, -0.8]]) {
    h.controller.beginDrag(1, true);
    move(h, x * 500, y * 500);
    assert.ok(Math.abs(h.controller.getDistanceRatio() - 1) < 1e-10);
    move(h, x * 2000, y * 2000);
    assert.ok(Math.abs(h.controller.getDistanceRatio() - 1) < 1e-10);
    move(h, -x, -y);
    assert.ok(h.controller.getDistanceRatio() < 1);
    assert.ok(h.controller.getDistanceRatio() > 0.98);
    assert.ok(Math.abs(h.controller.getDirection().x - x) < 1e-10);
    assert.ok(Math.abs(h.controller.getDirection().y - y) < 1e-10);
  }
  h.controller.destroy();
});
test('late pointer lock after cancellation is released and failure fallback stays usable', () => {
  const h = setup();
  h.controller.beginInput(); h.controller.release();
  h.doc.pointerLockElement = h.canvas; h.doc.emit('pointerlockchange');
  assert.equal(h.doc.pointerLockElement, null);
  h.controller.beginInput(); h.doc.emit('pointerlockerror');
  assert.equal(h.controller.isActive(), true);
  h.canvas.emit('mouseleave');
  assert.equal(h.controller.isActive(), false);
  h.controller.destroy();
});
test('Force Touch pressure does not activate or change aiming', () => {
  const h = setup();
  let prevented = 0;
  const event = { preventDefault() { prevented++; } };
  h.canvas.emit('webkitmouseforcedown', event);
  assert.equal(h.controller.isAiming(), false);
  h.capture(); h.controller.beginDrag(-1, true);
  assert.equal(h.controller.shouldShowReticle(), false);
  h.canvas.emit('webkitmouseforcewillbegin', event);
  h.canvas.emit('webkitmouseforcedown', event);
  assert.equal(prevented, 0);
  assert.equal(h.controller.shouldShowReticle(), false);
  assert.equal(h.controller.isDefaultAim(), true);
  assert.equal(h.controller.getDistanceRatio(), 0);
  assert.equal(h.controller.getDirection().x, -1);
  move(h, -80, 0);
  const adjusted = h.controller.getDistanceRatio();
  assert.ok(adjusted > 0);
  h.canvas.emit('webkitmouseforceup', event);
  h.canvas.emit('webkitmouseforcedown', event);
  assert.equal(h.controller.getDistanceRatio(), adjusted);
  h.controller.endDrag();
  h.canvas.emit('webkitmouseforcedown', event);
  assert.equal(h.controller.shouldShowReticle(), false);
  h.controller.destroy();
  assert.equal(h.canvas.count(), 0);
});
