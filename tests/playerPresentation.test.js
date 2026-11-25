const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadClientModule } = require('./helpers/clientModule');

describe("Health and invisibility", () => {
  const { test, describe } = require('node:test');


  describe("Health bars", () => {
    function load(file) {
      const exports = {};

      loadClientModule(require.resolve(file), { exports, require: id => (id.includes('shared/rig') ? require('../src/client/game/characters/shared/rig.js') : {}), performance: { now: () => 10000 } });
      return exports;
    }
    const { updateHealthBars } = load('../src/client/game/scene/healthBarRenderer.js');
    const OpPlayer = load('../src/client/game/players/RemotePlayer.js').default;

    test('teammate and opponent name/bar anchors follow moving fighters every frame', () => {
      const { createClientModuleGraph } = require('./helpers/clientModule');
      const graph = createClientModuleGraph({ globals: { Phaser: { BlendModes: { ADD: 1 } } }, imports: {
        '../../site/preferences': { bindCanvasName() {} },
      } });
      const { createPlayerWorldHud } = graph.load('src/client/game/scene/playerWorldHud.js');
      const scene = { time: { now: 100 }, tweens: { add() {} } };
      function displayObject() {
        const object = { scene, active: true, visible: true, rects: [],
          setPosition(x, y) { this.x = x; this.y = y; return this; },
          clear() { this.rects = []; return this; },
          fillStyle(color) { this.color = color; return this; },
          fillRect(x, y, width, height) { this.rects.push({ x, y, width, height, color: this.color }); },
        };
        for (const name of ['setOrigin', 'setAlpha', 'setScale', 'setRotation', 'setVisible', 'setDepth',
          'setDisplaySize', 'setTint', 'setBlendMode', 'setStyle', 'setShadow', 'setText']) object[name] = () => object;
        return object;
      }
      scene.add = { text: displayObject, image: displayObject, graphics: displayObject };
      function player(role) {
        const wrapper = Object.create(OpPlayer.prototype);
        wrapper.opponent = { x: 100, body: { y: 20 } };
        wrapper._worldHud = createPlayerWorldHud(scene, { username: role, role });
        wrapper.opHealthText = wrapper._worldHud.healthText;
        wrapper.opHealthBar = wrapper._worldHud.healthBar;
        wrapper.opCurrentHealth = wrapper.opMaxHealth = 800;
        wrapper.opSuperCharge = wrapper.opMaxSuperCharge = 1;
        return wrapper;
      }
      const enemy = player('enemy'), ally = player('ally');
      const self = player('self');
      let initialGap;
      for (let frame = 0; frame < 120; frame++) {
        for (const wrapper of [enemy, ally]) {
          wrapper.opponent.x = 100 + Math.min(frame, 100) * 0.2;
          wrapper.opponent.body.y = 20 + Math.min(frame, 100) * 2;
        }
        updateHealthBars({ opponentPlayers: { enemy }, teamPlayers: { ally }, syncPositions: true });
        for (const wrapper of [enemy, ally]) {
          const hud = wrapper._worldHud;
          const fill = hud.healthBar.rects.find(r => r.color === (wrapper === ally ? 0x99ab2c : 0xb24035));
          assert.ok(hud.healthText.y >= fill.y && hud.healthText.y < fill.y + fill.height, 'HP inside the fill');
          assert.equal(hud.playerName.x, Math.round(wrapper.opponent.x));
          assert.equal(hud.healthText.x, hud.playerName.x);
          assert.equal(fill.x + fill.width / 2, hud.healthText.x);
          const nameGap = wrapper.opponent.body.y - hud.playerName.y;
          initialGap ??= nameGap;
          assert.equal(nameGap, initialGap, 'name follows the fighter on this frame');
          assert.equal(hud.ammoBar, null);
        }
        self.opponent = ally.opponent;
        self._worldHud.draw({ sprite: self.opponent, headY: ally.hudTopY(), health: 50, maxHealth: 80,
          charge: 1, maxCharge: 1, ammo: { capacity: 3, charges: 3 }, visible: true });
        const hud = self._worldHud;
        assert.ok(hud.ammoBar.rects.length);
        assert.ok(hud.healthText.y < ally._worldHud.healthText.y, 'ammo fits above the super meter');
        assert.equal(hud.superBarBack.rects.at(-1).y, ally._worldHud.superBarBack.rects.at(-1).y,
          'both panels clear the head by the same distance');
      }
    });

  });

  describe("Invisibility reveal", () => {
    const clock = { now: 1000 };
    const load = (path, context) => {
      const exports = {};
      loadClientModule(require.resolve(path), { exports, performance: { now: () => clock.now }, ...context });
      return exports;
    };
    const reveal = load('../src/client/game/powerups/invisibilityReveal');
    const { markOneShotAnimation } = load('../src/client/game/characters/shared/animationState');
    // Every character's attack (local or remote) marks its sprite through here.
    const attack = (sprite, kind = 'throw') => markOneShotAnimation(sprite, kind, 400, { remote: true });
    const api = load('../src/client/game/players/RemotePlayer', {
      require: id => id === '../../../shared/characters/index.js' ? require('../src/shared/characters')
        : id === '../powerups/invisibilityReveal.js' ? reveal
        : new Proxy({}, { get: () => () => {} }),
    });

    function invisibleRemote() {
      const sprite = { active: true, alpha: 1, setVisible() {}, setAlpha(a) { this.alpha = a; } };
      const remote = Object.assign(Object.create(api.default.prototype), {
        opponent: sprite, presenceConnected: true, presenceLoaded: true, _spawnPresented: true,
      });
      remote.setPowerupInvisible(true);
      return { remote, sprite };
    }

    test('an invisible remote player stays hidden until they attack', () => {
      const { remote, sprite } = invisibleRemote();
      assert.equal(sprite.alpha, 0);

      attack(sprite);
      remote.setPowerupInvisible(true);
      assert.ok(sprite.alpha > 0 && sprite.alpha < 1, `faded silhouette, got ${sprite.alpha}`);
    });

    test('movement animations do not reveal an invisible player', () => {
      const { remote, sprite } = invisibleRemote();
      markOneShotAnimation(sprite, 'jumping', 400, { remote: true });
      remote.setPowerupInvisible(true);
      assert.equal(sprite.alpha, 0);
    });

  });
});

