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
