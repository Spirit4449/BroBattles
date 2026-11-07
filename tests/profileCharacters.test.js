const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLobbyFixture } = require('./helpers/lobbyFixture');

test('skin picker saves owned choices once, previews locked choices and rolls back failed saves without closing', async () => {
  const catalog = structuredClone(require('../src/shared/catalogs/skinsCatalog.json'));
  const skins = catalog.characters.gloop.skins;
  skins.push({ ...skins[1], id: 'locked-test-skin', name: 'Locked preview' });
  const user = { name: 'Owner', char_class: 'gloop', char_levels: { gloop: 1 },
    owned_skin_ids: [skins[1].id], selected_skin_id_by_char: { gloop: skins[0].id } };
  const saves = [];
  let completeSave;
  const f = createLobbyFixture({
    imports: { [path.resolve(__dirname, '../src/shared/catalogs/skinsCatalog.json')]: catalog },
    globals: { fetch: async (url, options = {}) => {
      if (url === '/skins/owned') return { ok: true, json: async () => ({ ownedSkinIds: user.owned_skin_ids }) };
      if (url === '/skins/select') {
        saves.push(JSON.parse(options.body));
        return new Promise(resolve => { completeSave = success => resolve({ ok: success, json: async () => ({ success, error: 'Save failed' }) }); });
      }
      throw new Error(`Unexpected request ${url}`);
    } },
  });
  const api = f.load('src/client/lobby/profile/characterSelectController.js');
  api.initializeCharacterSelect(user);
  await f.settle();
  api.openCharacterSelect();
  f.document.querySelector('[data-char="gloop"]').click();
  const next = () => f.document.querySelector('[aria-label="Next skin"]').click();
  const preview = () => f.document.querySelector('.character-details-skin-name-text').textContent;
  next(); next();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].skinId, skins[1].id);
  assert.equal(user.selected_skin_id_by_char.gloop, skins[0].id, 'unconfirmed selection does not change equipped state');
  completeSave(true);
  await f.settle();
  assert.equal(user.selected_skin_id_by_char.gloop, skins[1].id);
  const popup = f.document.querySelector('.character-details-overlay');
  assert.equal(popup.getAttribute('aria-hidden'), 'false');
  next();
  await f.settle();
  assert.equal(preview(), skins[2].name);
  assert.equal(saves.length, 1, 'locked previews do not save');
  next();
  assert.equal(saves.length, 2);
  completeSave(false);
  await f.settle();
  assert.equal(preview(), skins[2].name, 'failed selection restores the prior preview');
  assert.equal(user.selected_skin_id_by_char.gloop, skins[1].id);
  assert.equal(popup.getAttribute('aria-hidden'), 'false');
});
