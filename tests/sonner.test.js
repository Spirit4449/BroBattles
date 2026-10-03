const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

function compile(path) {
  return babel.transformSync(fs.readFileSync(path, 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
}

function fixture() {
  const api = {}, sounds = [], intervals = [];
  const nodes = new Map();
  function node() {
    return {
      children: [], selectors: new Map(), handlers: {}, textContent: '',
      classList: { add() {}, remove() {} }, style: { setProperty() {} },
      setAttribute() {}, addEventListener(type, fn) { this.handlers[type] = fn; },
      appendChild(child) { this.children.push(child); },
      insertBefore(child) { this.children.unshift(child); },
      remove() { this.removed = true; },
      querySelector(selector) {
        if (!this.selectors.has(selector)) this.selectors.set(selector, node());
        const found = this.selectors.get(selector);
        return found.removed ? null : found;
      },
    };
  }
  vm.runInNewContext(compile('src/lib/sonner.js'), {
    exports: api,
    require: name => name.includes('maintenance')
      ? { maintenanceClock: () => '02:30' }
      : { playSound: (...args) => sounds.push(args) },
    document: {
      getElementById: id => nodes.get(id), createElement: node,
      body: { appendChild(el) { nodes.set(el.id, el); } },
    },
    requestAnimationFrame: fn => fn(), setTimeout: () => 1, clearTimeout() {},
    setInterval: fn => { intervals.push(fn); return 1; }, clearInterval() {},
  });
  return { ...api, sounds, intervals };
}

test('description-only notifications remove the heading and keep actions and tone', () => {
  const { sonner } = fixture();
  let joined = false;
  const { el } = sonner(null, 'Admin invited you to their party.', 'Join', close => { joined = true; close(); }, { tone: 'success' });
  assert.equal(el.querySelector('.sonner__hdr'), null);
  assert.equal(el.querySelector('.sonner__msg').textContent, 'Admin invited you to their party.');
  assert.match(el.className, /sonner--success sonner--description/);
  const button = el.querySelector('.sonner__actions').children[0];
  assert.equal(button.textContent, 'Join');
  button.handlers.click();
  assert.equal(joined, true);
});

test('explicit description layout and legacy single-line notices have no empty heading', () => {
  const { sonner } = fixture();
  for (const result of [
    sonner('Friend request', 'You already sent admin a request.', 'OK', undefined, { layout: 'description' }),
    sonner('Party settings updated', undefined, 'success'),
  ]) {
    assert.equal(result.el.querySelector('.sonner__hdr'), null);
    assert.ok(result.el.querySelector('.sonner__msg').textContent);
  }
});

test('detailed errors retain the heading and useful instructions', () => {
  const { sonner } = fixture();
  const { el } = sonner('Too many players for this duel size', 'Remove players or choose a larger duel size.', 'error');
  assert.equal(el.querySelector('.sonner__hdr').textContent, 'Too many players for this duel size');
  assert.equal(el.querySelector('.sonner__msg').textContent, 'Remove players or choose a larger duel size.');
  assert.equal(el.querySelector('.sonner__actions').children[0].textContent, 'OK');
});

test('technical errors become recovery advice without stripping gameplay details', () => {
  const { friendlyToastMessage, sonner } = fixture();
  assert.match(friendlyToastMessage('Failed to fetch'), /Check your connection/);
  assert.match(friendlyToastMessage('ER_BAD_FIELD_ERROR: unknown column'), /Please try again/);
  assert.match(friendlyToastMessage('Unexpected token < in JSON'), /Please try again/);
  assert.match(friendlyToastMessage('Apply the party member selection migration before changing this setting.'), /Please try again/);
  assert.match(friendlyToastMessage('Unknown iconId'), /choose another icon/);
  assert.match(friendlyToastMessage('cardId is required'), /choose another card/);
  for (const message of [
    'You already sent admin a request.',
    'You already sent SQL a request.',
    'SQL is offline right now.',
    'TypeError declined your request. You can try again in a few minutes.',
    'You already sent migration a request.',
    'You can invite Bolt again in 25s.',
    'Only the party owner can move players.',
    'Public party names must be 32 characters or fewer.',
    'Matchmaking suspended for 5 minutes.',
  ]) assert.equal(friendlyToastMessage(message), message);
  const { el } = sonner('Could not equip profile icon', 'Failed to fetch', 'error');
  assert.match(el.querySelector('.sonner__msg').textContent, /Check your connection/);
});

test('maintenance description keeps countdown and legacy options and sound', () => {
  const { sonner, sounds, intervals } = fixture();
  const { el } = sonner(null, 'New matches currently disabled for maintenance.', 'error', { maintenanceUntil: 123, sound: 'notification' });
  assert.equal(el.querySelector('.sonner__hdr'), null);
  assert.equal(el.querySelector('.sonner__msg').textContent, 'Matchmaking is paused for maintenance. Please try again later. ◷ 02:30 remaining');
  assert.equal(intervals.length, 1);
  assert.equal(sounds[0][0], 'notification');
});

test('friend and chat errors omit redundant headings and retain suspension time', () => {
  const api = {}, calls = [];
  vm.runInNewContext(compile('src/chat/presentation.js'), {
    exports: api,
    require: name => name.includes('sonner') ? { sonner: (...args) => calls.push(args) } : {},
  });
  api.showChatRequestError({ statusCode: 409, message: 'You already sent admin a request.' }, 'Could not send friend request');
  assert.equal(calls[0][0], null);
  assert.equal(calls[0][1], 'You already sent admin a request.');
  api.showChatRequestError({ statusCode: 403, message: 'Chat temporarily suspended.', payload: { suspendedUntilMs: Date.now() + 60000 } }, 'Message not sent');
  assert.match(calls[1][1], /Chat temporarily suspended\..*remaining/);
  api.showChatRequestError(new Error('Failed to fetch'), 'Could not load messages');
  assert.equal(calls[2][0], 'Could not load messages');
  assert.match(calls[2][1], /Check your connection/);
  api.showChatRequestError({ statusCode: 500, message: 'SQL failed' }, 'Message not sent');
  assert.equal(calls[3][0], 'Message not sent');
  assert.doesNotMatch(calls[3][1], /SQL/);
  assert.equal(calls[3][4].tone, 'error');
});
