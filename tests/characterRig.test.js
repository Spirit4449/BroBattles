const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

describe("Rig anchors and projectile origins", () => {
  const { characterDefinitions, characterFrames, characterPresentation } = require('../src/shared/characters');

  const { rigOf, rigPointArt, artToWorld } = require('../src/shared/characters/characterRig');
  const { spritePresentation } = require('../src/client/game/characters/shared/spritePresentation');
  const rig = require('../src/client/game/characters/shared/rig.js');

  // A Phaser-like sprite with an Arcade-style body, set up the way localPlayer
  // and RemotePlayer do it (setSize from the shrink, offset from applyFlipOffset).
  class FakeSprite {
    constructor(character) {
      const art = characterPresentation(character).hiResArt;
      const frameW = art?.sourceSize || characterFrames[character].w;
      const frameH = art?.sourceSize || characterFrames[character].h;
      const texture = { key: character, has: () => true, get: () => ({ width: frameW }) };
      this.presentation = spritePresentation(character, texture);
      Object.assign(this, { _bbCharacter: character, x: 400, y: 300, flipX: false,
        frame: { name: 'idle00', realWidth: frameW, realHeight: frameH }, scaleX: this.presentation.scale, scaleY: this.presentation.scale });
      const cfg = this.presentation.body;
      const bw = Math.max(4, frameW - cfg.widthShrink), bh = Math.max(4, frameH - cfg.heightShrink);
      this.body = { sourceWidth: bw, sourceHeight: bh, width: bw * this.scaleX, height: bh * this.scaleY,
        offset: { x: 0, y: 0 }, setOffset(x, y) { this.offset = { x, y }; } };
      this.setOrigin(this.presentation.originX, this.presentation.originY);
    }
    setOrigin(x = 0.5, y = x) { this.originX = x; this.originY = y; return this; }
    get displayOriginX() { return this.originX * this.frame.realWidth; }
    get displayOriginY() { return this.originY * this.frame.realHeight; }
    // localPlayer's applyFlipOffsetLocal.
    applyFlipOffset() {
      const cfg = this.presentation.body;
      const bodyW = cfg.sourceUnits ? this.body.sourceWidth : this.body.width;
      const ox = this.frame.realWidth / 2 - bodyW / 2 + (cfg.offsetXFromHalf ?? 0) + (this.flipX ? cfg.flipOffset || 0 : 0);
      this.body.setOffset(ox, cfg.offsetY);
    }
  }

  function setup(character, flip) {
    const sprite = new FakeSprite(character);
    sprite.applyFlipOffset();
    rig.bindPlayerOrigin(sprite, sprite.presentation);
    sprite.flipX = flip;
    sprite.applyFlipOffset();
    return sprite;
  }

  const close = (a, b, message, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`);

  test('nothing but the rig moves a bound player sprite\'s horizontal origin', () => {
    const sprite = setup('ozzy', false);
    const { originX, flipOriginX } = sprite.presentation;
    sprite.setOrigin(0.5, 0.5);
    assert.equal(sprite.originX, originX);
    sprite.flipX = true;
    sprite.setOrigin(originX, 0.5);
    assert.equal(sprite.originX, flipOriginX);
  });

  test('server-side rig points land exactly where the drawn sprite shows them, for every character', () => {
    const { rigWorldPoint } = require('../src/shared/characters/characterRig');
    for (const character of Object.keys(characterDefinitions)) for (const flip of [false, true]) {
      const sprite = setup(character, flip);
      const points = ['feet', ...Object.keys(rigOf(character).points)];
      for (const name of points) {
        const art = rigPointArt(character, name, 'idle00');
        if (!art) continue;
        const drawn = rig.spriteArtPoint(sprite, art);
        const server = rigWorldPoint(character, { x: sprite.x, y: sprite.y, flip }, art);
        close(server.x, drawn.x, `${character} ${name} x (flip ${flip})`, 1e-6);
        close(server.y, drawn.y, `${character} ${name} y (flip ${flip})`, 1e-6);
      }
    }
  });

  test('the ozzy\'s fireball spawns on his staff tip as drawn at the release frame', () => {
    const { launchPoint } = require('../src/shared/characters/characterRig');
    const { getResolvedCharacterAttackConfig } = require('../src/shared/characters/characterTuning');
    const fireball = getResolvedCharacterAttackConfig('ozzy', 'fireball');
    // The throw animation's frame at the release (anim.js timings).
    const msPerFrame = index => 1000 / 18 + (index >= 6 ? 80 : 58);
    let frame = 0;
    for (let t = msPerFrame(0); t <= fireball.castDelayMs; t += msPerFrame(++frame));
    for (const flip of [false, true]) {
      const sprite = setup('ozzy', flip);
      sprite.frame.name = `attack${String(frame).padStart(2, '0')}`;
      const tip = rig.rigPoint(sprite, 'staffTip');
      for (const angle of [0, -0.6, flip ? Math.PI : 0.5]) {
        const spawn = launchPoint('ozzy', fireball.muzzle, { x: sprite.x, y: sprite.y, flip }, angle);
        close(spawn.x, tip.x, `spawn x (flip ${flip})`);
        close(spawn.y, tip.y, `spawn y (flip ${flip})`);
      }
    }
  });
});

describe("Trimmed collider parity", () => {
  const Frame = require('phaser/src/textures/Frame');
  const Body = require('phaser/src/physics/arcade/Body');
  const { characterBody } = require('../src/shared/physics/duelGeometry');
  const { spritePresentation } = require('../src/client/game/characters/shared/spritePresentation');
  const { DUCK_HEIGHT_RATIO } = require('../src/shared/physics/ducking');
  const atlas = require('../public/assets/thorg/animations.json');

  const api = {};
  vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/players/RemotePlayer'), 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code, { exports: api, require: id => id === '../../../shared/physics/ducking.js'
    ? { DUCK_HEIGHT_RATIO }
    : id === '../../../shared/characters/index.js' ? require('../src/shared/characters')
    : { playDuckTransitionSound() {} } });

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

});
