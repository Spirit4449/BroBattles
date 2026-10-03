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
const { characterDefinitions } = require('../src/shared/characters');

const api = {};
vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/players/RemotePlayer'), 'utf8'), {
  babelrc: false, configFile: false,
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code, { exports: api, require: id => id === '../shared/ducking.js'
  ? { DUCK_HEIGHT_RATIO }
  : id === '../shared/characters/index.js' ? require('../src/shared/characters')
  : { playDuckTransitionSound() {} } });

const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);

function atlasFrames(character) {
  const atlas = JSON.parse(fs.readFileSync(`public/assets/${character}/animations.json`, 'utf8'));
  const frames = Array.isArray(atlas.frames) ? atlas.frames
    : Object.entries(atlas.frames).map(([filename, frame]) => ({ filename, ...frame }));
  return { atlas, byName: new Map(frames.map(frame => [frame.filename, frame])) };
}

// Every fighter seen as a remote player must crouch to the same hitbox the
// server uses (DUCK_HEIGHT_RATIO, feet planted), as the local player does.
for (const character of Object.keys(characterDefinitions)) {
  test(`${character}: remote duck collider matches the server hitbox in both facings`, () => {
    const { atlas, byName } = atlasFrames(character);
    const idle = byName.get('idle00');
    const sourceW = idle.sourceSize?.w ?? idle.frame.w;
    const sourceH = idle.sourceSize?.h ?? idle.frame.h;
    const texture = {
      key: character,
      source: [{ width: atlas.meta.size.w, height: atlas.meta.size.h }],
      has: (name) => byName.has(name),
      get: (name) => ({ width: (byName.get(name)?.sourceSize?.w ?? byName.get(name)?.frame.w) }),
    };
    const { scale, body: config, originX, originY } = spritePresentation(character, texture);
    const frame = new Frame(texture, 'idle00', 0, idle.frame.x, idle.frame.y, idle.frame.w, idle.frame.h);
    if (idle.trimmed) {
      const trim = idle.spriteSourceSize;
      frame.setTrim(sourceW, sourceH, trim.x, trim.y, trim.w, trim.h);
    }
    const sprite = { x: 500, y: 300, angle: 0, rotation: 0, scaleX: scale, scaleY: scale,
      displayOriginX: sourceW * originX, displayOriginY: sourceH * originY,
      width: sourceW, height: sourceH, frame };
    sprite.body = new Body({ defaults: {}, bounds: {} }, sprite);
    sprite.body.setSize(frame.realWidth - config.widthShrink, frame.realHeight - config.heightShrink, false);
    const remote = Object.assign(Object.create(api.default.prototype), {
      character, opponent: sprite, opFrame: frame, bodyConfig: config,
    });

    for (const flip of [false, true]) {
      sprite.flipX = flip;
      remote.applyFlipOffset();
      sprite.body.updateFromGameObject();
      const standing = { height: sprite.body.height, bottom: sprite.body.bottom, center: sprite.body.center.x };
      const server = characterBody(character, flip);
      close(standing.height, server.height, 'standing height');
      for (const ducking of [true, false]) {
        remote.setDucking(ducking);
        sprite.body.updateFromGameObject();
        close(sprite.body.height, server.height * (ducking ? DUCK_HEIGHT_RATIO : 1), `${ducking ? 'ducking' : 'restored'} height`);
        close(sprite.body.bottom, standing.bottom, 'feet stay planted');
        close(sprite.body.center.x, standing.center, 'horizontal center');
      }
    }
  });
}

test('remote HUD only nudges down while ducking instead of following the collider', () => {
  const sprite = { x: 0, y: 300, height: 120, scaleY: 0.5, _ducking: true,
    body: { y: 340, bottom: 380 } };
  const remote = Object.assign(Object.create(api.default.prototype), {
    opponent: sprite, opFrame: { realHeight: 200 }, bodyConfig: { heightShrink: 40 },
  });
  assert.equal(remote.hudTopY(), 380 - 160 * 0.5 + 8);
  sprite._ducking = false;
  assert.equal(remote.hudTopY(), 340);
  sprite._bbHudTopOffset = -35;
  assert.equal(remote.hudTopY(), 265);
});
