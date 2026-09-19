const test = require('node:test');
const assert = require('node:assert/strict');
const { applyTeamVisual, teamColor, materialPixel, TEAM_GREEN, TEAM_RED } = require('../src/shared/projectilePresentation');

test('allied indicators are green and friendly attacks retain exact source colors and renderer', () => {
  assert.equal(teamColor(null), TEAM_GREEN);
  for (const color of [0x209dff, 0xffffff, 0x4215b8, 0x11bbaa]) {
    assert.equal(materialPixel(color, TEAM_GREEN, null), color);
  }
  const renderCanvas = () => {};
  const sprite = { renderCanvas };
  applyTeamVisual(sprite, null, true);
  assert.equal(sprite.renderCanvas, renderCanvas);
});

test('material palettes preserve crown gold and arrow shafts, edit only gems and tips', () => {
  assert.equal(materialPixel(0xffcc22, TEAM_GREEN, 'crown'), 0xffcc22);
  assert.equal(materialPixel(0xd91925, TEAM_RED, 'crown'), 0xd91925);
  const blueGem = materialPixel(0xd91925, TEAM_GREEN, 'crown');
  assert.ok((blueGem & 255) > (blueGem >> 16));
  assert.equal(materialPixel(0x775544, TEAM_RED, 'arrow', 40, 200), 0x775544);
  const tip = materialPixel(0xcccccc, TEAM_RED, 'arrow', 190, 200);
  assert.ok((tip >> 16) > (tip & 255));
  assert.notEqual(materialPixel(0xaaaaaa, TEAM_GREEN, 'weapon'), materialPixel(0xaaaaaa, TEAM_RED, 'weapon'));
});

test('enemy rendering restores the original frame and never applies a drop shadow', () => {
  const ctx = {};
  const frame = {};
  const sprite = { frame, renderCanvas() { throw new Error('render failure'); } };
  applyTeamVisual(sprite, { _bbTeamColor: TEAM_RED }, true, "weapon");
  assert.throws(() => sprite.renderCanvas({ currentContext: ctx }, sprite, {}), /render failure/);
  assert.equal(sprite.frame, frame);
  assert.deepEqual(ctx, {});
});

test('wizard fireball factory creates an animated sprite before team presentation', () => {
  const fs = require('node:fs'), vm = require('node:vm'), babel = require('@babel/core');
  const source = fs.readFileSync('src/characters/wizard/attack.js', 'utf8') + '\nexport { createFireballSprite };';
  const code = babel.transformSync(source, { babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }).code;
  const api = {};
  vm.runInNewContext(code, { exports: api, require: name => {
    if (name.includes('characterTuning')) return require('../src/shared/characterTuning');
    if (name.includes('projectilePresentation')) return require('../src/shared/projectilePresentation');
    if (name.includes('renderLayers')) return { RENDER_LAYERS: { ATTACKS: 10 } };
    return {};
  }});
  let animation;
  const sprite = { texture: { setFilter() {} }, anims: { play(key) { animation = key; } },
    setDepth() {}, setOrigin() {}, setScale() {}, setAngle() {} };
  const scene = { textures: { exists: () => true }, add: { sprite: () => sprite },
    anims: { exists: () => true } };
  assert.equal(api.createFireballSprite(scene, 50, 60, -1), sprite);
  assert.equal(animation, 'wizard-fireball-unified:flight');
  applyTeamVisual(sprite, { _bbTeamColor: TEAM_RED }, true);
  assert.equal(teamColor(sprite), TEAM_RED);
});
