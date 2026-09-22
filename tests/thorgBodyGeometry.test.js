const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const Frame = require('phaser/src/textures/Frame');
const Body = require('phaser/src/physics/arcade/Body');
const { characterBody } = require('../src/shared/duelGeometry');
const { spritePresentation } = require('../src/characters/shared/spritePresentation');
const { DUCK_HEIGHT_RATIO } = require('../src/shared/ducking');
const atlas = require('../public/assets/thorg/animations.json');

const api = {};
vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/players/RemotePlayer'), 'utf8'), {
  babelrc: false, configFile: false,
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code, { exports: api, require: id => id === '../shared/ducking.js'
  ? { DUCK_HEIGHT_RATIO } : { playDuckTransitionSound() {} } });

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('trimmed Thorg poses keep a centered, grounded collider in both facings and match server bounds', () => {
  const texture = { key: 'thorg', source: [{ width: atlas.meta.size.w, height: atlas.meta.size.h }] };
  const { scale, body: config } = spritePresentation('thorg', texture);
  for (const row of atlas.frames) {
    const r = row.frame, trim = row.spriteSourceSize;
    const frame = new Frame(texture, row.filename, 0, r.x, r.y, r.w, r.h);
    frame.setTrim(128, 128, trim.x, trim.y, trim.w, trim.h);
    const sprite = { x: 500, y: 300, angle: 0, rotation: 0,
      scaleX: scale, scaleY: scale, displayOriginX: 64, displayOriginY: 64,
      width: 128, height: 128, frame };
    sprite.body = new Body({ defaults: {}, bounds: {} }, sprite);
    sprite.body.setSize(frame.realWidth - config.widthShrink, frame.realHeight - config.heightShrink, false);
    const remote = Object.assign(Object.create(api.default.prototype), {
      character: 'thorg', opponent: sprite, opFrame: frame, bodyConfig: config,
    });
    for (const flip of [false, true]) for (const ducking of [false, true, false]) {
      sprite.flipX = flip;
      remote.setDucking(ducking);
      remote.applyFlipOffset();
      sprite.body.updateFromGameObject();
      const server = characterBody('thorg', flip);
      close(sprite.body.width, server.width);
      close(sprite.body.height, server.height * (ducking ? DUCK_HEIGHT_RATIO : 1));
      close(sprite.body.x + sprite.body.width / 2, sprite.x + server.offsetX);
      close(sprite.body.bottom, sprite.y + server.offsetY + server.halfHeight);
      close(sprite.body.bottom, sprite.y + (118 - 64) * scale);
      close(server.offsetX, 0);
    }
  }
});

test('standing idle soles sit exactly on the collider baseline', () => {
  for (const row of atlas.frames.filter(f => f.filename.startsWith('idle'))) {
    assert.equal(row.spriteSourceSize.y + row.spriteSourceSize.h, 118);
  }
  const duck = atlas.frames.find(f => f.filename === 'duck00');
  assert.ok(duck.bbEmbeddedWeapon);
});
