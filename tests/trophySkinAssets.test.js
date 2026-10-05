const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const skins = require('../src/shared/catalogs/skinsCatalog.json');
const root = path.resolve(__dirname, '..');
const file = url => path.join(root, 'public', url);

for (const [character, id] of [['ninja', 'ninja-arena-sovereign'], ['gloop', 'gloop-amethyst']]) {
  test(`${id}: dedicated art provides its playable animation frames`, () => {
    const skin = skins.characters[character].skins.find(skin => skin.id === id);
    const base = skins.characters[character].skins.find(skin => skin.id.endsWith('-default'));
    assert.notEqual(skin.gameAssets.spritesheetUrl, base.gameAssets.spritesheetUrl);
    assert.equal(skin.gameAssets.palette, undefined);
    for (const asset of [skin.assetUrl, skin.gameAssets.spritesheetUrl, skin.gameAssets.animationsUrl]) assert.ok(fs.existsSync(file(asset)), asset);
    const atlas = JSON.parse(fs.readFileSync(file(skin.gameAssets.animationsUrl)));
    const original = JSON.parse(fs.readFileSync(file(base.gameAssets.animationsUrl)));
    const logicalFrames = frames => frames.map(({frame, ...rest}) => ({...rest, width:frame.w, height:frame.h}));
    if (character === 'ninja') {
      // This skin uses the legacy 72px animation set, with throw poses instead of base attack/special poses.
      const required = ['idle', 'running', 'jumping', 'falling', 'dying', 'throw']
        .flatMap((name, group) => Array.from({length: [5, 7, 9, 4, 5, 4][group]}, (_, i) => `${name}${String(i).padStart(2, '0')}`));
      required.push('wall00', 'duck00');
      assert.equal(atlas.frames.length, required.length);
      assert.deepEqual(new Set(atlas.frames.map(frame => frame.filename)), new Set(required));
      for (const entry of atlas.frames) {
        assert.equal(entry.frame.w, 72, entry.filename);
        assert.equal(entry.frame.h, 72, entry.filename);
        assert.deepEqual(entry.sourceSize, {w: 72, h: 72}, entry.filename);
      }
    } else {
      // Gloop's skin retains the base animation names and logical frame sizes.
      assert.deepEqual(logicalFrames(atlas.frames), logicalFrames(original.frames));
    }
    for (const {frame} of atlas.frames) {
      assert.ok(frame.x >= 0 && frame.y >= 0);
      assert.ok(frame.x + frame.w <= atlas.meta.size.w);
      assert.ok(frame.y + frame.h <= atlas.meta.size.h);
    }
    if (character === 'ninja') {
      for (let i = 0; i < atlas.frames.length; i++) {
        const a = atlas.frames[i].frame;
        for (const {frame:b} of atlas.frames.slice(i+1)) {
          assert.ok(a.x+a.w+16<=b.x || b.x+b.w+16<=a.x || a.y+a.h+16<=b.y || b.y+b.h+16<=a.y, 'king frames need 16px gutters');
        }
      }
    }
    assert.notDeepEqual(fs.readFileSync(file(skin.gameAssets.spritesheetUrl)), fs.readFileSync(file(base.gameAssets.spritesheetUrl)));
  });
}

test('currency artwork scales through all six levels and ships every selected asset', () => {
  const source = fs.readFileSync(path.join(root,'src/client/views/rewardPresentation.js'),'utf8').replaceAll('export function','function');
  const api = vm.runInNewContext(source+'; ({currencyRewardImage, rewardSound})');
  for (const [currency, amounts] of [['coins',[100,400,1000,2500,5000,10000]],['gems',[10,20,60,150,400,1000]]]) {
    const assets=amounts.map(amount=>api.currencyRewardImage(currency,amount));
    assert.equal(new Set(assets).size,6);
    for(const asset of assets)assert.ok(fs.existsSync(file(asset)),asset);
  }
  assert.equal(api.rewardSound([{kind:'currency',currency:'gems',amount:20}],'rare'),'rewardGems');
  assert.equal(api.rewardSound([{kind:'skin'}],'epic'),'rewardEpic');
  assert.equal(api.rewardSound([{kind:'skin'}],'legendary'),'rewardLegendary');
});

test('every multi-reward milestone has a unified bundle illustration', () => {
  const track=require('../src/server/services/trophies/trophySystem').buildTrophyRewardTrack();
  for(const tier of track.filter(tier=>tier.rewards.length>1))assert.ok(fs.existsSync(file(`/assets/reward-bundles/milestone-${tier.trophiesRequired}.webp`)),tier.tierId);
});
