const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const babel = require("@babel/core");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("pregame cards preserve speculative network limits and prioritize the local selection", async () => {
  const exported = {}, requests = [], warmed = [];
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
        return {};
      },
    } : {},
    fetch: async () => ({ ok: true, json: async () => ({ catalog: { cards, defaultCardId: 'default' } }) }),
    window: { addEventListener() {} },
    document: { body: { classList: { toggle() {} } } },
  });
  const hud = exported.createGameHudController({
    getUsername: () => 'self',
    getGameData: () => ({ players: [
      { name: 'opponent', selected_card_id: 'opponent-card' },
      { name: 'self', selected_card_id: 'self-card' },
    ] }),
  });
  hud.setPregameActive(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, [
    { id: 'opponent-card', prepare: true }, { id: 'self-card', prepare: true },
  ]);
  assert.ok(requests.every(request => !request.interactive));
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
