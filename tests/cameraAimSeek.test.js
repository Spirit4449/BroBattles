const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const exportsObject = {};
const { code } = babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/scene/cameraDynamics.js'), 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
});
vm.runInNewContext(code, { exports: exportsObject });
const { updateDynamicCamera, restingCameraFrame } = exportsObject;
const Phaser = { Math: { Clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)) } };
test('aim seek shifts camera limits at either map edge without accumulating bounds drift', () => {
  const cam = { zoom: 1.8, useBounds: true, _bounds: { x: -40, y: -20, width: 2000, height: 1200 },
    followOffset: { x: 0, y: 120 },
    setZoom(z) { this.zoom = z; },
    setBounds(x,y,width,height) { this._bounds = { x,y,width,height }; },
    setFollowOffset(x,y) { this.followOffset = { x,y }; } };
  const scene = { cameras: { main: cam }, game: { loop: { delta: 16.67 } } };
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

test('maps can set their own follow zoom range, measured within their camera bounds', () => {
  const camera = { y: -40, height: 1300, minZoom: 1.28, maxZoom: 1.5 };
  const low = restingCameraFrame(camera.y + camera.height, camera), high = restingCameraFrame(camera.y, camera);
  assert.equal(low.zoom, camera.maxZoom);
  assert.equal(high.zoom, camera.minZoom);
  const mid = restingCameraFrame(camera.y + camera.height * 0.34, camera).zoom;
  assert.ok(mid > camera.minZoom && mid < camera.maxZoom, 'zoom eases between the limits as players climb');
  // Maps without a range keep the classic framing.
  assert.deepEqual(restingCameraFrame(520, { y: -40, height: 1000, zoom: 1.7 }), restingCameraFrame(520));
});
