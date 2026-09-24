import test from 'node:test';
import assert from 'node:assert/strict';
import { installHighResolutionCanvas } from '../src/gameScene/highResolutionCanvas.js';

test('graphics scale changes backing resolution without changing game size', () => {
  const transforms = [];
  const listeners = new Map();
  const context = { setTransform(...args) { transforms.push(args); } };
  const originalSetTransform = context.setTransform;
  const canvas = { width: 400, height: 200, style: { imageRendering: 'pixelated' } };
  const Phaser = { CANVAS: 1, Scale: { Events: { RESIZE: 'resize' } }, Core: { Events: { DESTROY: 'destroy' } } };
  const game = {
    renderer: { type: Phaser.CANVAS, gameContext: context }, canvas,
    scale: {
      baseSize: { width: 400, height: 200 },
      on(event, callback) { listeners.set(event, callback); },
      off(event) { listeners.delete(event); },
    },
    events: { once(event, callback) { listeners.set(event, callback); } },
  };

  const resolution = installHighResolutionCanvas(game, Phaser, 1);
  assert.ok(resolution);
  assert.deepEqual([canvas.width, canvas.height], [400, 200]);

  resolution.setScale(0.5);
  assert.deepEqual([canvas.width, canvas.height], [200, 100]);
  assert.equal(canvas.style.imageRendering, 'pixelated');
  context.setTransform(1, 0, 0, 1, 10, 20);
  assert.deepEqual(transforms.at(-1), [0.5, 0, 0, 0.5, 5, 10]);

  resolution.setScale(2);
  assert.deepEqual([canvas.width, canvas.height], [800, 400]);
  assert.equal(canvas.style.imageRendering, 'auto');
  context.setTransform(1, 0, 0, 1, 10, 20);
  assert.deepEqual(transforms.at(-1), [2, 0, 0, 2, 20, 40]);

  resolution.setScale(Math.SQRT2);
  assert.deepEqual([canvas.width, canvas.height], [566, 283]);
  game.scale.baseSize = { width: 500, height: 300 };
  listeners.get('resize')();
  assert.deepEqual([canvas.width, canvas.height], [707, 424]);

  listeners.get('destroy')();
  assert.equal(context.setTransform, originalSetTransform);
  assert.equal(canvas.style.imageRendering, 'pixelated');
  assert.equal(listeners.has('resize'), false);
});
