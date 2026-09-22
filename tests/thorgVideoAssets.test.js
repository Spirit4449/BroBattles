const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const atlas = require('../public/assets/thorg/animations.json');
const dependencies = {
  '../shared/animationBuilder': require('../src/characters/shared/animationBuilder'),
  '../../shared/thorgSweep': require('../src/shared/thorgSweep'),
};
const exportsObject = {};
vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/characters/thorg/anim'), 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code, { exports: exportsObject, require: key => dependencies[key] });

test('video atlas respects pose budgets and keeps the original physics dimensions', () => {
  const expected = { idle: 4, running: 8, throw: 12, jumping: 8, falling: 4, powerup: 7, dying: 8, duck: 1, sliding: 1 };
  for (const [prefix, count] of Object.entries(expected)) {
    const frames = atlas.frames.filter(f => f.filename.startsWith(prefix));
    assert.equal(frames.length, count, prefix);
    assert.ok(frames.length <= (prefix === "throw" ? 12 : 8));
    for (const f of frames) {
      assert.deepEqual(f.sourceSize, { w: 128, h: 128 });
      assert.equal(f.bbEmbeddedWeapon, true);
      assert.ok(f.frame.x + f.frame.w <= atlas.meta.size.w);
      assert.ok(f.frame.y + f.frame.h <= atlas.meta.size.h);
    }
    const sources = frames.map(f => `${f.sourceVideo}:${f.sourceFrame}`);
    assert.equal(new Set(sources).size, frames.length, `${prefix}: repeated source frame`);
  }
});

test('fall begins with the exact jump endpoint and alignment', () => {
  const jump = atlas.frames.find(f => f.filename === 'jumping07');
  const fall = atlas.frames.find(f => f.filename === 'falling00');
  assert.equal(fall.sourceVideo, jump.sourceVideo);
  assert.equal(fall.sourceFrame, jump.sourceFrame);
  assert.deepEqual(fall.spriteSourceSize, jump.spriteSourceSize);
  assert.equal(jump.sourceVideo, 'thorg_jump3.mp4');
  assert.ok(atlas.frames.filter(f => f.filename.startsWith('jumping'))
    .every(f => f.sourceVideo === 'thorg_jump3.mp4'));
  assert.ok(atlas.frames.filter(f => f.filename.startsWith('falling') && f.filename !== 'falling00')
    .every(f => f.sourceVideo === 'thorg_fall3.mp4'));
});

test('held poses use the approved green masters at helmet-matched scale', async () => {
  const sharp = require('../spritesheet-generator/node_modules/sharp');
  for (const [name, asset, scale] of [
    ['duck00', 'duck', 52 / 540], ['sliding00', 'wall-slide', 58 / 512],
  ]) {
    const f = atlas.frames.find(f => f.filename === name);
    assert.equal(f.sourceAsset, asset === 'duck' ? 'thorg_duck.png' : 'thorg_slide.png');
    assert.equal(f.importScale, scale);
    assert.equal(f.sourceMirrored, asset === 'wall-slide');
    const { data, info } = await sharp(`public/assets/thorg/${asset}.webp`)
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let bottom = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (!data[i + 3]) continue;
      bottom = Math.max(bottom, y + 1);
      assert.ok(!(data[i + 1] > data[i] + 25 && data[i + 1] > data[i + 2] + 25), 'green background remained');
    }
    assert.equal(bottom, 118);
    const r = f.frame;
    const packed = await sharp('public/assets/thorg/spritesheet.webp')
      .extract({ left: r.x, top: r.y, width: r.w, height: r.h }).ensureAlpha().raw().toBuffer();
    assert.deepEqual(packed, data, `${name} atlas still uses stale artwork`);
  }
});

test('replacement attack uses the new clip and omits long idle and extended-pose holds', () => {
  const frames = atlas.frames.filter(f => f.filename.startsWith('throw'));
  assert.ok(frames.every(f => f.sourceVideo === 'thorg_attack3.mp4'));
  assert.deepEqual(frames.map(f => f.sourceFrame), [
    10, 11, 12, 14, 16, 18, 19, 20, 22, 40, 43, 46,
  ]);
  const track = require('../src/shared/thorgAttackFrames.json');
  assert.deepEqual(track.map(f => f.sourceFrame), frames.map(f => f.sourceFrame));
});

test('spritesheet retains the translucent white sweep instead of keying it out as green', async () => {
  const sharp = require('../spritesheet-generator/node_modules/sharp');
  for (const name of ['throw02', 'throw03', 'throw07']) {
    const f = atlas.frames.find(f => f.filename === name).frame;
    const { data } = await sharp('public/assets/thorg/spritesheet.webp')
      .extract({ left: f.x, top: f.y, width: f.w, height: f.h })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let sweepPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240 &&
          data[i + 3] > 15 && data[i + 3] < 250) sweepPixels++;
    }
    assert.ok(sweepPixels > 100, `${name}: missing translucent sweep (${sweepPixels} pixels)`);
  }
});

function setup(data, name = 'thorg') {
  const created = new Map();
  const scene = {
    textures: { get: () => ({ customData: { meta: data.meta }, getFrameNames: () => data.frames.map(f => f.filename) }) },
    anims: { exists: key => created.has(key), remove: key => created.delete(key),
      create(config) { created.set(config.key, config); return config; } },
  };
  exportsObject.animations(scene, name);
  return created;
}

test('video run keeps source order; attack frame durations match the combat clock', () => {
  const created = setup(atlas);
  const run = created.get('thorg-running');
  assert.deepEqual(Array.from(run.frames, f => f.frame), Array.from({ length: 8 }, (_, n) => `running0${n}`));
  assert.equal(run.frameRate, 16);
  const attack = created.get('thorg-throw');
  const durations = Array.from(attack.frames, f => 1000 / attack.frameRate + f.duration);
  const sum = xs => xs.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum(durations.slice(0, 1)) - 70) < 1e-8);
  assert.ok(Math.abs(sum(durations.slice(1, 9)) - 500) < 1e-8);
  assert.equal(sum(durations.slice(9)), 300);
  assert.equal(created.get('thorg-jumping').frameRate, 24);
  assert.equal(created.get('thorg-falling').frameRate, 8);
  assert.equal(attack.duration, 870);
  assert.equal(created.get('thorg-dying').repeat, 0);
});

test('legacy skins retain their original frame order and rates', () => {
  const legacy = require('../public/assets/thorg/skins/thorg-storm/animations.json');
  const created = setup(legacy, 'thorg-storm');
  assert.equal(created.get('thorg-storm-running').frameRate, 8);
  assert.equal(created.get('thorg-storm-idle').frameRate, 6);
  assert.equal(created.has('thorg-storm-dying'), false); // No death art in this skin.
  assert.ok(created.get('thorg-storm-throw').frames.length <= 5);
  for (const animation of created.values()) {
    assert.ok(animation.frames.every(f => f.key === 'thorg-storm'));
  }
});
