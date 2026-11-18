const { createFakeIo } = require('./helpers/fakeIo');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createBrowserFixture } = require('./helpers/browserFixture');

describe('Chat integration', () => {
  test('message receipts sit beside the time and only reactions add a footer', () => {
    const f = createBrowserFixture();
    const { renderPartyChatMessage } = f.load('src/client/chat/presentation.js');
    const message = { id: 1, sender: { name: 'Alice' }, body: 'Ready?', createdAt: new Date().toISOString(), viewCount: 2 };
    let opened;
    const options = { currentUserName: 'Bob', onOpenViewers: (item, anchor) => opened = { item, anchor } };
    const row = renderPartyChatMessage(message, options);
    assert.equal(row.querySelector('.bb-chat-message-meta'), null);
    const status = row.querySelector('.bb-chat-message-status');
    assert.ok(status.querySelector('.bb-chat-time').textContent);
    const receipt = status.querySelector('.bb-chat-view-count');
    assert.equal(receipt.textContent, '2');
    receipt.click();
    assert.equal(opened.item, message);
    assert.equal(opened.anchor, receipt);

    const reacted = renderPartyChatMessage({ ...message, reactions: [{ reaction: '🔥', count: 1 }] }, options);
    assert.equal(reacted.querySelector('.bb-chat-reaction-count').textContent, '1');
    assert.equal(reacted.querySelector('.bb-chat-inline-reaction img').getAttribute('src'), '/assets/chat-reactions/fire.svg');
    assert.equal(reacted.querySelector('.bb-chat-message-meta .bb-chat-view-count'), null);
    assert.equal(reacted.querySelector('.bb-chat-bubble').lastElementChild.className, 'bb-chat-hover-actions');
    assert.equal(reacted.getAttribute("tabindex"), "0");
    const direct = renderPartyChatMessage(message, { ...options, showViewCount: false });
    assert.equal(direct.querySelector('.bb-chat-view-count'), null);
    assert.equal(direct.querySelector('.bb-chat-message-meta'), null);
  });

  test('all six pixel reactions send compatible values and describe their selection', () => {
    const f = createBrowserFixture();
    const { renderPartyChatMessage } = f.load('src/client/chat/presentation.js');
    const message = { id: 9, sender: { name: 'Alice' }, body: 'Good game', myReaction: '😭',
      reactions: [{ reaction: '😭', count: 2 }, { reaction: '👎', count: 1 }, { reaction: '⭐', count: 1 }] };
    const sent = [];
    const row = renderPartyChatMessage(message, { currentUserName: 'Bob', onReact: (item, reaction) => sent.push([item.id, reaction]) });
    const buttons = [...row.querySelectorAll('.bb-chat-hover-reactions button')];
    const values = ['👍', '👎', '❤️', '😂', '😭', '🔥'];
    const names = ['Like', 'Dislike', 'Heart', 'Laughing', 'Crying', 'Fire'];
    assert.equal(buttons.length, values.length);
    buttons.forEach((button, i) => {
      assert.ok(button.querySelector('img').getAttribute('src').startsWith('/assets/chat-reactions/'));
      assert.ok(button.getAttribute('aria-label').toLowerCase().includes(names[i].toLowerCase()));
      assert.equal(button.getAttribute('aria-pressed'), String(values[i] === message.myReaction));
      button.click();
    });
    assert.deepEqual(sent, values.map(value => [9, value]));
    const chips = [...row.querySelectorAll('.bb-chat-inline-reaction')];
    assert.equal(chips[0].getAttribute('aria-label'), 'Crying, 2 reactions');
    chips[0].click();
    assert.deepEqual(sent.at(-1), [9, '😭']);
    assert.ok(chips[2].textContent.includes('⭐'));
  });

  const { registerChatEvents } = require('../src/server/core/socketEvents/chatEvents');
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


  test('chat guards preserve party and battle replies with empty or malformed acknowledgements', async () => {
    const handlers = {};
    const checks = [];
    const socket = {
      id: 'sender',
      data: { user: { user_id: 12, name: 'Player' }, partyId: 7 },
      on: (event, handler) => { handlers[event] = handler; },
    };
    const guardReply = {
      allowed: false, message: 'Wait before sending', type: 'chat_limited',
      suspendedUntilMs: 500, level: 2, violationsUntilBan: 3, banWarning: 'Warning',
    };
    const abuseControl = {
      async guardChatAction(context) {
        checks.push(context);
        return guardReply;
      },
    };
    let sends = 0;
    registerChatEvents(socket, {
      abuseControl,
      chatService: { sendPartyChatMessage() { sends++; } },
    });
    const players = new Map();
    const { registerGameChatEvents } = require('../src/server/core/socketEvents/gameChatEvents');
    registerGameChatEvents({
      abuseControl,
      players,
      onSocket(_socket, event, handler) { handlers[event] = handler; },
      broadcast() { sends++; },
    }, socket);
    const { SOCKET_EVENTS } = require('../src/shared/net/socketEvents');
    const partySend = handlers[SOCKET_EVENTS.PARTY_CHAT_SEND];
    const battleSend = handlers[SOCKET_EVENTS.GAME_CHAT_SEND];
    let result;

    await battleSend(reply => { result = reply; });
    assert.deepEqual(result, { ok: false, error: 'not_in_game' });
    assert.equal(checks.length, 0);

    await partySend(reply => { result = reply; });
    assert.deepEqual(result, {
      ok: false, error: guardReply.message, type: guardReply.type, suspendedUntilMs: 500,
    });
    await partySend({ body: 'Hello' }, { invalid: true });
    await partySend();

    players.set(socket.id, socket.data.user);
    await battleSend({ scope: 'all', body: 'Hello' }, reply => { result = reply; });
    assert.deepEqual(result, {
      ok: false, error: guardReply.message, type: guardReply.type, suspendedUntilMs: 500,
      level: 2, violationsUntilBan: 3, banWarning: 'Warning',
    });
    assert.deepEqual(checks.map(check => check.source), [
      'socket:party-chat:send', 'socket:party-chat:send', 'socket:party-chat:send', 'socket:game-chat:send',
    ]);
    assert.equal(sends, 0);
  });

  function lobbyFixture({ readPending = false, partyId = 7 } = {}) {
    const state = { partyId, messages: [], reads: [] };
    const f = createBrowserFixture('', { globals: { fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      state.requests.push({ url, body });
      if (url === '/party-chat/history') return { ok: true, json: async () => ({ messages: state.messages, lastReadMessageId: 0 }) };
      if (url === '/party-chat/read') {
        state.reads.push(body);
        if (readPending) return new Promise(resolve => { state.resolveRead = () => resolve({ ok: true, json: async () => ({ lastReadMessageId: body.lastMessageId - 2 }) }); });
      }
      return { ok: true, json: async () => ({}) };
    } } });
    state.requests = [];
    const controller = f.load('src/client/chat/lobbyChatController.js').createLobbyChatController({
      socket: f.socket, getPartyContext: () => ({ partyId: state.partyId, members: [] }), getCurrentUserName: () => 'Bob',
    });
    const messages = f.document.querySelector('.bb-chat-messages');
    Object.assign(messages, { scrollTop: 0, scrollHeight: 100, clientHeight: 100 });
    return { ...f, state, controller };
  }

  test('party chat loads history only after membership is confirmed', async t => {
    const f = lobbyFixture({ partyId: null });
    t.after(() => f.controller.destroy());
    await f.settle();
    assert.equal(f.state.requests.length, 0);
    f.socket.emit('party:joined', { partyId: 7 });
    await f.settle();
    assert.ok(f.state.requests.some(request => request.url === '/party-chat/history' && request.body.partyId === 7));
  });

  test('leaving a party prevents subsequent chat requests from using its stale id', async t => {
    const f = lobbyFixture();
    t.after(() => f.controller.destroy());
    await f.settle();
    assert.equal(f.state.requests[0].body.partyId, 7);
    const before = f.state.requests.length;
    f.state.partyId = null;
    f.controller.refresh();
    f.controller.open();
    f.document.querySelector('textarea').value = 'hello';
    f.document.querySelector('.bb-chat-send').click();
    await f.settle();
    assert.equal(f.state.requests.length, before);
    assert.equal(f.document.querySelector('textarea').value, 'hello');
  });

  test('broadcast reaction highlights are rendered for the viewer rather than the sender', async t => {
    const f = lobbyFixture();
    t.after(() => f.controller.destroy());
    await f.settle();
    f.controller.open();
    await f.settle();
    f.socket.emit('party-chat:message', { partyId: 7, message: {
      id: 1, body: 'hello', sender: { name: 'Alice' }, createdAt: new Date().toISOString(),
      myReaction: '🔥', reactions: [{ reaction: '🔥', count: 1 }, { reaction: '❤️', count: 1 }],
      reactionUsers: { '🔥': [{ name: 'Alice' }], '❤️': [{ name: 'Bob' }] },
    } });
    const active = [...f.document.querySelectorAll('.bb-chat-inline-reaction.is-active')];
    assert.equal(active.length, 1);
    assert.equal(active[0].querySelector('img').getAttribute('src'), '/assets/chat-reactions/heart.svg');
  });

  test('battle send prevents duplicate submissions and preserves the other channel draft', async t => {
    const f = createBrowserFixture();
    const controller = f.load('src/client/chat/gameChatController.js').createGameChatController({
      socket: f.socket, getGameData: () => ({ gameId: 1 }), getUsername: () => 'Bob',
      setChatInputActive() {}, isChatInputActive: () => false,
    });
    t.after(() => controller.destroy());
    controller.open();
    const textarea = f.document.querySelector('textarea');
    textarea.value = 'hello';
    f.event(textarea, 'input');
    f.document.querySelector('.bb-chat-send').click();
    f.document.querySelector('.bb-chat-send').click();
    assert.equal(f.sent.length, 1);
    f.document.querySelector('[data-chat-scope="all"]').click();
    textarea.value = 'new draft';
    f.event(textarea, 'input');
    f.acknowledgements[0](null, { ok: true, message: { id: '1', body: 'hello', scope: 'team', sender: { name: 'Bob' } } });
    await f.settle();
    assert.equal(textarea.value, 'new draft');
    f.document.querySelector('[data-chat-scope="team"]').click();
    assert.equal(textarea.value, '');
    f.document.querySelector('[data-chat-scope="all"]').click();
    assert.equal(textarea.value, 'new draft');
  });

  test('chat profile targets support mouse and keyboard without disrupting text selection', () => {
    const f = createBrowserFixture('<button id="profile">Alice</button>');
    const { bindChatProfile } = f.load('src/client/chat/presentation.js');
    const opened = [], element = f.document.getElementById('profile');
    bindChatProfile(element, 'Alice', name => opened.push(name));
    element.click();
    f.window.getSelection = () => ({ toString: () => 'Alice' });
    element.click();
    f.event(element, 'keydown', { key: 'Enter' });
    assert.deepEqual(opened, ['Alice', 'Alice']);
    assert.equal(element.getAttribute('tabindex'), '0');
  });

  test('viewing messages clears unread state before a delayed receipt and stale server read data cannot restore it', async t => {
    const f = lobbyFixture({ readPending: true });
    t.after(() => f.controller.destroy());
    await f.settle();
    const message = { id: 20, sender: { name: 'Alice' }, body: 'hello', createdAt: new Date().toISOString() };
    f.state.messages = [message];
    f.socket.emit('party-chat:message', { partyId: 7, message });
    const badge = f.document.querySelector('.bb-chat-badge');
    assert.equal(badge.textContent, '1');
    f.controller.open();
    await f.settle();
    assert.equal(f.state.reads[0].lastMessageId, 20);
    assert.ok(badge.classList.contains('hidden'));
    f.state.resolveRead();
    await f.settle();
    f.controller.close();
    f.controller.refresh();
    await f.settle();
    assert.ok(badge.classList.contains('hidden'));
  });
});

