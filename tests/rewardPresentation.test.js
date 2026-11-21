const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadClientModule } = require('./helpers/clientModule');
const { loadUISounds } = require('./helpers/uiSoundModule');
const path = require('node:path');

describe("Rewards and wallet", () => {
  const { test, describe } = require('node:test');

  describe("Reward reveal and flight", () => {

    // The module imports the shared currency art helper, so load its real dependency graph.
    const { resolveRewardGrants } = require('./helpers/clientModule').createClientModuleGraph().load(require.resolve('../src/client/views/rewardPresentation.js'));

    test('reward reveals use receipt grants after rotation or catalog changes', () => {
      const display = [{ kind: 'currency', currency: 'coins', amount: 75, name: 'Coins' }, { kind: 'card', id: 'old-card' }];
      const grants = resolveRewardGrants([{ kind: 'currency', currency: 'gems', amount: 5 }], display);
      assert.equal(grants.length, 1);
      assert.equal(grants[0].currency, 'gems');
      assert.equal(grants[0].amount, 5);
      assert.equal(resolveRewardGrants([], display).length, 0);
      assert.equal(resolveRewardGrants(undefined, display), display);
      const changed = resolveRewardGrants([{ kind: 'currency', currency: 'coins', amount: 100 }], display);
      assert.equal(changed[0].name, 'Coins');
      assert.equal(changed[0].amount, 100);
    });

  });

  describe("Reward cues and lazy audio", () => {
    test('match reward cues skip locked and uncached audio, then play through the scene with bounded overlap', () => {
      const { getUISoundSources } = loadUISounds();
      const { preloadMatchRewardSounds, playMatchRewardSound } = loadClientModule(
        require.resolve('../src/client/game/audio/matchAudio.js'), {
          require: name => name.includes('uiSounds') ? { getUISoundSources } : {},
          document: { hidden: false },
        },
      );
      const queued = new Map();
      const playing = [];
      let cached = false;
      let active = true;
      const scene = {
        sys: { isActive: () => active },
        load: { audio: (key, urls, { instances }) => queued.set(key, { urls, instances }) },
        cache: { audio: { exists: key => cached && queued.has(key) } },
        sound: {
          locked: true,
          getAllPlaying: () => [...playing],
          play(key, { volume, rate }) {
            const cue = { key, volume, rate, destroy: () => playing.splice(playing.indexOf(cue), 1) };
            playing.push(cue);
          },
        },
      };
      preloadMatchRewardSounds(scene);
      for (const { urls } of queued.values()) {
        for (const url of urls) assert.ok(fs.statSync(path.join(__dirname, '../public', url)).size > 0);
      }
      playMatchRewardSound(scene, 'rewardCoinImpact', .22);
      scene.sound.locked = false;
      playMatchRewardSound(scene, 'rewardCoinImpact', .22);
      assert.equal(playing.length, 0);

      cached = true;
      playMatchRewardSound(scene, 'rewardCoinImpact', .22);
      const first = playing[0];
      const { instances } = queued.get('rewardCoinImpact');
      for (let i = 0; i < instances; i++) playMatchRewardSound(scene, 'rewardCoinImpact', .22, 1.2);
      assert.equal(playing.length, instances);
      assert.ok(!playing.includes(first));
      assert.ok(playing.every(cue => cue.volume === .22 && cue.rate === 1.2));
      active = false;
      playMatchRewardSound(scene, 'shopReveal', .3);
      assert.equal(playing.length, instances);
    });

    test('rapid reward impacts overlap in a bounded reusable pool and honor volume settings', () => {
      const clones = [];
      let settingsListener;
      class AudioStub {
        addEventListener() {}
        removeEventListener() {}
        load() {}
        cloneNode() { const audio = new AudioStub(); clones.push(audio); return audio; }
        play() { return Promise.resolve(); }
      }
      const { playSound } = loadUISounds({
        Audio: AudioStub,
        getSettings: () => ({ sfx: .5 }),
        subscribeSettings: listener => { settingsListener = listener; },
        shouldMuteClientDefaultLogs: () => true,
        window: {},
      });
      for (let i = 0; i < 56; i++) playSound('rewardCoinImpact', .12, { overlap: true, maxVoices: 8, playbackRate: 1.2 });
      assert.equal(clones.length, 8);
      assert.ok(clones.every(voice => voice.volume === .06 && voice.playbackRate === 1.2));
      settingsListener({ sfx: 0 });
      assert.ok(clones.every(voice => voice.volume === 0));
      clones.forEach(voice => voice.onended());
      playSound('rewardCoinImpact', .12, { overlap: true, maxVoices: 8 });
      assert.equal(clones.length, 8, 'finished voices are reused rather than allocated again');
    });

    test('UI initialization downloads no sounds; playing a sound loads and reuses only that sound', () => {
      const audios = [];
      class AudioStub {
        constructor() { audios.push(this); }
        addEventListener() {}
        removeEventListener() {}
        load() {}
        play() { return Promise.resolve(); }
      }
      const api = loadUISounds({
        Audio: AudioStub, document: { addEventListener() {} }, window: {},
        getSettings: () => ({ sfx: 1 }), subscribeSettings() {}, shouldMuteClientDefaultLogs: () => true,
      });
      api.initUISounds();
      assert.equal(audios.length, 0);
      api.playSound('click');
      api.playSound('click');
      assert.equal(audios.length, 1);
      assert.ok(audios[0].src);
      api.playSound('shopOpen');
      assert.equal(audios.length, 2);
      assert.notEqual(audios[1].src, audios[0].src);
    });

  });

  describe("Wallet propagation", () => {
    test('confirmed purchases update shared balances and every subscribed view, preserving absent currency', async () => {
      const { applyWallet, subscribeWallet, walletRevision } = await import('../src/client/lobby/wallet.mjs');
      const user = { coins: 900, gems: 80 };
      const header = { textContent: '' };
      const oldDocument = globalThis.document;
      globalThis.document = { getElementById: id => id === 'coin-count' ? header : null };
      const shop = {}, profile = {}, character = {};
      const unsubscribes = [shop, profile, character].map(view => subscribeWallet((wallet, owner) => {
        assert.equal(owner, user);
        Object.assign(view, wallet);
      }));
      try {
        const beforePurchase = walletRevision();
        applyWallet(user, { coins: 350 });
        assert.equal(header.textContent, '350');
        for (const view of [shop, profile, character]) assert.deepEqual(view, { coins: 350, gems: 80 });
        assert.equal(applyWallet(user, { coins: 900, gems: 80 }, beforePurchase), false);
        assert.equal(user.coins, 350, 'an older background response cannot undo a purchase');
        applyWallet(user, { coins: 0, gems: 0 });
        for (const view of [shop, profile, character]) assert.deepEqual(view, { coins: 0, gems: 0 });
        applyWallet(user, { coins: NaN, gems: -1 });
        assert.deepEqual(user, { coins: 0, gems: 0 });
      } finally {
        unsubscribes.forEach(unsubscribe => unsubscribe());
        globalThis.document = oldDocument;
      }
    });
  });
});

