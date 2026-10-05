const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('map music fades from its current intensity, honors mute during fades, and disposes', () => {
  let time = 0, id = 0, listener, unsubscribed = false;
  const frames = new Map(), settings = { music: 1 }, audio = {};
  const source = fs.readFileSync(require.resolve('../src/client/lib/musicEnvelope.js'), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/^export /gm, '');
  const bind = vm.runInNewContext(source + '; bindMusicEnvelope', {
    getSettings: () => settings,
    subscribeSettings: fn => { listener = fn; return () => { unsubscribed = true; }; },
    performance: { now: () => time },
    requestAnimationFrame: fn => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  const advance = ms => { time += ms; const work = [...frames.values()]; frames.clear(); work.forEach(fn => fn()); };
  const envelope = bind(audio, .2, .3);
  assert.equal(audio.volume, 0);
  advance(1200); assert.equal(audio.volume, .06);
  envelope.fade(1); advance(500);
  assert.ok(audio.volume > .06 && audio.volume < .2);
  const halfway = audio.volume;
  settings.music = 0; listener(); advance(100);
  assert.equal(audio.volume, 0);
  settings.music = .5; listener();
  assert.ok(audio.volume > halfway / 2);
  envelope.fade(.3); advance(1000);
  assert.ok(Math.abs(audio.volume - .03) < 1e-8);
  envelope.fade(1); envelope.dispose(); advance(1000);
  assert.equal(frames.size, 0);
  assert.equal(unsubscribed, true);
});

test('settings synchronize navigation and independently bundled pages without feedback loops', () => {
  const listeners = new Map();
  const window = {
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
  };
  let saved;
  const source = fs.readFileSync(require.resolve('../src/client/site/preferences.js'), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/^export /gm, '');
  function bundle() {
    return vm.runInNewContext(source + '; ({ getSettings, saveSettings, subscribeSettings })', {
      window, CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
      localStorage: { getItem: () => saved, setItem: (_, value) => { saved = value; } },
      DEFAULT_BINDINGS: {}, normalizeBindings: value => value || {},
    });
  }
  const navigation = bundle(), page = bundle();
  let navEvents = 0, pageEvents = 0;
  navigation.subscribeSettings(() => navEvents++); page.subscribeSettings(() => pageEvents++);
  page.saveSettings({ music: 0, sfx: .4 });
  assert.equal(navigation.getSettings().music, 0);
  assert.equal(navigation.getSettings().sfx, .4);
  assert.equal(navEvents, 1); assert.equal(pageEvents, 1);
});
