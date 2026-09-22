const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { registerChatEvents } = require('../src/server/core/socketEvents/chatEvents');

function lobbyFunction(name, context) {
  const source = fs.readFileSync('src/chat/lobbyChatController.js', 'utf8');
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf('\n  function ', start + 1);
  return vm.runInNewContext(`${source.slice(start, end)}\n${name}`, context);
}

test('typing cannot be broadcast into another party', () => {
  const handlers = {};
  const broadcasts = [];
  const socket = { data: { partyId: 7, user: { user_id: 12, name: 'Player' } }, on: (event, fn) => handlers[event] = fn };
  registerChatEvents(socket, { chatService: { io: { to: room => ({ emit: (...args) => broadcasts.push([room, ...args]) }) } } });
  let result;
  handlers['party-chat:typing']({ partyId: 8, isTyping: true }, ack => result = ack);
  assert.equal(result.ok, false);
  assert.equal(broadcasts.length, 0);
  handlers['party-chat:typing']({ partyId: 7, isTyping: true }, ack => result = ack);
  assert.equal(result.ok, true);
  assert.equal(broadcasts[0][0], 'party:7');
  handlers.disconnect();
});

test('leaving a party does not fall back to the stale party ID', () => {
  const current = lobbyFunction('currentPartyId', { getPartyContext: () => ({ partyId: null }), state: { partyId: 7 } });
  assert.equal(current(), 0);
});

test('broadcast reaction highlights belong to the current viewer', () => {
  const normalize = lobbyFunction('normalizeIncomingMessage', {
    isMessageMineForCurrentUser: () => false,
    getCurrentUserName: () => 'Bob',
    sameName: (a, b) => a.toLowerCase() === b.toLowerCase(),
  });
  const result = normalize({ myReaction: '🔥', reactionUsers: { '🔥': [{ name: 'Alice' }], '❤️': [{ name: 'Bob' }] } });
  assert.equal(result.myReaction, '❤️');
  assert.equal(normalize({ myReaction: '🔥', reactionUsers: {} }).myReaction, null);
});

test('battle send prevents duplicate submissions and preserves the other channel draft', async () => {
  const source = fs.readFileSync('src/chat/gameChatController.js', 'utf8');
  const start = source.indexOf('  async function sendMessage()');
  const end = source.indexOf('\n  function openComposer', start);
  let acknowledge;
  let sends = 0;
  const state = { audience: 'team', draftsByScope: { team: 'hello', all: '' } };
  const ui = { resizeComposer() {}, textarea: { value: 'hello', disabled: false, blur() {} }, sendBtn: {} };
  const send = vm.runInNewContext(`${source.slice(start, end)}\nsendMessage`, {
    state, ui, getGameData: () => ({ gameId: 1 }),
    socket: { connected: true, timeout: () => ({ emit: (event, payload, cb) => { sends++; acknowledge = cb; } }) },
    addMessage() {}, renderMessages() {}, clearUnread() {}, setInputCapture() {}, wakeChat() {},
  });
  const pending = send();
  await send();
  assert.equal(sends, 1);
  state.audience = 'all';
  state.draftsByScope.all = 'new draft';
  ui.textarea.value = 'new draft';
  acknowledge(null, { ok: true, message: { id: '1' } });
  await pending;
  assert.equal(ui.textarea.value, 'new draft');
  assert.equal(state.draftsByScope.all, 'new draft');
  assert.equal(state.draftsByScope.team, '');
  assert.equal(state.sending, false);
});

test('lobby Escape dismisses views before the underlying chat', () => {
  const source = fs.readFileSync('src/index.js', 'utf8');
  const start = source.indexOf('function closeTransientLobbyUiOnEscape()');
  const end = source.indexOf('\ndocument.addEventListener(', start);
  let viewsOpen = true;
  let viewsClosed = 0;
  let chatClosed = 0;
  const close = vm.runInNewContext(`${source.slice(start, end)}\ncloseTransientLobbyUiOnEscape`, {
    document: {
      querySelector(selector) {
        if (selector === '.bb-chat-viewers-popup:not(.hidden)') return viewsOpen ? { querySelector: () => ({ click: () => { viewsClosed++; viewsOpen = false; } }) } : null;
        if (selector === '.bb-chat-lobby-panel.is-open') return {};
        return null;
      },
      getElementById: () => null,
    },
    isOverlayOpen: () => false,
    lobbyChatController: { close: () => chatClosed++ },
  });
  assert.equal(close(), true);
  assert.equal(viewsClosed, 1);
  assert.equal(chatClosed, 0);
  assert.equal(close(), true);
  assert.equal(chatClosed, 1);
});

test('chat profile targets open the named player with mouse or keyboard without disrupting text selection', () => {
  const source = fs.readFileSync('src/chat/presentation.js', 'utf8');
  const start = source.indexOf('function bindChatProfile(');
  const end = source.indexOf('function createAvatarEl', start);
  let selection = '';
  const bind = vm.runInNewContext(`${source.slice(start, end)}\nbindChatProfile`, {
    window: { getSelection: () => ({toString: () => selection}) },
  });
  const handlers = {};
  const opened = [];
  const element = {classList:{add() {}}, setAttribute() {}, addEventListener: (type, fn) => handlers[type] = fn};
  bind(element, 'Alice', name => opened.push(name));
  handlers.click({stopPropagation() {}});
  selection = 'Alice';
  handlers.click({stopPropagation() {}});
  handlers.keydown({key:'Enter', preventDefault() {}, stopPropagation() {}});
  assert.deepEqual(opened, ['Alice', 'Alice']);
  assert.equal(element.tabIndex, 0);
});
