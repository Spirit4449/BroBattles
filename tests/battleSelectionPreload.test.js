const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { mapDefaults } = require('../src/shared/maps');
const { sceneryUrls } = require('../src/shared/maps/scenery');

function setup() {
  const state = { urls: [], mode: null };
  const window = { __BB_NAVIGATION__: {
    preload: urls => { state.urls = Array.from(urls); }, selectPreloadMode: mode => { state.mode = mode; },
  } };
  const context = vm.createContext({
    window, mapDefaults, sceneryUrls,
    buildCharacterSkinAtlasUrls: (character, skin) => ({ animationsUrl: `/assets/${character}/${skin || 'base'}.json`, spritesheetUrl: `/assets/${character}/${skin || 'base'}.webp` }),
    buildCharacterSkinWeaponUrl: (character, skin) => skin ? `/assets/${character}/${skin}-weapon.webp` : null,
  });
  const source = fs.readFileSync(require.resolve('../src/client/lobby/preloadBattle.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  vm.runInContext(source, context);
  return { state, window, warm: context.warmBattleSelection };
}

test('selection warming includes only the selected map and roster characters', () => {
  const { state, warm } = setup();
  warm({ modeId: 'bank-bust', modeVariantId: 'bank-bust-3v3', mapId: 4 }, [
    { char_class: 'ninja', selected_skin_id: 'ninja-blue' }, { char_class: 'Random' }, { char_class: 'shuffle' },
  ]);
  assert.equal(state.mode, 'bank-bust');
  const map = mapDefaults.find(entry => entry.id === 4);
  for (const url of [...Object.values(map.assets).map(asset => asset.url), ...sceneryUrls(map.scenery)]) {
    assert.ok(state.urls.includes(url), url);
  }
  assert.ok(state.urls.includes('/assets/ninja/base.webp'));
  assert.ok(state.urls.includes('/assets/ninja/ninja-blue.webp'));
  assert.ok(!state.urls.some(url => /wizard|shuffle|random/i.test(url)));
});

test('confirmed solo character changes replace stale roster skin assets', () => {
  const { state, window, warm } = setup();
  window.__BRO_BATTLES_USERDATA__ = { name: 'self', char_class: 'ninja', selected_skin_id_by_char: { ninja: 'blue' } };
  warm({ modeId: 'duels', modeVariantId: 'duels-1v1', mapId: 1 }, [{ name: 'self', char_class: 'ninja', selected_skin_game_assets: { spritesheetUrl: '/assets/old-custom.webp' } }]);
  assert.ok(state.urls.includes('/assets/old-custom.webp'));
  window.__BRO_BATTLES_USERDATA__.char_class = 'wizard';
  window.__BRO_BATTLES_USERDATA__.selected_skin_id_by_char.wizard = 'gold';
  warm();
  assert.ok(state.urls.includes('/assets/wizard/gold.webp'));
  assert.ok(!state.urls.some(url => /old-custom|ninja/.test(url)));
});
