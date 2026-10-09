const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/client/lobby/party/party.js'), 'utf8');
const commitSource = source.slice(source.indexOf('function commitPartyRosterLayout('), source.indexOf('export function renderPartyMembers('));

function fixture() {
  const animations = [];
  const spawns = [];
  const origins = new Map();
  const moveAnimations = new WeakMap();
  const slots = ['your-slot-1', 'your-slot-2', 'op-slot-1'].map((id, index) => ({
    id, dataset: {}, x: index * 200, y: 10,
    classList: { contains: () => false },
    getBoundingClientRect() { return { x: this.x, y: this.y }; },
    querySelector: () => ({ getAttribute: () => 'sprite.webp' }),
    animate(frames) {
      const animation = { id, frames, canceled: false, cancel() { this.canceled = true; } };
      animations.push(animation);
      return animation;
    },
  }));
  const state = { reducedMotion: false, drift: 0, effects: 0 };
  const context = vm.createContext({
    getRenderedLobbyMemberSlots: () => new Map(slots.filter(s => s.dataset.playerName).map(s => [s.dataset.playerName.toLowerCase(), s])),
    getLobbyMemberKey: value => String(typeof value === 'string' ? value : value?.name || '').toLowerCase(),
    updatePlatformsForMode: () => {},
    getBotSlotTarget: () => ({ team: 'team1', index: 0 }),
    document: { querySelectorAll: () => slots, getElementById: id => slots.find(s => s.id === id) },
    resetSlotToRandom: slot => { moveAnimations.get(slot)?.cancel(); moveAnimations.delete(slot); delete slot.dataset.playerName; },
    applyMemberToSlot: (member, id) => { const slot = slots.find(s => s.id === id); slot.dataset.playerName = member.name; slot.y += state.drift; },
    partySlotDrag: { takeOrigin: key => { const rect = origins.get(key); origins.delete(key); return rect; } },
    playLobbySpawnAnimation: slot => spawns.push(slot.id),
    clearLobbySpawnAnimation: () => {},
    prefersReducedLobbyMotion: () => state.reducedMotion,
    playPartyMoveEffect: () => state.effects++,
    syncInviteBadges: () => {},
    __partyContext: { botSlots: [] },
    __partyMoveAnimations: moveAnimations,
    console: { log() {} },
  });
  vm.runInContext(commitSource, context);
  const members = [
    { name: 'Owner', team: 'team1', slot_index: 0 },
    { name: 'Friend', team: 'team2', slot_index: 0 },
  ];
  const commit = (roster = members, spawnMemberKeys = new Set()) => context.commitPartyRosterLayout({ members: roster, currentUserName: 'Owner', layoutSlots: 2, spawnMemberKeys });
  commit();
  return { slots, state, animations, spawns, origins, members, commit };
}

test('status, owner and repeated roster updates never move members in unchanged seats', () => {
  const f = fixture();
  // Geometry can change due to idle float or layout while the seat stays fixed.
  f.state.drift = 8;
  for (const status of ['Selecting Character', 'online', 'offline', 'online']) {
    f.commit(f.members.map(member => ({ ...member, status })));
  }
  assert.equal(f.animations.length, 0);
  assert.equal(f.state.effects, 0);
});

test('moving a member animates only that member; a packet mid-move does not restart it', () => {
  const f = fixture();
  const roster = [{ ...f.members[0], slot_index: 1 }, f.members[1]];
  f.commit(roster);
  assert.deepEqual(f.animations.map(a => a.id), ['your-slot-2']);
  f.state.drift = 7;
  f.commit(roster);
  assert.equal(f.animations.length, 1);
  assert.equal(f.animations[0].canceled, false);
});

test('a second move cancels the old seat animation and animates both swapped players', () => {
  const f = fixture();
  f.commit([{ ...f.members[0], slot_index: 1 }, f.members[1]]);
  f.commit([{ ...f.members[0], team: 'team2' }, { ...f.members[1], team: 'team1', slot_index: 1 }]);
  assert.equal(f.animations[0].canceled, true);
  assert.deepEqual(f.animations.slice(1).map(a => a.id), ['your-slot-2', 'op-slot-1']);
});

test('joining and leaving do not animate the remaining members', () => {
  const f = fixture();
  f.state.drift = 10;
  f.commit([...f.members, { name: 'New', team: 'team1', slot_index: 1 }], new Set(['new']));
  f.commit(f.members);
  assert.deepEqual(f.spawns, ['your-slot-2']);
  assert.equal(f.animations.length, 0);
});

test('local drag uses the release position without replaying the remote move effect', () => {
  const f = fixture();
  f.origins.set('owner', { x: 190, y: 10 });
  f.commit([{ ...f.members[0], slot_index: 1 }, f.members[1]]);
  assert.equal(f.animations[0].frames[0].translate, '-10px 0px');
  assert.equal(f.state.effects, 0);
});

test('reduced motion skips seat movement animations', () => {
  const f = fixture();
  f.state.reducedMotion = true;
  f.commit([{ ...f.members[0], slot_index: 1 }, f.members[1]]);
  assert.equal(f.animations.length, 0);
});

test('an unchanged level badge keeps its existing artwork', () => {
  let renders = 0;
  const badge = { dataset: {} };
  const slot = { querySelector: () => badge, classList: { add() {}, remove() {} } };
  const context = vm.createContext({
    LEVEL_CAP: 11,
    renderLevelBadge: (element, level) => { renders++; element.dataset.level = String(level); },
  });
  const badgeSource = fs.readFileSync(require.resolve('../src/client/views/levelBadgeView.js'), 'utf8');
  vm.runInContext(badgeSource.slice(badgeSource.indexOf('function setSlotLevelBadge(')), context);
  context.setSlotLevelBadge(slot, 5);
  context.setSlotLevelBadge(slot, 5);
  assert.equal(renders, 1);
  context.setSlotLevelBadge(slot, 6);
  assert.equal(renders, 2);
});

test('matchmaking previews retain solo DOM portraits and raw party skin selections', () => {
  const start = source.indexOf('function collectCurrentPartyMembers(');
  const end = source.indexOf('\n}', start) + 2;
  const skinUrl = '/assets/ninja/skins/ninja-arena-sovereign/body.webp';
  const context = {
    __partyContext: { members: [], botSlots: [] },
    DEFAULT_CHARACTER: 'ninja', resolveCharacterKey: value => value || 'ninja',
    getCurrentPartyMember: () => null,
    document: { querySelectorAll: () => [{
      dataset: { character: 'ninja' },
      querySelector: selector => selector === '.username'
        ? { textContent: 'Player (You)' } : { getAttribute: () => skinUrl },
    }] },
  };
  const collect = vm.runInNewContext(source.slice(start, end) + '; collectCurrentPartyMembers', context);
  assert.equal(collect()[0].selected_skin_asset_url, skinUrl);
  context.__partyContext.members = [{ name: 'Player', char_class: 'ninja', selected_skin_id_by_char: { ninja: 'ninja-arena-sovereign' } }];
  assert.equal(collect()[0].selected_skin_id, 'ninja-arena-sovereign');
});
