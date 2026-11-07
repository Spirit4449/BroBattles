const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const exportsObject = {};
const { code } = babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/scene/cameraDynamics.js'), 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
});
let reducedMotion = false;
vm.runInNewContext(code, { exports: exportsObject, window: { matchMedia: () => ({ matches: reducedMotion }) } });
const { updateDynamicCamera, restingCameraFrame, triggerWallJumpCameraKick } = exportsObject;

const { arenaFor, arenaIds } = require('../src/shared/maps/arenas');

// Use Phaser's actual follow, dead-zone, bounds, and matrix pipeline here.
const Camera = require('phaser/src/cameras/2d/Camera');
const { EventEmitter } = require('node:events');
function cameraFixture(id = 'duels-1v1', x = 1150, y = 520, delta = 1000 / 60) {
  const arena = arenaFor(id), config = arena.camera;
  const cam = new Camera(0, 0, 1280, 720);
  const player = { x, y };
  cam.setBounds(config.x, config.y, config.width, config.height);
  cam.setZoom(restingCameraFrame(y, config).zoom);
  cam.setDeadzone(config.deadzoneWidth, config.deadzoneHeight);
  cam.startFollow(player, false, 0.08, 0.05, 0, 120);
  const scene = { cameras: { main: cam }, game: { loop: { delta } }, events: new EventEmitter(),
    _mapArena: arena, _combatAimLook: { x: 0, y: 0 } };
  const render = () => {
    cam.preRender();
    const before = cam.matrix.e;
    cam.emit('prerender', cam);
    return cam.matrix.e - before;
  };
  const update = () => { updateDynamicCamera(scene, player); return render(); };
  for (let i = 0; i < 360; i++) update();
  return { cam, scene, player, update, render };
}

test('aim uses elapsed time and preserves pointer-to-world mapping', () => {
  const samples = [];
  for (const fps of [30, 60, 120]) {
    const { cam, scene, player } = cameraFixture('bank-bust-3v3', 0, 500, 1000 / fps);
    scene._combatAimLook = { x: 72, y: -36 };
    for (let frame = 0; frame < fps / 5; frame++) updateDynamicCamera(scene, player);
    cam.preRender();
    const before = cam.getWorldPoint(640, 360);
    cam.emit('prerender', cam);
    const after = cam.getWorldPoint(640, 360);
    const shift = scene._aimCameraShift;
    assert.ok(Math.abs((after.x - before.x) * cam.zoom - shift.x) < 0.0001);
    assert.ok(Math.abs((after.y - before.y) * cam.zoom - shift.y) < 0.0001);
    samples.push({ ...shift });
    scene.events.emit('shutdown');
    assert.equal(scene._aimCameraShift, null);
  }
  for (const sample of samples) {
    assert.ok(Math.abs(sample.x - samples[0].x) < 1e-8);
    assert.ok(Math.abs(sample.y - samples[0].y) < 1e-8);
  }
});

test('wall-jump feedback resets cleanly and does not multiply listeners on repeat kicks', () => {
  for (const finish of ['reset', 'shutdown', 'destroy']) {
    const { cam, scene, update, render } = cameraFixture();
    const originalZoom = cam.zoom;
    for (const direction of [1, -1, 1]) { triggerWallJumpCameraKick(scene, direction); update(); }
    assert.equal(cam.listenerCount('prerender'), 1);
    if (finish === 'reset') scene._resetAimCameraBounds();
    else if (finish === 'shutdown') scene.events.emit('shutdown');
    else cam.destroy();
    assert.equal(scene._wallJumpCameraKick, null);
    assert.equal(scene._wallJumpCameraOffsetX, 0);
    assert.ok(Math.abs(cam.zoom - originalZoom) < 0.0001);
    if (finish !== 'destroy') assert.equal(render(), 0);
    if (finish !== 'reset') {
      assert.equal(cam.listenerCount('prerender'), 0);
      assert.equal(scene.events.listenerCount('shutdown'), 0);
    }
    scene.events.emit('shutdown');
  }
});

test('wall-jump feedback respects reduced motion and composes with damage shake and dash zoom', () => {
  const { cam, scene, player, update, render } = cameraFixture();
  const originalZoom = cam.zoom;
  reducedMotion = true;
  try {
    triggerWallJumpCameraKick(scene, 1);
    assert.equal(update(), 0);
    assert.equal(cam.zoom, originalZoom);
  } finally { reducedMotion = false; }
  player._dash = {};
  triggerWallJumpCameraKick(scene, 1);
  update();
  assert.ok(scene._dashCameraZoom > 0 && scene._wallJumpCameraZoom > 0);
  assert.ok(Math.abs(cam.zoom - originalZoom - scene._dashCameraZoom - scene._wallJumpCameraZoom) < 0.0001);
  cam.shake(100, 0.001);
  cam.shakeEffect.update(0, 16);
  assert.ok(Math.abs(render() + scene._wallJumpCameraOffsetX) < 0.0001);
  player._dash = null;
  for (let i = 0; i < 360; i++) update();
  assert.ok(Math.abs(cam.zoom - originalZoom) < 0.0001);
  scene.events.emit('shutdown');
});

test('landing carry follows elapsed time and clears on reset, spectate, shutdown and reduced motion', () => {
  const samples = [];
  for (const fps of [30, 60, 120]) {
    const { scene, player, update } = cameraFixture('duels-1v1', 1150, 520, 1000 / fps);
    player.body = { velocity: { y: 1000 }, blocked: { down: false } };
    update();
    player.body.blocked.down = true;
    player.body.velocity.y = 0;
    for (let frame = 0; frame < fps / 10; frame++) update();
    samples.push(scene._landingCameraOffsetY);
  }
  for (const sample of samples) assert.ok(Math.abs(sample - samples[0]) < 1e-8);
  for (const finish of ['reset', 'spectate', 'shutdown', 'reducedMotion', 'replaceBody']) {
    const { scene, player, update, render } = cameraFixture();
    player.body = { velocity: { y: 1200 }, touching: { down: false } };
    update();
    player.body.touching.down = true;
    player.body.velocity.y = 0;
    update();
    assert.ok(scene._landingCameraOffsetY > 0);
    if (finish === 'reset') scene._resetAimCameraBounds();
    if (finish === 'spectate') { scene._spectatorModeActive = true; render(); }
    if (finish === 'shutdown') scene.events.emit('shutdown');
    if (finish === 'replaceBody') { player.body = { velocity: { y: 0 } }; update(); }
    if (finish === 'reducedMotion') {
      reducedMotion = true;
      try { update(); } finally { reducedMotion = false; }
    }
    assert.equal(scene._landingCameraOffsetY, 0);
    assert.equal(scene._landingCameraCarry, null);
  }
});
