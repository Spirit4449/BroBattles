const test = require('node:test');
const assert = require('node:assert/strict');
const { characterDefinitions, characterFrames, characterPresentation } = require('../src/shared/characters');
const { characterBody } = require('../src/shared/physics/characterBody');
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

for (const character of Object.keys(characterDefinitions)) {
  for (const flip of [false, true]) {
    test(`${character} facing ${flip ? 'left' : 'right'}: hitbox matches the server and anchors sit on it`, () => {
      const sprite = setup(character, flip);
      const bounds = rig.bodyBounds(sprite);
      const server = characterBody(character, flip);
      close(bounds.width, server.width, 'body width');
      close(bounds.height, server.height, 'body height');
      close(bounds.left + bounds.width / 2, sprite.x + server.offsetX, 'body centre x', 1e-4);
      close(bounds.top + bounds.height / 2, sprite.y + server.offsetY, 'body centre y', 1e-4);

      const feet = rig.playerAnchor(sprite, 'feet');
      assert.equal(feet.x, sprite.x, 'the ring and floor effects stand on the sprite position');
      close(feet.y, bounds.bottom, 'feet on the floor');
      assert.equal(rig.playerAnchor(sprite, 'top').x, feet.x, 'the HUD centres over the feet');
      close(rig.playerAnchor(sprite, 'top').y, bounds.top, 'HUD anchored to the hitbox top');

      // A rig's feet are where the art stands: on the sprite position, near the floor.
      const stand = rigOf(character).feet;
      if (stand) {
        const art = rig.spriteArtPoint(sprite, stand);
        close(art.x, sprite.x, 'art feet on the sprite position');
        close(art.y, bounds.bottom, 'art feet on the hitbox bottom', 1e-6);
      }
    });
  }

  test(`${character}: every rig point mirrors about the stand point when it turns`, () => {
    const names = ['feet', ...Object.keys(rigOf(character).points)];
    const frames = ['idle00', 'attack03', 'special01', 'special05'];
    for (const name of names) for (const frameName of frames) {
      const right = setup(character, false), left = setup(character, true);
      right.frame.name = left.frame.name = frameName;
      const a = rig.rigPoint(right, name), b = rig.rigPoint(left, name);
      if (!rigPointArt(character, name, frameName)) { assert.equal(a, null); continue; }
      close(a.x - right.x, -(b.x - left.x), `${name} on ${frameName}`);
      close(a.y, b.y, `${name} height on ${frameName}`);
    }
  });
}

test('rig points resolve per animation frame, holding the last one past the list', () => {
  const tips = characterDefinitions.wizard.rig.points.staffTip;
  assert.deepEqual(rigPointArt('wizard', 'staffTip', 'attack03'), tips.attack[3]);
  assert.deepEqual(rigPointArt('wizard', 'staffTip', 'attack99'), tips.attack[tips.attack.length - 1]);
  assert.deepEqual(rigPointArt('wizard', 'staffTip', 'idle00'), tips.default);
  assert.equal(rigPointArt('wizard', 'nothing', 'idle00'), null);
  assert.equal(rigPointArt('ninja', 'staffTip', 'idle00'), null, 'a point a character does not define is null');
});

test('artToWorld mirrors inside the frame and applies origin and scale', () => {
  const view = { x: 100, y: 50, frameW: 200, frameH: 100, scaleX: 2, scaleY: 2, originX: 0.25, originY: 0.5 };
  assert.deepEqual(artToWorld(view, [50, 50]), { x: 100, y: 50 });
  assert.deepEqual(artToWorld({ ...view, flip: true, originX: 0.75 }, [50, 50]), { x: 100, y: 50 });
  assert.deepEqual(artToWorld(view, [60, 40]), { x: 120, y: 30 });
});

test('nothing but the rig moves a bound player sprite\'s horizontal origin', () => {
  const sprite = setup('wizard', false);
  const { originX, flipOriginX } = sprite.presentation;
  sprite.setOrigin(0.5, 0.5);
  assert.equal(sprite.originX, originX);
  sprite.flipX = true;
  sprite.setOrigin(originX, 0.5);
  assert.equal(sprite.originX, flipOriginX);
});

test('the rig debug overlay marks the anchors and every rig point on the shown frame', () => {
  const { drawRigDebug } = require('../src/client/game/scene/rigDebug.js');
  const calls = [];
  const graphics = new Proxy({}, { get: (_t, key) => (...args) => { calls.push([key, ...args]); } });
  const sprite = setup('wizard', true);
  sprite.active = sprite.visible = true;
  sprite.frame.name = 'attack03';
  drawRigDebug(graphics, [sprite, { active: false }]);
  const boxes = calls.filter(([key]) => key === 'strokeRect');
  assert.equal(boxes.length, Object.keys(characterDefinitions.wizard.rig.points).length);
  const tip = rig.rigPoint(sprite, 'staffTip');
  assert.ok(boxes.some(([, x, y]) => x === tip.x - 3 && y === tip.y - 3), 'staff tip drawn where effects will use it');
  assert.ok(calls.some(([key]) => key === 'fillCircle'), 'hitbox centre');
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

test('the wizard\'s fireball spawns on his staff tip as drawn at the release frame', () => {
  const { launchPoint } = require('../src/shared/characters/characterRig');
  const { getResolvedCharacterAttackConfig } = require('../src/shared/characters/characterTuning');
  const fireball = getResolvedCharacterAttackConfig('wizard', 'fireball');
  // The throw animation's frame at the release (anim.js timings).
  const msPerFrame = index => 1000 / 18 + (index >= 6 ? 80 : 58);
  let frame = 0;
  for (let t = msPerFrame(0); t <= fireball.castDelayMs; t += msPerFrame(++frame));
  for (const flip of [false, true]) {
    const sprite = setup('wizard', flip);
    sprite.frame.name = `attack${String(frame).padStart(2, '0')}`;
    const tip = rig.rigPoint(sprite, 'staffTip');
    for (const angle of [0, -0.6, flip ? Math.PI : 0.5]) {
      const spawn = launchPoint('wizard', fireball.muzzle, { x: sprite.x, y: sprite.y, flip }, angle);
      close(spawn.x, tip.x, `spawn x (flip ${flip})`);
      close(spawn.y, tip.y, `spawn y (flip ${flip})`);
    }
  }
});