describe("Bounded vault effects", () => {
  // The vault's on-screen reactions, run against a stand-in scene. These hold the
  // behaviour the effects promise (coins erupt, land on platforms, stay bounded,
  // respect reduced motion) rather than how any of it is tuned.







  const { createClientModuleGraph } = require("./helpers/clientModule");
  const { createVaultEffects } = createClientModuleGraph().load("src/client/game/modes/bankBust/vaultEffects.js");

  const LAYERS = { GAME_OBJECTS: 10, POWERUPS: 20, SCENERY_FRONT: 33, PLAYER_HUD: 40, ATTACKS: 60 };
  const VAULT = { x: 700, y: 124, width: 216, height: 224 };

  function gameObject(texture) {
    const object = { texture, destroyed: false, visible: true };
    return new Proxy(object, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === "destroy") return () => { target.destroyed = true; };
        return () => proxyOf(target);
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    });
  }
  const proxies = new WeakMap();
  function proxyOf(target) {
    if (!proxies.has(target)) proxies.set(target, gameObject(target.texture));
    return proxies.get(target);
  }

  function fakeScene() {
    const created = [];
    const timers = [];
    const add = (texture) => {
      const object = gameObject(texture);
      created.push(object);
      return object;
    };
    const scene = {
      created,
      time: {
        now: 1000,
        delayedCall: (delay, callback) => timers.push({ at: scene.time.now + delay, callback }),
        addEvent: ({ callback, delay, repeat = 0 }) => {
          for (let i = 0; i <= repeat; i++) timers.push({ at: scene.time.now + delay * (i + 1), callback });
        },
      },
      add: {
        image: (_x, _y, texture) => add(texture),
        circle: () => add("circle"),
        text: () => add("text"),
      },
      tweens: { add: () => {}, killTweensOf: () => {} },
      textures: {
        exists: () => true,
        get: () => ({ getSourceImage: () => ({ width: 216, height: 224 }) }),
      },
      cameras: { main: { worldView: { x: 0, y: -400, right: 1600, bottom: 800 }, shake: () => {} } },
      advance(ms) {
        scene.time.now += ms;
        for (const timer of timers.filter((entry) => entry.at <= scene.time.now)) {
          timers.splice(timers.indexOf(timer), 1);
          timer.callback();
        }
      },
    };
    return scene;
  }

  function effectsFor(scene, options = {}) {
    return createVaultEffects({
      scene,
      Phaser: { BlendModes: { ADD: 1 } },
      layers: LAYERS,
      getFloors: () => [{ left: 0, right: 1400, top: 236 }],
      ...options,
    });
  }

  function coinsIn(scene) {
    return scene.created.filter((entry) => entry.texture === "coin-spin");
  }

  test("a vault only busts once", () => {
    const scene = fakeScene();
    const fx = effectsFor(scene);
    fx.bust("team1", VAULT);
    scene.advance(400);
    const blast = coinsIn(scene).length;
    fx.bust("team1", VAULT);
    fx.hit("team1", VAULT, 500);
    assert.equal(coinsIn(scene).length, blast);
  });

  test("reduced motion throws nothing and shakes nothing, but still busts cleanly", () => {
    const scene = fakeScene();
    const fx = effectsFor(scene, { reducedMotion: true });
    fx.hit("team1", VAULT, 1200);
    fx.bust("team1", VAULT);
    scene.advance(4000);
    assert.equal(coinsIn(scene).length, 0);
    const pose = fx.pose("team1", VAULT, { stateKey: "breached" });
    assert.equal(pose.x, VAULT.x);
    assert.equal(pose.scaleX, 1);
  });

  test("loose coins stay bounded however much is thrown", () => {
    const scene = fakeScene();
    const fx = effectsFor(scene);
    for (let i = 0; i < 200; i++) {
      fx.hit("team1", VAULT, 2000);
      scene.advance(10);
      fx.tick(16);
    }
    const first = fx.looseCoinCount();
    for (let i = 0; i < 400; i++) {
      fx.hit("team1", VAULT, 2000);
      scene.advance(16);
      fx.tick(16);
    }
    assert.ok(fx.looseCoinCount() <= Math.max(first, 300));
    fx.destroy();
    assert.equal(coinsIn(scene).filter((coin) => !coin.destroyed).length, 0);
  });
});