describe("UI cue lifetime", () => {
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
    const api = loadUISounds({
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

  test('custom manual cues take priority over automatic sounds and repeated bubbling cues are deduplicated', () => {
    const ui = setup();
    ui.click(control({ 'data-sound': 'cursor4' }), () => {
      ui.playSound('cancel', 0.4);
      ui.playSound('cancel', 0.4);
    });
    assert.equal(ui.played.length, 1);
    const manualCueSource = ui.played[0].src;
    // Independent programmatic cues are unaffected.
    ui.playSound('cancel');
    ui.playSound('cancel');
    assert.equal(ui.played.length, 3);
    assert.ok(ui.played.every(sound => sound.src === manualCueSource));
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

  test('shop and reward cues resolve to published audio files', () => {
    const audios = [];
    class AudioStub {
      constructor() { audios.push(this); }
      addEventListener() {} removeEventListener() {} load() {}
    }
    const api = loadUISounds({ Audio: AudioStub, window: {} });
    for (const name of ['click', 'cancel', 'shopOpen', 'rewardCoinImpact', 'rewardGemImpact']) api.preloadSound(name);
    assert.equal(audios.length, 5);
    for (const audio of audios) assert.ok(fs.statSync(path.join(__dirname, '../public', audio.src)).size > 0, audio.src);
  });
});

test('the result screen stores the local reward and Exit navigates once to the original party', async () => {
  const { createLobbyFixture } = require('./helpers/lobbyFixture');
  const f = createLobbyFixture();
  const returns = [];
  f.window.__BB_NAVIGATION__ = { prepareLobbyReturn: async id => returns.push(id) };
  f.sessionStorage.setItem('matchId', '10');
  const { createGameOverScreenController } = f.load('src/client/game/hud/gameOverScreenController.js');
  const controller = createGameOverScreenController({
    getGameData: () => ({ yourTeam: 'team1', players: [{ name: 'Owner', party_id: 7 }] }),
    getUsername: () => 'Owner',
    rewardStorageKey: 'test-reward',
    getMessage: () => 'Match won',
  });
  controller.showGameOverScreen({ winnerTeam: 'team1', meta: { rewards: [
    { username: 'Opponent', team: 'team2', coinsAwarded: 13 },
    { username: 'Owner', team: 'team1', coinsAwarded: 20, wallet: { coins: 50, gems: 10, trophies: 40 } },
  ] } });
  assert.match(f.document.querySelector('#game-over-overlay h1').textContent, /Victory/);
  assert.equal(JSON.parse(f.sessionStorage.getItem('test-reward')).coinsAwarded, 20);
  const exit = f.document.getElementById('go-lobby');
  f.event(exit, 'click');
  f.event(exit, 'click');
  await f.settle();
  assert.deepEqual(returns, [7]);
  assert.equal(f.sessionStorage.getItem('matchId'), null);
});
