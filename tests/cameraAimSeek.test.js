const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const exportsObject = {};
const { code } = babel.transformSync(fs.readFileSync(require.resolve('../src/gameScene/cameraDynamics.js'), 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
});
vm.runInNewContext(code, { exports: exportsObject });
const { updateDynamicCamera } = exportsObject;
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
