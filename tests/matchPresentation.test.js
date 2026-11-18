const { loadClientModule } = require('./helpers/clientModule');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe("HUD preparation and match cues", () => {
  const root = path.resolve(__dirname, "..");

  test("controls and spectate actions run once when the HUD is initialized twice", () => {
    const classes = { remove() {} };
    const keybind = { classList: classes, dataset: {}, querySelectorAll: () => [] };
    const makeButton = () => Object.assign(new EventTarget(), { setAttribute() {} });
    const toggle = makeButton();
    const previous = makeButton();
    let moves = 0;
    const nodes = {
      "battle-keybind-hud": keybind,
      "battle-keybind-toggle": toggle,
      "spectate-previous": previous,
    };
    const { createGameHudController } = loadClientModule(path.join(root, "src/client/game/hud/gameHudController.js"), {
      require: name => name.includes("preferences") ? {
        getSettings: () => ({}),
        subscribeSettings: () => () => {},
      } : name.includes("controlsGuide") ? { updateControlsGuide() {} } : {},
      window: new EventTarget(),
      document: Object.assign(new EventTarget(), {
        getElementById: id => nodes[id],
        querySelector: () => null,
      }),
    });
    const hud = createGameHudController({ onSpectatePrevious: () => moves++ });
    hud.initKeybindHud();
    hud.initKeybindHud();
    hud.initSpectateHud();
    hud.initSpectateHud();

    toggle.dispatchEvent(new Event("click"));
    previous.dispatchEvent(new Event("click"));
    assert.equal(keybind.dataset.state, "collapsed");
    assert.equal(moves, 1);
  });

  test("cards prepare once per cosmetic before pregame and pause during the flythrough", () => {
    const exported = {}, requests = [], warmed = [], idle = [], paused = [];
    let holds = 0;
    const catalog = require('../src/shared/catalogs/playerCardsCatalog.cjs');
    const [selfCard, opponentCard] = catalog.cards.filter(card => card.id !== catalog.defaultCardId);
    loadClientModule(path.join(root, "src/client/game/hud/gameHudController.js"), {
      exports: exported,
      require: name => name.includes('playerCardAnimation') ? {
        warmEquippedPlayerCard(card) { warmed.push(card.id); },
        createPlayerCardMedia(card, options) {
          requests.push({ id: card.id, ...options });
          assert.deepEqual(warmed, [selfCard.id], 'warm self before preparing any roster media');
          return { id: card.id };
        },
        pausePlayerCardPreparation(media, value) { paused.push([media.id, value]); },
      } : {},
      fetch() { throw new Error('Catalog resolution must not fetch'); },
      window: { addEventListener() {}, requestIdleCallback: fn => idle.push(fn),
        __BB_NAVIGATION__: { holdGameplayDownloads() { holds++; return () => holds--; } } },
      document: { body: { classList: { toggle() {} } } },
    });
    const hud = exported.createGameHudController({
      getUsername: () => 'self',
      getGameData: () => ({ players: [
        { name: 'opponent', selected_card_id: opponentCard.id },
        { name: 'self', selected_card_id: selfCard.id },
        { name: 'teammate', selected_card_id: selfCard.id },
      ] }),
    });
    hud.prepareBattleCards();
    while (idle.length) idle.shift()();
    assert.deepEqual(requests, [
      { id: opponentCard.id, prepare: true }, { id: selfCard.id, prepare: true },
    ]);
    assert.ok(requests.every(request => !request.interactive));
    hud.setPregameActive(true);
    hud.setPregameActive(true);
    assert.equal(holds, 1);
    assert.equal(requests.length, 2, 'the flythrough must not initiate card preparation');
    assert.deepEqual(paused.slice(0, 2), [[opponentCard.id, true], [selfCard.id, true]]);
    hud.setPregameActive(false);
    assert.equal(holds, 0);
    assert.deepEqual(paused.slice(-2), [[opponentCard.id, false], [selfCard.id, false]]);
  });

  test("final countdown cue plays once alongside FIGHT and enabling input", () => {
    const exported = {}, calls = [], preloaded = [], timers = [], risers = [];
    const { COUNTDOWN_MS, COUNTDOWN_RISER_MS } = require('../src/shared/matchIntroTiming');
    const countdown = { style: {}, textContent: '' };
    let now = 0, fights = 0, enabled = 0;
    loadClientModule(path.join(root, "src/client/game/hud/gameHudController.js"), {
      exports: exported,
      require: name => name.includes('uiSounds') ? {
        playSound: key => calls.push({ key, time: now, display: countdown.textContent }),
        preloadSound: key => preloaded.push(key),
      } : name.includes('countdownSfx') ? {
        playCountdownThump() {},
        playCountdownRiser: duration => risers.push({ duration, time: now }),
        playFightBoom() {},
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
    assert.deepEqual(risers, [{ duration: COUNTDOWN_RISER_MS, time: COUNTDOWN_MS - COUNTDOWN_RISER_MS }]);
    assert.equal(fights, 1);
    assert.equal(enabled, 1);
  });

});

describe("Pregame camera lifecycle", () => {
  const exported = {};
  loadClientModule(require.resolve('../src/client/game/scene/pregameFlythrough.js'), { exports: exported, Math });
  const { planFlythrough, sampleFlythrough, clampCenter, fitZoom, blendFraming, OPENING_HOLD, TOUR_HOLD } = exported;

  const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
  // Objects from the vm realm have a foreign prototype; compare fields.
  const sameFraming = (a, b, message) =>
    assert.deepEqual({ x: a.x, y: a.y, zoom: a.zoom }, { x: b.x, y: b.y, zoom: b.zoom }, message);

  // One calm move: a still opening hold, no direction reversals, no jumps,
  // never outside the bounds, landing exactly on the follow framing.

  test('a cut-short blend starts where the camera is and lands on the target', () => {
    const from = { x: 100, y: 50, zoom: 1 }, to = { x: 900, y: 300, zoom: 1.8 };
    sameFraming(blendFraming(from, to, 0), from);
    const end = blendFraming(from, to, 1);
    assert.ok(close(end.x, 900) && close(end.y, 300) && close(end.zoom, 1.8));
  });
});

test('inactive poison stays below tall arenas and resets after sudden death', () => {
  const { createPoisonState, renderPoisonWater } = loadClientModule('src/client/game/scene/poisonWaterRenderer.js', {
    require: name => name === './gameViewport'
      ? loadClientModule('src/client/game/scene/gameViewport.js')
      : {},
    document: { getElementById: () => null },
  });
  const poisonState = createPoisonState();
  let draws = 0;
  const scene = {
    time: { now: 0 },
    physics: { world: { bounds: { y: 0, height: 1420, width: 2300 } } },
    game: { config: { height: 1000 } },
    _poisonGraphics: { clear() {}, fillStyle() {}, fillRect() { draws++; } },
  };
  renderPoisonWater(scene, { poisonState });
  assert.equal(draws, 0, 'no poison before the first timer update');
  poisonState.targetY = 1100;
  scene.time.now += 50;
  renderPoisonWater(scene, { poisonState });
  assert.ok(draws > 0, 'server sudden-death level draws poison');
  draws = 0;
  poisonState.targetY = null;
  scene.time.now += 50;
  renderPoisonWater(scene, { poisonState });
  assert.equal(draws, 0, 'inactive poison disappears without lerping through the arena');
});
