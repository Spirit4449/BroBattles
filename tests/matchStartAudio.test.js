const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const babel = require("@babel/core");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("cards prepare once per cosmetic before pregame and pause during the flythrough", () => {
  const exported = {}, requests = [], warmed = [], idle = [], paused = [];
  let holds = 0;
  const cards = [{ id: 'default' }, { id: 'self-card' }, { id: 'opponent-card' }];
  const code = babel.transformSync(read("src/client/game/hud/gameHudController.js"), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  vm.runInNewContext(code, {
    exports: exported,
    require: name => name.includes('playerCardAnimation') ? {
      warmEquippedPlayerCard(card) { warmed.push(card.id); },
      createPlayerCardMedia(card, options) {
        requests.push({ id: card.id, ...options });
        assert.deepEqual(warmed, ['self-card'], 'warm self before preparing any roster media');
        return { id: card.id };
      },
      pausePlayerCardPreparation(media, value) { paused.push([media.id, value]); },
    } : name.includes('playerCardsCatalog') ? { cards, defaultCardId: 'default' } : {},
    fetch() { throw new Error('Catalog resolution must not fetch'); },
    window: { addEventListener() {}, requestIdleCallback: fn => idle.push(fn),
      __BB_NAVIGATION__: { holdGameplayDownloads() { holds++; return () => holds--; } } },
    document: { body: { classList: { toggle() {} } } },
  });
  const hud = exported.createGameHudController({
    getUsername: () => 'self',
    getGameData: () => ({ players: [
      { name: 'opponent', selected_card_id: 'opponent-card' },
      { name: 'self', selected_card_id: 'self-card' },
      { name: 'teammate', selected_card_id: 'self-card' },
    ] }),
  });
  hud.prepareBattleCards();
  while (idle.length) idle.shift()();
  assert.deepEqual(requests, [
    { id: 'opponent-card', prepare: true }, { id: 'self-card', prepare: true },
  ]);
  assert.ok(requests.every(request => !request.interactive));
  hud.setPregameActive(true);
  hud.setPregameActive(true);
  assert.equal(holds, 1);
  assert.equal(requests.length, 2, 'the flythrough must not initiate card preparation');
  assert.deepEqual(paused.slice(0, 2), [['opponent-card', true], ['self-card', true]]);
  hud.setPregameActive(false);
  assert.equal(holds, 0);
  assert.deepEqual(paused.slice(-2), [['opponent-card', false], ['self-card', false]]);
});

test("final countdown cue plays once alongside FIGHT and enabling input", () => {
  const exported = {}, calls = [], preloaded = [], timers = [];
  const countdown = { style: {}, textContent: '' };
  let now = 0, fights = 0, enabled = 0;
  const code = babel.transformSync(read("src/client/game/hud/gameHudController.js"), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  vm.runInNewContext(code, {
    exports: exported,
    require: name => name.includes('uiSounds') ? {
      playSound: key => calls.push({ key, time: now, display: countdown.textContent }),
      preloadSound: key => preloaded.push(key),
    } : {},
    window: { addEventListener() {} },
    document: { getElementById: id => id === 'countdown-display' ? countdown : null },
    setTimeout: (fn, ms) => timers.push({ fn, time: now + ms }),
    clearTimeout() {},
  });
  const hud = exported.createGameHudController({
    onCountdownFight: () => fights++, onEnableInput: () => enabled++,
  });
  hud.startCountdown(); hud.startCountdown();
  assert.deepEqual(preloaded, ['beep', 'start']);
  while (timers.length) {
    timers.sort((a, b) => a.time - b.time);
    const timer = timers.shift(); now = timer.time; timer.fn();
  }
  assert.deepEqual(calls.map(call => call.key), ['beep', 'beep', 'beep', 'beep', 'beep', 'start']);
  assert.equal(calls.at(-1).display, 'FIGHT!');
  assert.equal(fights, 1);
  assert.equal(enabled, 1);
});

test("match result cues distinguish draws and wait for audio unlock", () => {
  const exported = {}, calls = [], pending = [];
  let paused = 0;
  const document = { hidden: false };
  const code = babel.transformSync(read("src/client/game/audio/matchAudio.js"), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  vm.runInNewContext(code, { exports: exported, require: () => ({}), document });
  const scene = {
    _bgmEl: { pause() { paused++; } },
    sound: {
      locked: false,
      play(key) { calls.push(key); },
      once(event, callback) { assert.equal(event, 'unlocked'); pending.push(callback); },
    },
  };
  for (const outcome of [null, 'draw', 'red', 'blue']) {
    exported.playMatchEndSound(scene, outcome, 'red');
  }
  assert.deepEqual(calls, ['draw', 'draw', 'win', 'lose']);
  assert.equal(paused, 4);
  scene.sound.locked = true;
  exported.playMatchEndSound(scene, null, 'red');
  assert.equal(calls.length, 4);
  pending.shift()();
  assert.equal(calls.at(-1), 'draw');
  assert.equal(paused, 5);
  document.hidden = true;
  exported.playMatchEndSound(scene, null, 'red');
  assert.equal(pending.length, 0);
  assert.equal(calls.length, 5);
});
