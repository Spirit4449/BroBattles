// The vault's on-screen reactions, run against a stand-in scene. These hold the
// behaviour the effects promise (coins erupt, land on platforms, stay bounded,
// respect reduced motion) rather than how any of it is tuned.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const babel = require("@babel/core");

const moduleExports = {};
vm.runInNewContext(
  babel.transformSync(
    fs.readFileSync("src/client/game/modes/bankBust/vaultEffects.js", "utf8"),
    { babelrc: false, configFile: false, presets: [["@babel/preset-env", { targets: { node: "current" } }]] },
  ).code,
  {
    exports: moduleExports,
    Math,
    Number,
    Infinity,
    // Its one import, the shared coin motion, is the real module.
    require: (specifier) => require(require("node:path").resolve("src/client/game/modes/bankBust", specifier)),
  },
);
const { createVaultEffects, stepLoose, coinsForHit, hitStrength } = moduleExports;

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

test("vault damage reuses coin audio and throttles rapid hits even with reduced motion", () => {
  const scene = fakeScene();
  const sounds = [];
  const fx = effectsFor(scene, {
    reducedMotion: true,
    playSfx: (key, config) => sounds.push({ key, ...config }),
  });
  fx.hit("team1", VAULT, 0);
  assert.equal(sounds.length, 0);
  fx.hit("team1", VAULT, 300);
  fx.hit("team1", VAULT, 300);
  assert.equal(sounds.length, 1);
  scene.advance(100);
  fx.hit("team1", VAULT, 9000);
  assert.equal(sounds.length, 2);
  assert.ok(sounds.every(({ key }) => key === "sfx-coin-pickup"));
  assert.ok(sounds[1].volume > sounds[0].volume);
});

test("a heavier hit knocks out more coins, and a tap still knocks out some", () => {
  assert.ok(coinsForHit(1) >= 1);
  assert.ok(coinsForHit(1200) > coinsForHit(100));
  assert.ok(coinsForHit(1e9) === coinsForHit(1e10));
});

test("an ordinary attack is a small reaction next to the hardest hits", () => {
  const ordinary = 1200;
  const hardest = 9000;
  assert.ok(coinsForHit(ordinary) * 3 < coinsForHit(hardest));
  assert.ok(hitStrength(ordinary) * 3 < hitStrength(hardest));
  assert.ok(hitStrength(300) < hitStrength(ordinary));
});

function widestWiggle(damage) {
  const scene = fakeScene();
  const fx = effectsFor(scene);
  fx.hit("team1", VAULT, damage);
  let widest = 0;
  for (let frame = 0; frame < 30; frame++) {
    fx.tick(16);
    widest = Math.max(widest, Math.abs(fx.pose("team1", VAULT, {}).x - VAULT.x));
  }
  return widest;
}

test("the vault wiggles in proportion to the damage", () => {
  assert.ok(widestWiggle(300) < widestWiggle(1200) + 0.01);
  assert.ok(widestWiggle(1200) * 3 < widestWiggle(9000));
});

function bloomAfter(hits) {
  const scene = fakeScene();
  const fx = effectsFor(scene);
  for (const damage of hits) fx.hit("team1", VAULT, damage);
  fx.tick(16);
  return fx.pose("team1", VAULT, {}).bloom;
}

test("the light pulse follows the damage and a run of hits cannot build it up", () => {
  assert.ok(bloomAfter([1200]) > 0);
  assert.ok(bloomAfter([1200]) * 2 < bloomAfter([9000]));
  assert.ok(bloomAfter(Array(50).fill(1200)) <= bloomAfter(Array(5).fill(9000)));
});

test("a flurry of small hits shares one damage number", () => {
  const scene = fakeScene();
  const fx = effectsFor(scene);
  fx.hit("team1", VAULT, 300);
  scene.advance(90);
  fx.hit("team1", VAULT, 300);
  assert.equal(scene.created.filter((entry) => entry.texture === "text").length, 1);
});

test("a hit throws coins out of the vault", () => {
  const scene = fakeScene();
  const fx = effectsFor(scene);
  fx.hit("team1", VAULT, 1200, { x: 400, y: 100 });
  assert.equal(coinsIn(scene).length, coinsForHit(1200));
});

test("a bust erupts far more coins than any hit, and keeps gushing", () => {
  const scene = fakeScene();
  const fx = effectsFor(scene);
  fx.bust("team1", VAULT);
  assert.equal(coinsIn(scene).length, 0, "the vault strains before it blows");

  scene.advance(400);
  const blast = coinsIn(scene).length;
  assert.ok(blast > coinsForHit(1e9) * 2);

  scene.advance(1500);
  assert.ok(coinsIn(scene).length > blast);
});

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

test("the old frame stays up only while the bust winds up", () => {
  const scene = fakeScene();
  const fx = effectsFor(scene);
  assert.equal(fx.holdingFrame("team1", "damaged"), false);
  fx.bust("team1", VAULT);
  assert.equal(fx.holdingFrame("team1", "damaged"), true);
  scene.advance(400);
  assert.equal(fx.holdingFrame("team1", "damaged"), false);
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

test("a thrown coin rises through a platform, then lands on it and settles", () => {
  const floors = [{ left: 0, right: 500, top: 100 }];
  const coin = { x: 250, y: 200, vx: 0, vy: -900, radius: 6, phase: 0, spin: 10, resting: false };
  let highest = coin.y;
  for (let i = 0; i < 600 && !coin.resting; i++) {
    stepLoose(coin, 1 / 60, floors);
    highest = Math.min(highest, coin.y);
  }
  assert.ok(highest < 100, "platforms are one-way from below");
  assert.equal(coin.resting, true);
  assert.equal(coin.y, 100 - coin.radius);
});

test("a coin thrown past the edge of a platform keeps falling", () => {
  const floors = [{ left: 0, right: 100, top: 100 }];
  const coin = { x: 300, y: 50, vx: 0, vy: 0, radius: 6, phase: 0, spin: 0, resting: false };
  for (let i = 0; i < 60; i++) stepLoose(coin, 1 / 60, floors);
  assert.equal(coin.resting, false);
  assert.ok(coin.y > 100);
});
