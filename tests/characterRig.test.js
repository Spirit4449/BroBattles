const { loadClientModule } = require('./helpers/clientModule');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

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

  test('resized Ninja and Sparrow keep client hitboxes aligned with server bounds and rig feet', () => {
    const { characterBody } = require('../src/shared/physics/characterBody');
    for (const character of ['ninja', 'sparrow']) for (const flip of [false, true]) {
      const sprite = setup(character, flip);
      const server = characterBody(character, flip);
      const left = sprite.x + (sprite.body.offset.x - sprite.displayOriginX) * sprite.scaleX;
      const top = sprite.y + (sprite.body.offset.y - sprite.displayOriginY) * sprite.scaleY;
      close(sprite.body.width, server.width, `${character} width`);
      close(sprite.body.height, server.height, `${character} height`);
      close(left + sprite.body.width / 2, sprite.x + server.offsetX, `${character} center x`);
      close(top + sprite.body.height / 2, sprite.y + server.offsetY, `${character} center y`);
      const feet = rig.spriteArtPoint(sprite, rigPointArt(character, 'feet'));
      close(feet.y, top + sprite.body.height, `${character} grounded feet`);
    }
  });

  test('the ozzy\'s fireball spawns on his staff tip as drawn at the release frame', () => {
    const { launchPoint } = require('../src/shared/characters/characterRig');
    const { getResolvedCharacterAttackConfig } = require('../src/shared/characters/characterTuning');
    const fireball = getResolvedCharacterAttackConfig('ozzy', 'fireball');
    // The throw animation's frame at the release (anim.js plays ozzyThrowFrameMs).
    const { ozzyThrowFrameMs } = require('../src/shared/characters/ozzyCharge');
    const { rigOf } = require('../src/shared/characters/characterRig');
    const ms = ozzyThrowFrameMs(rigOf('ozzy').points.staffTip.attack.length);
    let frame = 0;
    for (let t = ms[0]; t <= fireball.castDelayMs; t += ms[++frame]);
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
  const { characterBody } = require('../src/shared/physics/characterBody');
  const { spritePresentation } = require('../src/client/game/characters/shared/spritePresentation');
  const { DUCK_HEIGHT_RATIO } = require('../src/shared/physics/ducking');
  const atlas = require('../public/assets/thorg/animations.json');

  const api = {};
  loadClientModule(require.resolve('../src/client/game/players/RemotePlayer'), { exports: api, require: id => id === '../../../shared/physics/ducking.js'
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

test('overhead HUD measures the head without catching a nearby staff plume', (t) => {
  const { spritePresentation } = require('../src/client/game/characters/shared/spritePresentation');
  // Draven's idle art has a hood over the standing point and a taller plume
  // just to its right. Model the alpha sampling performed by the canvas.
  const frame = { realWidth: 207, realHeight: 207, x: 0, y: 0,
    cutX: 0, cutY: 207, cutWidth: 207, cutHeight: 207 };
  let sample;
  const previousDocument = globalThis.document;
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  globalThis.document = { createElement: () => ({ getContext: () => ({
    drawImage(_source, x, y, width, height) { sample = { x, y, width, height }; },
    getImageData() {
      const { x, width, height } = sample;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
        const artX = x + col;
        const hood = artX >= 101 && artX <= 110 && row >= 108 && row <= 120;
        const plume = artX >= 114 && artX <= 124 && row >= 86 && row <= 108;
        if (hood || plume) data[(row * width + col) * 4 + 3] = 255;
      }
      return { data };
    },
  }) }) };
  for (const key of ['draven', 'draven-test-skin']) {
    const texture = { key, has: () => true, get: () => frame, getSourceImage: () => ({}) };
    const presentation = spritePresentation('draven', texture);
    const measuredHead = presentation.hudTopOffset / presentation.scale + frame.realHeight * presentation.originY;
    assert.ok(Math.abs(measuredHead - 108) < 1e-6, `${key} anchors to the hood, not the plume`);
    assert.equal(spritePresentation('draven', texture).hudTopOffset, presentation.hudTopOffset,
      'the idle anchor remains stable on repeated presentation setup');
  }
});