describe("Party message history", () => {
  const { appendPartyChatLog, recordPartyRoster, getPartyChatLogs } = require('../src/server/services/party/partyChatLog');
  function fixture() {
    const events = [];
    const io = createFakeIo({ onEmit: (room, name, data) => events.push({ room, name, data }) });
    return {io,events};
  }
  test('join and leave logs track membership, not presence or repeated rosters', () => {
    const {io,events} = fixture();
    recordPartyRoster(io, 7, [{name:'Alice',status:'online'}]);
    recordPartyRoster(io, 7, [{name:'Alice',status:'offline'}]);
    assert.equal(events.length, 0);
    recordPartyRoster(io, 7, [{name:'Alice'},{name:'Bob'}]);
    recordPartyRoster(io, 7, [{name:'Bob'}]);
    assert.deepEqual(getPartyChatLogs(io,7).map(e=>e.body), ['Bob joined the party','Alice left the party']);
    assert.ok(events.every(e=>e.name==='party-chat:system'));
    assert.deepEqual(getPartyChatLogs(io,8), []);
  });
  test('battle results deduplicate and recent logs survive history reads without generating messages', () => {
    const {io,events} = fixture();
    appendPartyChatLog(io,7,{kind:'battle',body:'Battle ended. Team 1 won',key:'battle:12'});
    appendPartyChatLog(io,7,{kind:'battle',body:'Battle ended. Team 1 won',key:'battle:12'});
    appendPartyChatLog(io,7,{kind:'map',body:'Alice changed map to Castle'});
    appendPartyChatLog(io,7,{kind:'mode',body:'Alice changed mode to Duels'});
    assert.equal(getPartyChatLogs(io,7).length,3);
    assert.equal(events.length,3);
    assert.ok(events.every(e=>e.name==='party-chat:system'));
  });
  test('system log memory is bounded per party', () => {
    const {io} = fixture();
    for(let i=0;i<120;i++) appendPartyChatLog(io,7,{kind:'map',body:`Map ${i}`});
    assert.equal(getPartyChatLogs(io,7).length,100);
    assert.equal(getPartyChatLogs(io,7)[0].body,'Map 20');
  });
});

