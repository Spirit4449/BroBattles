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
const Phaser = { Math: { Clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)) } };
const { arenaFor, arenaIds } = require('../src/shared/maps/arenas');
test('aim seek shifts camera limits at either map edge without accumulating bounds drift', () => {
  const cam = { zoom: 1.8, useBounds: true, _bounds: { x: -40, y: -20, width: 2000, height: 1200 },
    followOffset: { x: 0, y: 120 },
    setZoom(z) { this.zoom = z; },
    setBounds(x,y,width,height) { this._bounds = { x,y,width,height }; },
    setFollowOffset(x,y) { this.followOffset = { x,y }; } };
  const scene = { cameras: { main: cam }, game: { loop: { delta: 16.67 } }, _mapArena: arenaFor('duels-1v1') };
  for (const x of [-100, 100]) {
    scene._combatAimLook = { x, y: 30 };
    for (let i = 0; i < 360; i++) updateDynamicCamera(scene, { x: x < 0 ? 0 : 2000, y: 520 }, Phaser);
    assert.ok(Math.abs(cam._bounds.x - (-40 + x)) < 0.001);
    assert.ok(Math.abs(cam.followOffset.x + x) < 0.001);
    assert.equal(cam._bounds.width, 2000);
    scene._resetAimCameraBounds();
    assert.ok(Math.abs(cam._bounds.x + 40) < 0.001);
    assert.ok(Math.abs(cam._bounds.y + 20) < 0.001);
  }
});

test('every mode eases its follow zoom between its own limits as players climb', () => {
  for (const id of arenaIds()) {
    const camera = arenaFor(id).camera, [high, low] = camera.climbY;
    assert.equal(restingCameraFrame(low + 200, camera).zoom, camera.maxZoom, id);
    assert.equal(restingCameraFrame(high - 200, camera).zoom, camera.minZoom, id);
    const mid = restingCameraFrame((high + low) / 2, camera).zoom;
    assert.ok(mid > Math.min(camera.minZoom, camera.maxZoom) && mid < Math.max(camera.minZoom, camera.maxZoom), id);
  }
});

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

test('wall-jump recoil and zoom stay consistent across maps, heights, bounds and dead zones', () => {
  let reference;
  for (const id of ['duels-1v1', 'duels-2v2']) {
    for (const y of [80, 350, 700]) for (const x of [0, 1150, 2300]) for (const direction of [-1, 1]) {
      const { cam, scene, player, update } = cameraFixture(id, x, y);
      const baseline = { zoom: cam.zoom, boundsX: cam._bounds.x, followX: cam.followOffset.x };
      triggerWallJumpCameraKick(scene, direction);
      const offsets = [], zooms = [];
      for (let frame = 1; frame <= 60 && scene._wallJumpCameraKick; frame++) {
        const t = frame / 60;
        player.y = y - 604.8 * t + 0.5 * 990 * t * t;
        offsets.push(update() * direction);
        zooms.push(cam.zoom / baseline.zoom);
        assert.equal(cam._bounds.x, baseline.boundsX, 'recoil must not move map bounds');
        assert.equal(cam.followOffset.x, baseline.followX, 'recoil must bypass follow/dead zone');
      }
      const peak = Math.max(...offsets), peakIndex = offsets.indexOf(peak);
      assert.ok(offsets[0] > 0 && offsets[0] < peak / 2, 'gentle directional onset');
      assert.ok(peakIndex > 0);
      assert.ok(zooms[peakIndex] > 1, 'ascent must not cancel the zoom pulse');
      if (!reference) reference = { offsets, zooms };
      offsets.forEach((value, i) => assert.ok(Math.abs(value - reference.offsets[i]) < 0.0001));
      zooms.forEach((value, i) => assert.ok(Math.abs(value - reference.zooms[i]) < 0.0001));
      assert.equal(scene._wallJumpCameraKick, null);
      for (let i = 0; i < 360; i++) assert.equal(update(), 0);
      assert.ok(Math.abs(cam.zoom - restingCameraFrame(player.y, scene._mapArena.camera).zoom) < 0.0001,
        'normal height zoom resumes and settles');
      scene.events.emit('shutdown');
    }
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

test('wall-jump feedback follows elapsed time consistently at different frame rates', () => {
  let reference;
  for (const fps of [30, 60, 120]) {
    const { cam, scene, player, update } = cameraFixture('duels-1v1', 0, 520, 1000 / fps);
    const baseZoom = cam.zoom;
    triggerWallJumpCameraKick(scene, 1);
    const samples = [];
    for (let frame = 1; frame <= fps / 5; frame++) {
      player.y -= 600 / fps;
      const offset = update();
      if (frame === fps / 10 || frame === fps / 5) samples.push([offset, cam.zoom / baseZoom]);
    }
    if (!reference) reference = samples;
    samples.forEach((sample, i) => sample.forEach((value, j) => {
      assert.ok(Math.abs(value - reference[i][j]) < 0.0001);
    }));
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

test('dash zoom stays visible and consistent while climbing or descending on either map', () => {
  let reference;
  for (const id of ['duels-1v1', 'duels-2v2']) for (const vy of [-560, 0, 560]) {
    const { cam, scene, player, update } = cameraFixture(id);
    // Begin while the normal camera is still catching up to a changed height.
    player.y -= 120;
    const initialZoom = cam.zoom;
    player._dash = {};
    const zooms = [];
    for (let i = 0; i < 9; i++) {
      player.y += vy / 60;
      update();
      zooms.push(cam.zoom / initialZoom);
    }
    assert.ok(zooms.every(value => value > 1), 'height tracking must not cancel dash zoom');
    assert.ok(zooms.at(-1) > zooms[0], 'pulse builds during the burst');
    if (!reference) reference = zooms;
    zooms.forEach((value, i) => assert.ok(Math.abs(value - reference[i]) < 0.0001));
    player._dash = null;
    for (let i = 0; i < 360; i++) update();
    assert.ok(Math.abs(cam.zoom - restingCameraFrame(player.y, scene._mapArena.camera).zoom) < 0.0001);
    scene.events.emit('shutdown');
  }
});

test('dash-only camera feedback respects reduced motion and clears on release or shutdown', () => {
  for (const finish of ['reset', 'shutdown', 'spectate']) {
    const { cam, scene, player, update, render } = cameraFixture();
    const initialZoom = cam.zoom;
    player._dash = {};
    reducedMotion = true;
    try { update(); assert.equal(cam.zoom, initialZoom); }
    finally { reducedMotion = false; }
    update();
    assert.ok(cam.zoom > initialZoom);
    if (finish === 'reset') scene._resetAimCameraBounds();
    else if (finish === 'shutdown') scene.events.emit('shutdown');
    else { scene._spectatorModeActive = true; render(); }
    assert.ok(Math.abs(cam.zoom - initialZoom) < 0.0001);
    assert.equal(scene._dashCameraZoom, 0);
    assert.equal(scene._dashCameraBaseZoom, null);
    scene.events.emit('shutdown');
  }
});
