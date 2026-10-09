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


test('Ready streak badge appears from two wins and hides smaller values', async () => {
  const { renderReadyWinStreak } = await import('../src/client/views/winStreakView.mjs');
  const attrs = {};
  const badge = { setAttribute(key, value) { attrs[key] = value; } };
  renderReadyWinStreak(badge, 12);
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '12');
  assert.equal(attrs['aria-label'], '12 win streak');
  renderReadyWinStreak(badge, 2);
  assert.equal(badge.hidden, false);
  renderReadyWinStreak(badge, 1);
  assert.equal(badge.hidden, true);
  renderReadyWinStreak(badge, 0);
  assert.equal(badge.hidden, true);
  renderReadyWinStreak(badge, undefined);
  assert.equal(badge.hidden, true);
  renderReadyWinStreak(null, 2);
});


test('match result streak shows an increase or loss without inventing pending values', async () => {
  const { gameOverWinStreakMarkup } = await import('../src/client/views/winStreakView.mjs');
  const increase = gameOverWinStreakMarkup({ winStreakBefore: 4, winStreakAfter: 5 });
  assert.match(increase, /Win streak increased!/);
  assert.match(increase, /4 to 5/);
  assert.equal(gameOverWinStreakMarkup({ winStreakBefore: 0, winStreakAfter: 1 }), '');
  assert.equal(gameOverWinStreakMarkup({ winStreakBefore: 1, winStreakAfter: 0 }), '');
  assert.match(gameOverWinStreakMarkup({ winStreakBefore: 1, winStreakAfter: 2 }), /Win streak increased!/);
  assert.match(gameOverWinStreakMarkup({ winStreakBefore: 4, winStreakAfter: 0 }), /Win streak lost/);
  assert.equal(gameOverWinStreakMarkup({ winStreakBefore: 0, winStreakAfter: 0 }), '');
  assert.equal(gameOverWinStreakMarkup({ winStreakBefore: 4, winStreakAfter: 4 }), '', 'draws show no streak change');
  assert.equal(gameOverWinStreakMarkup(undefined), '');
  assert.equal(gameOverWinStreakMarkup({ winStreakBefore: -1, winStreakAfter: 0 }), '');
});


test('benefits list labels only active tiers and contains no footer description', async () => {
  const { winStreakBenefitsMarkup } = await import('../src/client/views/winStreakView.mjs');
  const { WIN_STREAK_TIERS } = require('../src/shared/winStreakRewards.cjs');
  const top = WIN_STREAK_TIERS.at(-1).streak;
  const html = winStreakBenefitsMarkup(top);
  assert.equal((html.match(/class="is-active"/g) || []).length, 3);
  assert.doesNotMatch(html, /Locked|Upgraded|<p>/);
  assert.doesNotMatch(winStreakBenefitsMarkup(0), /Active|Locked|Upgraded/);
});


test('match streak counter replaces one number after the exit animation', async () => {
  const { animateGameOverWinStreak } = await import('../src/client/views/winStreakView.mjs');
  const states = [], classes = new Set();
  const cues = [];
  const counter = { textContent: '4', dataset: { streakAfter: '5' }, classList: {
    add: value => classes.add(value), remove: value => classes.delete(value),
  } };
  const badge = { isConnected: true, querySelector: () => counter };
  await animateGameOverWinStreak(badge, { onCountChanged: () => cues.push(counter.textContent), wait: async () => { states.push(counter.textContent); } });
  assert.deepEqual(states, ['4', '4']);
  assert.deepEqual(cues, ['5']);
  assert.equal(counter.textContent, '5');
  assert.equal(classes.has('is-changing'), false);
  assert.equal(classes.has('is-counted'), true);
  counter.dataset.streakAfter = '0';
  await animateGameOverWinStreak(badge, { reducedMotion: true, wait: () => { throw new Error('should not wait'); } });
  assert.equal(counter.textContent, '0');
});

test('streak benefits open only on activation and dismiss without stale toggle state', async () => {
  const { wireWinStreakBenefits } = await import('../src/client/views/winStreakView.mjs');
  const node = () => ({
    handlers: {}, attrs: {}, dataset: {}, classList: classes(),
    addEventListener(type, handler) { this.handlers[type] = handler; },
    setAttribute(key, value) { this.attrs[key] = value; },
    fire(type, event = {}) { this.handlers[type]?.(event); },
  });
  const doc = node(), parent = node(), badge = node(), panel = node();
  panel.hidden = true;
  badge.ownerDocument = doc;
  badge.parentElement = parent;
  parent.contains = target => target === badge || target === panel;
  badge.focus = () => { badge.focused = true; };
  wireWinStreakBenefits(badge, panel);
  badge.fire('mouseenter');
  badge.fire('focus');
  assert.equal(panel.hidden, true);
  assert.equal(badge.attrs['aria-expanded'], 'false');
  badge.fire('click');
  assert.equal(panel.hidden, false);
  assert.equal(panel.classList.contains('is-open'), true);
  assert.equal(panel.inert, false);
  doc.fire('click', { target: panel });
  assert.equal(badge.attrs['aria-expanded'], 'true');
  badge.fire('click');
  assert.equal(panel.classList.contains('is-open'), false);
  assert.equal(panel.inert, true);
  badge.fire('click');
  doc.fire('keydown', { key: 'Escape' });
  assert.equal(badge.attrs['aria-expanded'], 'false');
  assert.equal(badge.focused, true);
  badge.fire('click');
  doc.fire('click', { target: {} });
  assert.equal(badge.attrs['aria-expanded'], 'false');
  badge.fire('click');
  parent.fire('focusout', { relatedTarget: {} });
  badge.fire('click');
  assert.equal(badge.attrs['aria-expanded'], 'true');
});