test('friends waits for account status and skips the protected endpoint for a guest', async t => {
  const { createLobbyFixture } = require('./helpers/lobbyFixture');
  const requests = [];
  const f = createLobbyFixture({ globals: { fetch: async url => {
    requests.push(url);
    return { ok: true, json: async () => ({}) };
  } } });
  const controller = f.load('src/client/friends/friendsPanelController.js').createFriendsPanelController({
    socket: f.socket, waitForAccount: true,
  });
  t.after(() => controller.destroy());
  f.socket.emit('connect');
  await controller.refresh();
  controller.setAccountGuest(true);
  f.socket.emit('connect');
  await f.settle();
  assert.deepEqual(requests, []);
  assert.equal(controller.isGuest(), true);
  await controller.setAccountGuest(false);
  assert.deepEqual(requests, ['/friends']);
});

test('friends drawer derives relationships from the loaded roster and releases its listeners on destroy', async () => {
  const { createLobbyFixture } = require('./helpers/lobbyFixture');
  const f = createLobbyFixture({ globals: { fetch: async url => {
    assert.equal(url, '/friends');
    return { ok: true, json: async () => ({
      me: { name: 'Owner', userId: 1 },
      friends: [{ name: 'Teammate', userId: 2, status: 'online' }],
      incoming: [{ user: { name: 'Visitor', userId: 3 } }],
      outgoing: [{ user: { name: 'Pending', userId: 4 } }],
    }) };
  } } });
  const controller = f.load('src/client/friends/friendsPanelController.js').createFriendsPanelController({ socket: f.socket });
  await f.settle();
  assert.equal(controller.relationshipFor('owner'), 'self');
  assert.equal(controller.relationshipFor(' Teammate '), 'friends');
  assert.equal(controller.relationshipFor('Visitor'), 'incoming');
  assert.equal(controller.relationshipFor('Pending'), 'outgoing');
  controller.open();
  await f.settle();
  assert.equal(controller.isOpen(), true);
  assert.ok(f.socket.eventNames().length > 0);
  controller.destroy();
  assert.equal(f.document.querySelector('.bb-friends-panel'), null);
  assert.equal(f.socket.eventNames().length, 0);
});

