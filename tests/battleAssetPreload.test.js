const { loadClientModule } = require('./helpers/clientModule');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');


describe("Selection warming", () => {
  const { mapDefaults } = require('../src/shared/maps');
  const { sceneryUrls } = require('../src/shared/maps/scenery');

  function setup() {
    const state = { urls: [], mode: null, card: null, roster: null };
    const window = { __BB_NAVIGATION__: {
      preload: urls => { state.urls = Array.from(urls); }, selectPreloadMode: mode => { state.mode = mode; },
    } };
    const context = vm.createContext({
      window, mapDefaults, sceneryUrls,
      warmEquippedPlayerCard: card => { state.card = card; },
      warmRosterPlayerCards: cards => { state.roster = cards; },
      buildCharacterSkinAtlasUrls: (character, skin) => ({ animationsUrl: `/assets/${character}/${skin || 'base'}.json`, spritesheetUrl: `/assets/${character}/${skin || 'base'}.webp` }),
      buildCharacterSkinWeaponUrl: (character, skin) => skin ? `/assets/${character}/${skin}-weapon.webp` : null,
    });
    const api = loadClientModule(require.resolve('../src/client/lobby/preloadBattle.js'), {
      window, require: name => name.includes('skinAssets') ? {
        buildCharacterSkinAtlasUrls: context.buildCharacterSkinAtlasUrls,
        buildCharacterSkinWeaponUrl: context.buildCharacterSkinWeaponUrl,
      } : name.includes('playerCardAnimation') ? {
        warmEquippedPlayerCard: context.warmEquippedPlayerCard, warmRosterPlayerCards: context.warmRosterPlayerCards,
      } : name.includes('scenery') ? { sceneryUrls } : { mapDefaults },
    });
    return { state, window, warm: api.warmBattleSelection };
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

  test('a matched roster warms every player card before the battle loads', () => {
    const { state, warm } = setup();
    warm({ modeId: 'duels', modeVariantId: 'duels-2v2', mapId: 1 }, [
      { name: 'a', char_class: 'ninja', selected_card_id: 'arena-crown' },
      { name: 'bot', char_class: 'wizard', selected_card_id: 'radiant-gold' },
      { name: 'c', char_class: 'thorg' },
    ]);
    assert.deepEqual(state.roster, ['arena-crown', 'radiant-gold', null]);
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

  test('the equipped card warms even before a lobby mode selection is available', () => {
    const { state, window, warm } = setup();
    window.__BRO_BATTLES_USERDATA__ = { name: 'self', selected_card_id: 'arena-crown' };
    warm();
    assert.equal(state.card, 'arena-crown');
    assert.deepEqual(state.urls, []);
    window.__BRO_BATTLES_USERDATA__.selected_card_id = 'default';
    warm();
    assert.equal(state.card, 'default');
  });
});

describe("Character assets", () => {
  const root = path.resolve(__dirname, '..');

  // Run real preload methods without initializing sockets or browser renderers.
  function loadModule(file) {
    const exports = {};

    loadClientModule(require.resolve(path.join(root, file)), {
      exports,
      Phaser: { Loader: { Events: { COMPLETE: 'complete' } } },
      require(name) {
        if (name.includes('characterEntityBase')) return loadModule('src/client/game/characters/shared/characterEntityBase.js');
        if (name.includes('characterTuning')) return require('../src/shared/characters/characterTuning.js');
        return {};
      },
    });
    return { __esModule: true, ...exports };
  }

  const manifest = loadClientModule(require.resolve('../src/client/game/characters/manifest.js'), {
    require: name => loadModule(path.relative(root, path.resolve(root, 'src/client/game/characters', name))),
  }).default;
  test("all character preload variants resolve their declared assets", () => {
    assert.deepEqual(Array.from(manifest, Character => Character.key).sort(),
      Object.keys(require('../src/shared/characters').characterDefinitions).sort(), 'the actual registry covers the shared roster');
    for (const Character of manifest) {
      const character = Character.key;
    for (const includeBaseAtlas of [true, false]) {
      {
        const queued = [];
        const load = Object.fromEntries(['image', 'audio', 'spritesheet', 'atlas'].map(type =>
          [type, (key, url, atlas) => queued.push({ type, key, urls: type === 'atlas' ? [url, atlas] : [url].flat() })]));
        load.on = () => {};
        Character.preload({ load, sound: { get: () => null } }, '/assets', { includeBaseAtlas });
        assert.ok(queued.length > 0);
        for (const { type, key, urls } of queued) {
          for (const url of urls) {
            const file = path.join(root, 'public', url);
            assert.ok(fs.existsSync(file), `${key}: ${url}`);
            const bytes = fs.readFileSync(file);
            assert.ok(bytes.length > 0, `${key}: empty ${url}`);
            if (url.endsWith('.webp')) {
              assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', url);
              assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', url);
            }
            if (type === 'atlas' && url.endsWith('.json')) assert.ok(JSON.parse(bytes).frames, url);
          }
        }
        if (character === 'gloop') {
          for (const key of ['gloop-slimeball', 'gloop-slimeball-attack', 'gloop-hand']) {
            assert.ok(!queued.some(asset => asset.key === key), `obsolete texture queued: ${key}`);
          }
          for (const key of ['gloop-hand-grip-source', 'gloop-hand-open', 'gloop-hand-closed']) {
            assert.ok(queued.some(asset => asset.key === key), `active hand texture missing: ${key}`);
          }
        }
      }
    }
  }
});
});

describe("Shared game assets", () => {
  function loadPreloader() {
    const exports = {};

    loadClientModule(require.resolve('../src/client/game/scene/preloadGameAssets.js'), { exports, require: name => {
      if (name.includes('shared/powerups')) return require('../src/shared/powerups');
      return { preloadTerrainAudio() {} };
    } });
    return exports.preloadGameAssets;
  }

  function makeLoaderQueue() {
    const queued = [];
    const load = Object.fromEntries(['image', 'audio', 'atlas', 'tilemapTiledJSON', 'spritesheet'].map(type =>
      [type, key => queued.push(key)]));
    return { load, queued };
  }

  test('game asset preload completes with the Phaser 3.70 loader API (no font method)', () => {
    const preloadGameAssets = loadPreloader();
    const { load, queued } = makeLoaderQueue();
    let charactersLoaded = false;
    assert.doesNotThrow(() => preloadGameAssets({ scene: { load }, staticPath: '/assets',
      powerupTypes: ['health', 'shockwave', 'freeze'], powerupAssetDir: { health: 'health', shockwave: 'shockwave', freeze: 'freeze' },
      preloadAllCharacters() { charactersLoaded = true; } }));
    assert.ok(charactersLoaded);
    assert.ok(queued.includes('sfx-nosuper'), 'preloads the super-not-ready cue');
    assert.ok(queued.includes('pu-tick-health'), 'powerups with periodic effects preload their tick sound');
    assert.ok(queued.includes('pu-tick-freeze'), 'freeze preloads its ambient tick sound');
    assert.ok(!queued.includes('pu-tick-shockwave'), 'instant shockwave does not preload a nonexistent tick sound');
  });

  test('shared assets resolve for every powerup', () => {
    const path = require('node:path');
    const { POWERUP_CATALOG } = require('../src/shared/powerups');
    const preloadGameAssets = loadPreloader();
    {
      const urls = [];
      const load = Object.fromEntries(['image', 'audio', 'atlas', 'tilemapTiledJSON', 'spritesheet'].map(type =>
        [type, (key, url, data) => {
          urls.push(...[url].flat());
          if (type === 'atlas') urls.push(data);
        }]));
      preloadGameAssets({ scene: { load }, staticPath: '/assets',
        powerupTypes: Object.keys(POWERUP_CATALOG),
        powerupAssetDir: Object.fromEntries(Object.entries(POWERUP_CATALOG).map(([key, value]) => [key, value.assetDir])),
        preloadAllCharacters() {} });
      for (const url of urls) {
        assert.ok(fs.existsSync(path.join(__dirname, '../public', url)), url);
      }
    }
  });
});
