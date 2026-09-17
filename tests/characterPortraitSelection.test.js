const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const controller = fs.readFileSync('src/lobby/characterSelectController.js', 'utf8');
const portraitSource = fs.readFileSync('src/lib/bodyPortraitAssets.js', 'utf8');
function loadFunction(name, context) {
  const start = controller.indexOf(`function ${name}(`);
  const end = controller.indexOf('\n}', start) + 2;
  return vm.runInNewContext(controller.slice(start, end) + `; ${name}`, context);
}
test('selection cards use equipped skin, not an unconfirmed preview skin', () => {
  const portrait = loadFunction('equippedCharacterPortrait', {
    buildCharacterSkinBodyUrl: (character, skin) => skin || `${character}-default`,
    buildFramedBodyPortrait: (character, url) => `framed:${character}:${url}`,
  });
  assert.equal(portrait('gloop', {selected_skin_id_by_char:{gloop:'gloop-amethyst'}}), 'framed:gloop:gloop-amethyst');
  assert.equal(portrait('gloop', {}), 'framed:gloop:gloop-default');
});
test('detail previews resolve current bundled Gloop body for base and skin', () => {
  const preview = loadFunction('resolveCharacterPreviewAsset', {
    getCharacterSkinList: () => [{id:'gloop-default',previewSrc:'base'}, {id:'gloop-amethyst',previewSrc:'amethyst'}],
    buildCharacterSkinBodyUrl: () => 'fallback', resolveBodyPortrait: url => `bundled:${url}`,
  });
  assert.equal(preview('gloop','gloop-default'),'bundled:base');
  assert.equal(preview('gloop','gloop-amethyst'),'bundled:amethyst');
});
test('bundled portrait imports exist and cover all catalog bodies', () => {
  const catalog = require('../src/shared/skinsCatalog.json');
  for (const entry of Object.values(catalog.characters)) for (const skin of entry.skins) {
    assert.ok(portraitSource.includes(`public${skin.assetUrl}?portrait`),skin.id);
    assert.ok(fs.existsSync(`public${skin.assetUrl}`),skin.id);
  }
});

test('framed skin portrait keeps the original rim, backdrop and embedded body', async () => {
  const { BRO_PORTRAIT_PALETTES, buildBroPortraitSvg } = await import('../src/lib/broPortrait.mjs');
  const source = portraitSource.replace(/^import .*;\n/gm, '').replaceAll('export function', 'function');
  const context = { BRO_PORTRAIT_PALETTES, buildBroPortraitSvg };
  for (let i = 0; i < 10; i++) context[`body${i}`] = `data:image/webp;base64,body${i}`;
  const api = vm.runInNewContext(source + '; ({buildFramedBodyPortrait})', context);
  const url = api.buildFramedBodyPortrait('gloop', '/assets/gloop/skins/gloop-amethyst/body.webp');
  const svg = decodeURIComponent(url.slice('data:image/svg+xml,'.length));
  assert.ok(svg.includes('data:image/webp;base64,body9'));
  assert.ok(svg.includes('fill="url(#rim)"'));
  assert.ok(svg.includes('fill="#020504"'));
  assert.ok(svg.includes(BRO_PORTRAIT_PALETTES.gloop.main));
});

test('skin arrows save owned skins without closing, preview locked skins, and roll back failures', async () => {
  const start = controller.indexOf('async function setSelectedSkin(');
  const end = controller.indexOf('\n}', start) + 2;
  const ui = {currentCharacter:'gloop', selectedSkinByCharacter:{gloop:'base'}};
  const calls = [];
  let succeeds = true;
  const context = {
    _characterDetailsUi:ui, _characterSelectionPromise:null,
    blockCharacterChangeWhileReady:()=>false, normalizeCharacterId:x=>x,
    getCharacterSkinList:()=>[{id:'base'},{id:'amethyst'},{id:'locked',locked:true}],
    getSelectedSkin:()=>({id:ui.selectedSkinByCharacter.gloop}),
    renderCharacterDetails:()=>{throw new Error("Skin cycling must not rebuild the view");},
    updateSkinDetails:()=>{},
    selectCharacter:async (character, options)=>{calls.push({character, close:options.closeAfterSelection});return succeeds;},
  };
  const step = vm.runInNewContext(controller.slice(start,end)+'; setSelectedSkin', context);
  await step('gloop','amethyst');
  assert.equal(ui.selectedSkinByCharacter.gloop,'amethyst');
  assert.equal(calls.length,1);
  assert.equal(calls[0].close,false);
  await step('gloop','locked');
  assert.equal(calls.length,1);
  assert.equal(ui.selectedSkinByCharacter.gloop,'locked');
  succeeds=false;
  await step('gloop','base');
  assert.equal(ui.selectedSkinByCharacter.gloop,'locked');
  context._characterSelectionPromise=Promise.resolve();
  await step('gloop','amethyst');
  assert.equal(calls.length,2);
});


test('leaving expanded details flushes deferred selection rendering once', () => {
  let renders = 0;
  const context = {
    _characterDetailsUi: {
      popup:{classList:{remove(){}}}, overlay:{classList:{add(){}},setAttribute(){}},
      currentCharacter:'gloop', selectedSkinByCharacter:{gloop:'amethyst'},
    },
    _upgradePreview:null, _pendingUpgradeAnimation:null,
    _deferredSkinRender:()=>{renders++;},
    disposeSkinCarousel:()=>{},
  };
  const hide = loadFunction('hideCharacterDetails', context);
  hide();
  assert.equal(renders,1);
  assert.equal(context._characterDetailsUi.currentCharacter,null);
  hide();
  assert.equal(renders,1);
});