test('direct-message badges clear on opening a conversation and typing stops when leaving it', async () => {
  const { API_PATHS } = require('../src/shared/net/apiPaths');
  const { SOCKET_EVENTS } = require('../src/shared/net/socketEvents');
  const requests = [];
  const f = createBrowserFixture('', { globals: { fetch: async (url, options) => {
    requests.push({ url, body: options.body && JSON.parse(options.body) });
    return { ok: true, json: async () => url === API_PATHS.FRIENDS ? {
      me: { userId: 1, name: 'Bob' },
      friends: [{ userId: 2, name: 'Alice', status: 'online' }],
    } : { messages: [] } };
  } } });
  const controller = f.load('src/client/friends/friendsPanelController.js').createFriendsPanelController({ socket: f.socket });
  await f.settle();
  controller.open();
  await f.settle();
  f.socket.emit(SOCKET_EVENTS.FRIENDS_MESSAGE, {
    message: { senderId: 2, recipientId: 1, messageId: 3, body: 'Ready?' },
  });
  const badge = f.document.querySelector('.bb-friends-launcher .bb-chat-badge');
  assert.equal(badge.textContent, '1');
  assert.ok(!badge.classList.contains('hidden'));
  f.document.querySelector('[aria-label="Chat with Alice"]').click();
  await f.settle();
  assert.ok(badge.classList.contains('hidden'));
  assert.ok(requests.some(request => request.url === API_PATHS.FRIENDS_MESSAGES_READ && request.body?.friendId === 2));

  const typing = [];
  f.socket.on(SOCKET_EVENTS.FRIENDS_TYPING, value => typing.push(value));
  const textarea = f.document.querySelector('.bb-friends-chat textarea');
  f.event(textarea, 'input');
  f.event(textarea, 'input');
  f.document.querySelector('.bb-friends-back').click();
  assert.deepEqual(typing.map(value => ({ ...value })), [
    { friendId: 2, isTyping: true },
    { friendId: 2, isTyping: false },
  ]);
  controller.destroy();
  assert.equal(f.socket.listenerCount(SOCKET_EVENTS.FRIENDS_MESSAGE), 0);
});
