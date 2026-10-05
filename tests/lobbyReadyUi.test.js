const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../src/client/lobby/party/party.js'), 'utf8');
const toggleSource = source.slice(source.indexOf('export function initReadyToggle()'), source.indexOf('function getCurrentPartyMember()')).replace('export ', '');
const selfSource = source.slice(source.indexOf('function setSelfReadyState('), source.indexOf('function collectCurrentPartyMembers('));
const buttonSource = source.slice(source.indexOf('function setReadyButtonState('), source.indexOf('export function getPartyInteractionContext('));

function classes() {
  const values = new Set();
  return {
    contains: value => values.has(value),
    add: value => values.add(value),
    remove: (...items) => items.forEach(value => values.delete(value)),
    toggle(value, on) { if (on) values.add(value); else values.delete(value); },
  };
}

function fixture() {
  let click, ack;
  const status = { textContent: 'online' };
  const slot = { querySelector: () => status };
  const button = { dataset: {}, classList: classes(), addEventListener: (_, handler) => { click = handler; } };
  const roots = Array.from({ length: 5 }, () => ({ inert: false }));
  const chat = { inert: false }, friends = { inert: false };
  const notices = [];
  const state = { partyId: 7 };
  const context = vm.createContext({
    __partyReadyPending: false, __partyReadyTarget: null, __partyReadyRequestId: 0,
    __readyLockedRoots: new Map(), __activeBattleMatchId: null,
    document: {
      body: { classList: classes() },
      getElementById: () => button,
      querySelectorAll: () => roots,
    },
    window: {}, getSelfSlot: () => slot, getActivePartyId: () => state.partyId,
    getCurrentSelection: () => ({}), normalizeGameSelection: value => value,
    getSelectionBlockReason: () => '', ensureLegalAcceptance: async () => {},
    applyLobbyStatusVisualState: () => {},
    matchmaking: { resumeQueueing() {}, startSolo() {}, leaveSolo() {} },
    socket: { connected: true, timeout: () => ({ emit: (_, data, handler) => { ack = handler; } }) },
    sonner: (...args) => notices.push(args), MAINTENANCE_MESSAGE: 'Maintenance',
    fetch: async () => { throw new Error('Offline'); },
  });
  vm.runInContext(toggleSource + selfSource + buttonSource, context);
  context.initReadyToggle();
  return { status, button, roots, chat, friends, state, context, notices, click: () => click(), ack: (...args) => ack(...args) };
}

test('party readiness updates before acknowledgement and locks lobby groups only', async () => {
  const f = fixture();
  await f.click();
  assert.equal(f.status.textContent, 'ready');
  assert.equal(f.button.value, 'Cancel');
  assert.ok(f.roots.every(root => root.inert));
  assert.equal(f.chat.inert, false);
  assert.equal(f.friends.inert, false);
  assert.equal(f.button.disabled, true);
  await f.ack(null, { ok: true });
  assert.equal(f.button.disabled, false);
  assert.equal(f.button.value, 'Cancel');
});

for (const error of [null, new Error('Timeout')]) {
  test(`failed ready rolls back even if roster refresh fails (${error ? 'timeout' : 'rejection'})`, async () => {
    const f = fixture();
    await f.click();
    await f.ack(error, { ok: false });
    assert.equal(f.status.textContent, 'online');
    assert.equal(f.button.value, 'Ready');
    assert.ok(f.roots.every(root => !root.inert));
    assert.equal(f.notices.length, 1);
  });
}

test('cancel updates immediately and restores preexisting inert state', async () => {
  const f = fixture();
  f.roots[0].inert = true;
  await f.click();
  await f.ack(null, { ok: true });
  await f.click();
  assert.equal(f.status.textContent, 'online');
  assert.equal(f.button.value, 'Ready');
  assert.equal(f.roots[0].inert, true);
  assert.ok(f.roots.slice(1).every(root => !root.inert));
  await f.ack(null, { ok: true });
});

test('roster refresh cannot overwrite pending optimistic readiness', async () => {
  const f = fixture();
  await f.click();
  f.status.textContent = 'online';
  f.context.syncReadyButtonFromSelfSlot();
  assert.equal(f.status.textContent, 'ready');
  assert.equal(f.button.value, 'Cancel');
});

test('failed cancel restores ready state and an old party acknowledgement is ignored', async () => {
  const f = fixture();
  await f.click();
  await f.ack(null, { ok: true });
  await f.click();
  await f.ack(null, { ok: false });
  assert.equal(f.button.value, 'Cancel');
  assert.ok(f.roots.every(root => root.inert));
  await f.click();
  f.state.partyId = 8;
  f.context.setSelfReadyState(false);
  await f.ack(new Error('Timeout'));
  assert.equal(f.button.value, 'Ready');
});
