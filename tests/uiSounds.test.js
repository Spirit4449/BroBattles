const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const listeners = new Map();
  const played = [];
  const queued = [];
  const disposals = [];
  class AudioStub {
    addEventListener() {}
    removeEventListener() {}
    load() {}
    play() { played.push({ src: this.src, volume: this.volume }); return Promise.resolve(); }
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/client/ui/uiSounds.js'), 'utf8')
    .replace(/^import .*;$/gm, '').replaceAll('export function', 'function');
  const api = vm.runInNewContext(source + '; ({ initUISounds, playSound, soundFiles })', {
    Audio: AudioStub,
    document: {
      addEventListener(name, handler) {
        const list = listeners.get(name) || []; list.push(handler); listeners.set(name, list);
      },
      removeEventListener(name, handler) {
        listeners.set(name, listeners.get(name).filter(value => value !== handler));
      },
    },
    window: { __BB_PAGE_SCOPE__: { onDispose: fn => disposals.push(fn) } },
    setTimeout: fn => queued.push(fn),
    getSettings: () => ({ sfx: 0.5 }), subscribeSettings() {}, shouldMuteClientDefaultLogs: () => true,
  });
  const flush = () => { while (queued.length) queued.shift()(); };
  const click = (target, handler = () => {}) => {
    const event = { target, eventPhase: 1 };
    for (const listener of listeners.get('click') || []) listener(event);
    handler();
    event.eventPhase = 0;
    flush();
  };
  api.initUISounds();
  return { ...api, listeners, played, click, flush, disposals };
}

function control(attributes = {}) {
  return {
    disabled: false,
    closest(selector) {
      if (selector.startsWith(':disabled')) return this.disabled || attributes['aria-disabled'] === 'true' ? this : null;
      return this;
    },
    getAttribute(name) { return attributes[name] ?? null; },
    contains(node) { return node === this; },
  };
}

test('dynamic buttons and nested artwork receive one cue even if handlers stop bubbling or disable the button', () => {
  const ui = setup();
  const button = control();
  const artwork = { closest: selector => button.closest(selector) };
  ui.click(artwork, () => { button.disabled = true; });
  assert.equal(ui.played.length, 1);
  assert.equal(ui.played[0].src, '/assets/ui-sound/Cursor4.wav');
  assert.equal(ui.played[0].volume, 0.15);
});

test('custom manual cues take priority over automatic sounds and repeated bubbling cues are deduplicated', () => {
  const ui = setup();
  ui.click(control({ 'data-sound': 'cursor4' }), () => {
    ui.playSound('cancel', 0.4);
    ui.playSound('cancel', 0.4);
  });
  assert.equal(ui.played.length, 1);
  assert.equal(ui.played[0].src, '/assets/ui-sound/cancel.mp3');
  // Independent programmatic cues are unaffected.
  ui.playSound('cancel');
  ui.playSound('cancel');
  assert.equal(ui.played.length, 3);
});

test('disabled and opted-out controls stay silent; zero and invalid volumes are handled', () => {
  const ui = setup();
  const disabled = control(); disabled.disabled = true;
  ui.click(disabled);
  ui.click(control({ 'aria-disabled': 'true' }));
  ui.click(control({ 'data-sound': 'none' }));
  ui.click(control({ 'data-sound': '' }));
  assert.equal(ui.played.length, 0);
  ui.click(control({ 'data-volume': '0' }));
  ui.click(control({ 'data-volume': 'oops' }));
  assert.deepEqual(ui.played.map(sound => sound.volume), [0, 0.15]);
});

test('initialization is idempotent and disposal cancels queued sounds and allows reinitialization', () => {
  const ui = setup();
  ui.initUISounds();
  assert.equal(ui.listeners.get('click').length, 1);
  ui.listeners.get('click')[0]({ target: control() });
  ui.disposals[0]();
  ui.flush();
  assert.equal(ui.played.length, 0);
  assert.equal(ui.listeners.get('click').length, 0);
  ui.initUISounds();
  ui.click(control());
  assert.equal(ui.played.length, 1);
});

test('hover cues ignore disabled controls and movement between children and honor zero volume', () => {
  const ui = setup();
  const hover = ui.listeners.get('pointerover')[0];
  const button = control({ 'data-sound-hover': 'cursor3', 'data-volume': '0' });
  hover({ target: button, relatedTarget: button });
  button.disabled = true;
  hover({ target: button, relatedTarget: null });
  assert.equal(ui.played.length, 0);
  button.disabled = false;
  hover({ target: button, relatedTarget: null });
  assert.equal(ui.played.length, 1);
  assert.equal(ui.played[0].volume, 0);
});

test('all registered sound names resolve to existing assets without failing over missing files', () => {
  const { soundFiles } = setup();
  for (const [name, file] of Object.entries(soundFiles)) {
    const relative = file.startsWith('/') ? file.slice(1) : `assets/ui-sound/${file}`;
    const sources = /\.[a-z0-9]+$/i.test(file) ? [relative] : ['.mp3', '.wav', '.ogg'].map(ext => relative + ext);
    assert.ok(sources.some(source => fs.existsSync(path.join(__dirname, '../public', source))), name);
  }
});


test('separate clicks and unrelated sounds before the deferred cue do not silence each other', () => {
  const ui = setup();
  const capture = ui.listeners.get('click')[0];
  for (let i = 0; i < 2; i++) {
    const event = { target: control(), eventPhase: 1 };
    capture(event);
    event.eventPhase = 0;
  }
  ui.playSound('notification');
  ui.flush();
  assert.equal(ui.played.length, 3);
  assert.equal(ui.played.filter(sound => sound.src.endsWith('Cursor4.wav')).length, 2);
});


test('X and accessible close buttons use cancel, with no extra cue when the close handler already plays it', () => {
  const ui = setup();
  const x = control(); x.textContent = ' × ';
  ui.click(x);
  ui.click(control({ 'aria-label': 'Close loadout' }));
  ui.click(x, () => ui.playSound('cancel', 0.3));
  assert.equal(ui.played.length, 3);
  assert.ok(ui.played.every(sound => sound.src.endsWith('/cancel.mp3')));
});

test('Ready and matchmaking Cancel explicitly opt out of added click sounds', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  for (const id of ['ready', 'mm-cancel']) {
    const tag = html.match(new RegExp('<[^>]+id="' + id + '"[^>]*>'))?.[0];
    assert.ok(tag?.includes('data-sound="none"'), id);
  }
});
