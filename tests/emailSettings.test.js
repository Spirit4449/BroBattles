const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

test('email settings request is made only for a confirmed member profile', async () => {
  const source = babel.transformSync(fs.readFileSync('src/lib/emailSettings.js', 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  const toggle = { dataset: {}, addEventListener() {} };
  const status = { textContent: '' };
  const api = {};
  vm.runInNewContext(source, {
    exports: api,
    require: () => ({}),
    document: { getElementById: id => id === 'email-toggle' ? toggle : status },
  });
  const requests = [];
  const fetchJson = async url => { requests.push(url); return { email: 'member@example.com' }; };

  api.wireEmailSettings(fetchJson, { guest: true });
  api.wireEmailSettings(fetchJson, {});
  assert.deepEqual(requests, []);
  assert.equal(toggle.dataset.emailWired, undefined);

  api.wireEmailSettings(fetchJson, { guest: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, ['/profile/email']);
  assert.equal(status.textContent, 'member@example.com');
  api.wireEmailSettings(fetchJson, { guest: false });
  assert.equal(requests.length, 1);
});

test('preference feedback uses modal Sonner and Escape leaves the underlying profile alone', async () => {
  const source = babel.transformSync(fs.readFileSync('src/lib/emailSettings.js', 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  function node() {
    return { dataset: {}, handlers: {}, value: '', textContent: '', hidden: false,
      classList: { toggle() {} }, addEventListener(type, fn) { this.handlers[type] = fn; },
      setAttribute() {}, focus() {}, append() {}, remove() {} };
  }
  const toggle = node(), status = node(), children = new Map(), dialog = node();
  dialog.querySelector = selector => {
    if (!children.has(selector)) children.set(selector, node());
    return children.get(selector);
  };
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.handlers.close(); };
  const listeners = new Map(), toasts = [], api = {};
  const cooldown = { remaining: () => 32, set() {}, dispose() {} };
  vm.runInNewContext(source, {
    exports: api,
    require: name => name.includes('sonner.js') ? { sonner: (...args) => toasts.push(args) }
      : name.includes('emailVerificationUI') ? { createCooldown: () => cooldown, wireCodeInputs: () => ({clear() {},focus() {},value: () => '123456'}) }
      : { wireBackdropDismiss() {} },
    window: { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) },
    document: { getElementById: id => id === 'email-toggle' ? toggle : status,
      createElement: tag => tag === 'dialog' ? dialog : node(), body: {append() {}} },
  });
  let fail = false;
  api.wireEmailSettings(async (url, options) => {
    if (options && fail) throw new Error('Try again');
    return url.endsWith('/marketing') ? {subscribed:false} : {email:'member@example.com'};
  }, {guest:false});
  await new Promise(resolve => setImmediate(resolve));
  toggle.handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  const marketing = children.get('[data-marketing]');
  marketing.checked = true;
  await marketing.handlers.change();
  assert.equal(toasts[0][0], 'Email preference saved.');
  assert.equal(toasts[0][4].containerId, 'email-settings-toasts');
  assert.equal(children.get('[data-message]').hidden, true);
  assert.equal(children.get('[data-send]').textContent, 'Send code in 32 sec');
  fail = true;
  marketing.checked = false;
  await marketing.handlers.change();
  assert.equal(marketing.checked, true);
  assert.equal(toasts[1][4].tone, 'error');
  let prevented = false, stopped = false;
  listeners.get('keydown')({key:'Escape', preventDefault() {prevented=true;}, stopImmediatePropagation() {stopped=true;}});
  assert.equal(dialog.open, false);
  assert.ok(prevented && stopped);
  assert.equal(listeners.has('keydown'), false);
});
