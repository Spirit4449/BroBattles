const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/party.js'), 'utf8');
const initialize = source.slice(source.indexOf('export function initializeModeDropdown()'), source.indexOf('export function updatePlatformsForMode(')).replace('export ', '');

function setup(initialParty = false) {
  const state = { partyId: initialParty, selection: { modeId: 'duels', modeVariantId: 'duels-1v1', mapId: 1 }, emissions: [], saved: [], writes: [] };
  const map = { dataset: {}, addEventListener: (_, handler) => { state.mapChange = handler; } };
  const noop = () => {};
  const context = vm.createContext({
    document: { getElementById: id => id === 'map' ? map : { value: '', textContent: 'Owner' } },
    checkIfInParty: () => state.partyId,
    bindLobbyOffsetResizeHandler: noop,
    writeSelectionToDom: (selection, options) => { state.selection = selection; state.writes.push(options); return selection; },
    getPlayersPerTeamForSelection: () => 2, selectionToLegacyMode: () => 2,
    updatePlatformsForMode: noop, setLobbyBackground: noop, applyPlatformImageForMap: noop,
    applyLobbyCharacterOffsetForMap: noop, animatePlatformsForMapSwitch: noop, syncMapPickerUi: noop,
    getCurrentSelection: () => state.selection, getSavedSelectionFromUserData: () => state.selection,
    normalizeGameSelection: selection => selection, getSoloSelection: () => null,
    getCurrentMapValue: () => 1, legacyModeToVariantId: () => null,
    SOLO_MODE_ID_STORAGE_KEY: '', SOLO_MODE_VARIANT_STORAGE_KEY: '', SOLO_MODE_STORAGE_KEY: '', SOLO_MAP_STORAGE_KEY: '',
    canChangePartySelection: () => true,
    fetch: (...args) => state.fetch(...args),
    socket: { emit: (event, data) => state.emissions.push({ event, data }) },
    persistSoloSelection: async selection => state.saved.push(selection),
    setupModePickerControls: handler => { state.modeChange = handler; }, setupMapPickerControls: noop,
    sonner: noop, console,
  });
  state.fetch = async () => ({ ok: true, json: async () => ({ membersCount: 1, members: [] }) });
  vm.runInContext(initialize, context);
  context.initializeModeDropdown();
  state.writes.length = 0;
  return state;
}

for (const initial of [false, '7']) {
  test(`controls initialized in ${initial || 'solo'} update the current party after navigation`, async () => {
    const state = setup(initial);
    state.partyId = '42';
    await state.modeChange({ modeId: 'duels', modeVariantId: 'duels-2v2', mapId: 2 });
    state.mapChange({ target: { value: '3' } });
    assert.deepEqual(state.emissions.map(({ event, data }) => [event, data.partyId]), [['mode-change', '42'], ['map-change', '42']]);
    assert.equal(state.saved.length, 0);
    assert.ok(state.writes.every(options => options.persist === false));
  });
}

test('leaving a party saves subsequent changes as solo preferences', async () => {
  const state = setup('7');
  state.partyId = false;
  await state.modeChange({ modeId: 'duels', modeVariantId: 'duels-2v2', mapId: 2 });
  state.mapChange({ target: { value: '3' } });
  assert.equal(state.emissions.length, 0);
  assert.equal(state.saved.length, 2);
  assert.ok(state.writes.every(options => options.persist === true));
});

test('a mode change waiting for the roster cannot overwrite a newly joined party', async () => {
  const state = setup('7');
  let resolve;
  state.fetch = () => new Promise(done => { resolve = done; });
  const change = state.modeChange({ modeId: 'duels', modeVariantId: 'duels-2v2', mapId: 2 });
  state.partyId = '42';
  resolve({ ok: true, json: async () => ({ membersCount: 1, members: [] }) });
  await change;
  assert.equal(state.emissions.length, 0);
  assert.equal(state.writes.length, 0);
});

test('party mode requests keep the existing layout until the authoritative roster arrives', async () => {
  const state = setup('7');
  await state.modeChange({ modeId: 'duels', modeVariantId: 'duels-2v2', mapId: 2 });
  assert.equal(state.writes.length, 0);
  assert.equal(state.selection.modeVariantId, 'duels-1v1');
  assert.equal(state.emissions[0].data.selection.modeVariantId, 'duels-2v2');
  assert.equal(state.emissions[0].data.members, undefined);
});
