const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLobbyFixture } = require('./helpers/lobbyFixture');

function setup(inParty = true, options = {}) {
  const f = createLobbyFixture({ url: `https://game.test/${inParty ? 'party/7' : ''}`, ...options,
    globals: { console: { log() {}, warn() {}, error() {} }, ...options.globals } });
  const api = f.load('src/client/lobby/party/party.js');
  f.window.__BRO_BATTLES_USERDATA__.name = 'Owner';
  f.document.getElementById('username-text').textContent = 'Owner';
  const roster = (status = 'online') => ({ partyId: 7, ownerName: 'Owner', immediate: true,
    selection: { modeId: 'duels', modeVariantId: 'duels-1v1', mapId: 1 },
    members: [{ name: 'Owner', team: 'team1', slot_index: 0, char_class: 'ninja', status },
      { name: 'Friend', team: 'team2', slot_index: 0, char_class: 'ozzy', status: 'online' }] });
  if (inParty) api.renderPartyMembers(roster());
  api.socketInit();
  api.initializeModeDropdown();
  const emissions = [];
  f.socket.on('mode-change', data => emissions.push({ event: 'mode-change', data }));
  f.socket.on('map-change', data => emissions.push({ event: 'map-change', data }));
  return { ...f, api, roster, emissions,
    async selectDuelSize(label = '2v2') {
      f.document.getElementById('mode-picker-open').click();
      const option = [...f.document.querySelectorAll('.mode-variant-option')].find(button => button.textContent.trim() === label);
      assert.ok(option && !option.disabled, `available ${label} option`);
      option.click();
      await f.settle();
    },
    selectMap(value) {
      const map = f.document.getElementById('map'); map.value = String(value);
      f.event(map, 'change');
    },
  };
}

test('status and repeated roster messages preserve occupied seats and do not replay seat movement', () => {
  const f = setup();
  f.window.matchMedia = () => ({ matches: false });
  const owner = f.document.getElementById('your-slot-1');
  const friend = f.document.getElementById('op-slot-1');
  let moves = 0;
  for (const slot of [owner, friend]) slot.animate = () => { moves++; return { cancel() {}, finished: Promise.resolve() }; };
  for (const status of ['Selecting Character', 'online', 'offline', 'online']) f.socket.emit('party:members', f.roster(status));
  assert.equal(f.document.getElementById('your-slot-1'), owner);
  assert.equal(f.document.getElementById('op-slot-1'), friend);
  assert.equal(owner.dataset.playerName, 'Owner');
  assert.equal(friend.dataset.playerName, 'Friend');
  assert.equal(moves, 0);
});

test('controls follow the current party after navigation; leaving stores solo preferences instead', async () => {
  for (const initial of [false, true]) {
    const f = setup(initial);
    f.window.location.pathname = '/party/42';
    f.api.resetLobbyRoute(42);
    await f.selectDuelSize();
    f.selectMap(3);
    assert.deepEqual(f.emissions.map(({ event, data }) => [event, data.partyId]), [['mode-change', '42'], ['map-change', '42']]);
    assert.equal(f.requests.filter(request => request.url === '/selection-preferences').length, 0);
    f.window.location.pathname = '/';
    f.api.resetLobbyRoute(null);
    await f.selectDuelSize('1v1');
    f.selectMap(1);
    await f.settle();
    assert.equal(f.emissions.length, 2);
    assert.equal(f.requests.filter(request => request.url === '/selection-preferences').length, 2);
    assert.equal(f.localStorage.getItem('bb_solo_mode_variant_id'), 'duels-1v1');
  }
});

test('a mode request cannot commit into a different party and does not resize seats ahead of the server roster', async () => {
  let release;
  const f = setup(true, { globals: { fetch: url => url === '/party-members'
    ? new Promise(resolve => { release = resolve; })
    : Promise.resolve({ ok: true, json: async () => ({}) }) } });
  const countSeats = () => f.document.querySelectorAll('#lobby-area .platform').length;
  const originalSeats = countSeats();
  await f.selectDuelSize();
  assert.equal(countSeats(), originalSeats);
  f.window.location.pathname = '/party/42';
  f.api.resetLobbyRoute(42);
  release({ ok: true, json: async () => ({ membersCount: 2 }) });
  await f.settle();
  assert.equal(f.emissions.length, 0);
});

test('matchmaking receives the equipped solo portrait and party skin selection through its public integration', async () => {
  let preview;
  const matchmaking = path.resolve(__dirname, '../src/client/lobby/matchmaking/matchmakingClient.mjs');
  const f = setup(false, { imports: { [matchmaking]: { createMatchmakingClient: options => ({
    resumeQueueing() { preview = options.party.players(); },
    isSuppressed: () => false, isQueued: () => false, startSolo() {}, leaveSolo() {}, bindSocketEvents() {},
  }) } } });
  const skinUrl = '/assets/ninja/skins/ninja-arena-sovereign/body.webp';
  const slot = f.document.getElementById('your-slot-1');
  slot.dataset.character = 'ninja';
  slot.querySelector('.username').textContent = 'Owner (You)';
  slot.querySelector('.character-sprite').setAttribute('src', skinUrl);
  f.api.initReadyToggle();
  f.document.getElementById('ready').click();
  await f.settle();
  assert.equal(preview.find(player => player.name === 'Owner').selected_skin_asset_url, skinUrl);
  f.window.location.pathname = '/party/7';
  f.api.resetLobbyRoute(7);
  const roster = f.roster();
  roster.members[0].selected_skin_id_by_char = { ninja: 'ninja-arena-sovereign' };
  f.api.renderPartyMembers(roster);
  f.document.getElementById('ready').click();
  await f.settle();
  assert.equal(preview.find(player => player.name === 'Owner').selected_skin_id, 'ninja-arena-sovereign');
});

test('hidden Bros follows opponent teams, repeated updates, and disabling the setting', () => {
  const f = setup();
  const roster = { ...f.roster(), hideEnemyBros: true };
  f.api.renderPartyMembers(roster);
  const enemy = f.document.getElementById('op-slot-1');
  assert.equal(enemy.querySelector('.character-sprite').getAttribute('src'), '/assets/ui/hidden-bro.png');
  assert.equal(enemy.dataset.character, 'Hidden');
  assert.equal(enemy.querySelector('.character-sprite').alt, 'Hidden Bro');
  assert.match(f.document.getElementById('your-slot-1').querySelector('.character-sprite').getAttribute('src'), /ninja/);
  roster.members[1].char_class = 'thorg';
  f.api.renderPartyMembers(roster);
  assert.equal(enemy.querySelector('.character-sprite').getAttribute('src'), '/assets/ui/hidden-bro.png');
  f.api.renderPartyMembers({ ...roster, hideEnemyBros: false });
  assert.match(enemy.querySelector('.character-sprite').getAttribute('src'), /thorg/);
  f.api.renderPartyMembers({ ...roster, hideEnemyBros: true, members: roster.members.map(m => ({ ...m, team: m.team === 'team1' ? 'team2' : 'team1' })) });
  assert.equal(f.document.getElementById('your-slot-1').querySelector('.character-sprite').getAttribute('src'), '/assets/ui/hidden-bro.png');
  assert.match(f.document.getElementById('op-slot-1').querySelector('.character-sprite').getAttribute('src'), /ninja/);
});