test('shared ammo renderer shows sequential refill and clears when the HUD is hidden', () => {
  const { createClientModuleGraph } = require('./helpers/clientModule');
  const { drawAmmoChargeBar } = createClientModuleGraph().load('src/client/game/scene/ammoBarRenderer.js');
  const graphics = () => ({ rects: [], clear() { this.rects = []; }, fillStyle() {},
    fillRect(x, y, width, height) { this.rects.push({ x, y, width, height }); }, setDepth() {} });
  const front = graphics(), back = graphics();
  const ammo = { capacity: 3, charges: 1, reloadTimerMs: 0, reloadMs: 1000 };
  const render = () => {
    drawAmmoChargeBar(front, back, { x: 10.3, y: 20.4, ammo });
    assert.ok(front.rects.every(r => Number.isInteger(r.x) && Number.isInteger(r.y)), 'pixel aligned');
    return front.rects.reduce((area, r) => area + r.width * r.height, 0);
  };
  const emptyReload = render(), frame = structuredClone(back.rects);
  ammo.reloadTimerMs = ammo.reloadMs / 2;
  const halfReload = render();
  assert.ok(halfReload > emptyReload);
  ammo.reloadTimerMs = ammo.reloadMs;
  assert.ok(render() > halfReload);
  assert.deepEqual(back.rects, frame, 'refill does not change the shared pixel frame');
  drawAmmoChargeBar(front, back, { x: 10, y: 20, ammo: null });
  assert.equal(front.rects.length + back.rects.length, 0);
});
