const { loadClientModule } = require('./helpers/clientModule');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');




describe("Tombstone placement", () => {
  const exportsObject = {};

  loadClientModule(require.resolve('../src/client/game/scene/deathTombstone.js'), { exports: exportsObject, require: () => ({ RENDER_LAYERS: { GAME_OBJECTS: 10 } }) });
  const { findTombstoneGround } = exportsObject;
  function platform(left, right, top, extra = {}) {
    return { body: { left, right, top, enable: true, ...extra } };
  }

  test('anchors near-ground deaths to the closest supporting platform', () => {
    const ground = platform(0, 500, 400);
    const upper = platform(100, 200, 300);
    assert.equal(findTombstoneGround(150, 278, [ground, upper]), upper);
    assert.equal(findTombstoneGround(150, 405, [ground, upper]), ground);
  });

  test('airborne, off-edge and below-platform deaths leave no tombstone', () => {
    const ground = platform(0, 500, 400);
    assert.equal(findTombstoneGround(150, 200, [ground]), null);
    assert.equal(findTombstoneGround(520, 395, [ground]), null);
    assert.equal(findTombstoneGround(150, 450, [ground]), null);
  });

  test('ignores disabled, non-solid and too-narrow surfaces', () => {
    const objects = [platform(0, 500, 400, { enable: false }),
      platform(0, 500, 400, { checkCollision: { up: false } }),
      platform(145, 155, 400)];
    assert.equal(findTombstoneGround(150, 390, objects), null);
  });
});

describe("Loot landing", () => {
  const exportsObject = {};

  loadClientModule(require.resolve("../src/client/game/powerups/deathLootEffects.js"), { exports: exportsObject, require: () => ({ RENDER_LAYERS: {} }) });
  const { handleDeathLootContact } = exportsObject;

  function loot(vy = -120) {
    const body = {
      blocked: { down: true }, touching: { down: true },
      velocity: { x: 150, y: vy }, moves: true, allowGravity: true,
      setAllowGravity(value) { this.allowGravity = value; },
    };
    return { sprite: { x: 300, y: 400, body,
      setVelocity(x, y) { body.velocity = { x, y }; } } };
  }

  test("first floor contact settles without a bounce or sideways slide", () => {
    const visual = loot();
    let impacts = 0;
    handleDeathLootContact(visual, 100, () => impacts++);
    assert.equal(visual.settled, true);
    assert.equal(visual.sprite.body.velocity.y, 0);
    assert.equal(visual.sprite.body.velocity.x, 0);
    assert.equal(visual.settledX, 300);
    assert.equal(visual.settledY, 400);
    assert.equal(visual.sprite.body.moves, false);
    assert.equal(visual.sprite.body.allowGravity, false);
    // Adjacent platform colliders must not count the same impact twice.
    handleDeathLootContact(visual, 100, () => impacts++);
    assert.equal(impacts, 1);
  });

  test("walls and collected loot do not trigger landing, gentle floor contacts settle", () => {
    const visual = loot(-20);
    visual.sprite.body.blocked.down = false;
    visual.sprite.body.touching.down = false;
    handleDeathLootContact(visual, 100);
    assert.equal(visual.settled, undefined);
    visual.sprite.body.touching.down = true;
    visual.despawning = true;
    handleDeathLootContact(visual, 200);
    assert.equal(visual.settled, undefined);
    visual.despawning = false;
    handleDeathLootContact(visual, 300);
    assert.equal(visual.settled, true);
  });
});

describe("Local respawn", () => {
  test('respawn effect stays at the arrival point and releases objects and listeners', () => {
    const { EventEmitter } = require('node:events');
    const exports = {};

    const audioExports = {};

    loadClientModule(require.resolve('../src/client/game/audio/playerAudio.js'), { exports: audioExports });
    loadClientModule(require.resolve('../src/client/game/scene/respawnEffect.js'), { exports, require: id => id.includes('playerAudio')
      ? audioExports : { RENDER_LAYERS: { PLAYER: 30 } } });
    for (const end of ['complete', 'shutdown', 'destroy']) {
      const objects = [];
      const tweens = new Map();
      const shape = (x, y) => {
        const object = { x, y, destroyed: false, setDepth() {}, setStrokeStyle() {},
          destroy() { assert.equal(this.destroyed, false); this.destroyed = true; } };
        objects.push(object);
        return object;
      };
      const sounds = [];
      const scene = {
        cache: { audio: { exists: () => end !== 'destroy' } },
        sound: { play: (key, options) => sounds.push({ key, options }) },
        events: new EventEmitter(), add: { rectangle: shape, ellipse: shape },
        tweens: { add: config => tweens.set(config.targets, config), killTweensOf: object => tweens.delete(object) },
      };
      const sprite = Object.assign(new EventEmitter(), {
        x: 500, y: 500, alpha: 1,
        body: { center: { x: 0 }, bottom: 0, width: 40, height: 80 },
      });
      scene._localPlayerAudioSprite = end === 'shutdown' ? { x: 0, y: 0 } : sprite;
      const cleanup = exports.spawnRespawnEffect(scene, sprite);
      assert.equal(sounds.length, end === 'destroy' ? 0 : 1, 'missing audio must not block visuals');
      if (sounds.length) {
        assert.equal(sounds[0].key, 'sfx-respawn');
        const baseVolume = audioExports.playerSoundVolume(scene, sprite, 1);
        assert.ok(sounds[0].options.volume > 0 && sounds[0].options.volume <= baseVolume);
        if (end === 'shutdown') assert.ok(baseVolume < 1, 'remote respawns attenuate with distance');
      }
      assert.ok(objects.length > 0);
      assert.equal(objects[0].x, 0, 'zero-valued body coordinates are valid');
      const origins = objects.map(o => [o.x, o.y]);
      sprite.x += 100;
      assert.deepEqual(objects.map(o => [o.x, o.y]), origins);
      assert.equal(sprite.alpha, 1);
      assert.ok([...tweens.keys()].every(target => target !== sprite));
      if (end === 'complete') {
        for (const [object, config] of tweens) {
          tweens.delete(object);
          config.onComplete();
        }
      } else if (end === 'shutdown') scene.events.emit('shutdown');
      else sprite.emit('destroy');
      cleanup();
      assert.ok(objects.every(o => o.destroyed));
      assert.equal(tweens.size, 0);
      assert.equal(scene.events.listenerCount('shutdown'), 0);
      assert.equal(sprite.listenerCount('destroy'), 0);
    }
  });

  test('local respawn survives old death callbacks and refreshes the body before the HUD', () => {
    const exports = {};
    const noop = () => {};
    const order = [];

    loadClientModule(require.resolve('../src/client/game/players/localSocketEvents.js'), { exports, require: () => ({
      spawnDeathBurst: noop, spawnSpawnBurst: noop,
      spawnRespawnEffect: () => order.push('respawn-effect'),
      playSpriteAnimation: () => order.push('animation'),
    }), window: {} });
    const handlers = {};
    const timers = [];
    let dead = false;
    const player = {
      visible: true, setVisible(v) { this.visible = v; },
      setVelocity: noop, setAcceleration: noop,
      body: { reset: noop, updateFromGameObject: () => order.push('body') },
    };
    const scene = { sound: { play: noop }, input: { keyboard: {} }, time: {
      delayedCall(ms, callback) {
        const timer = { ms, callback, removed: false, remove() { this.removed = true; } };
        timers.push(timer);
        return timer;
      },
    } };
    const dispose = exports.bindLocalSocketEvents({
      socket: { on: (name, fn) => { handlers[name] = fn; }, off: noop },
      getUsername: () => 'self', getScene: () => scene, getPlayer: () => player,
      getCurrentCharacter: () => 'ninja', getDead: () => dead,
      setDead: v => { dead = v; }, setMaxHealth: noop, setCurrentHealthValue: noop,
      stopWallSlideAudio: () => {},
      updateHealthBar: () => order.push('hud'),
      removeLocalCorpse: () => player.setVisible(false),
    });
    const die = () => handlers['player:dead']({ username: 'self' });
    const respawn = () => handlers['player:respawn']({ username: 'self', x: 10, y: 20, health: 100 });
    die();
    order.length = 0;
    respawn();
    assert.deepEqual(order, ['animation', 'body', 'respawn-effect', 'hud']);
    assert.equal(timers[0].removed, true);
    timers[0].callback();
    assert.equal(player.visible, true);
    assert.equal(dead, false);
    die();
    timers[0].callback();
    assert.equal(player.visible, true, 'an older death must not hide the next life');
    timers[1].callback();
    assert.equal(player.visible, false, 'a current death still removes its corpse');
    respawn();
    die();
    dispose();
    assert.equal(timers[2].removed, true);
    timers[2].callback();
    assert.equal(player.visible, true, 'disposed handlers cannot hide a sprite');
  });

  test('match healing uses the health power-up tick once even when health was already synced', () => {
    const exports = {};
    const noop = () => {};
    let now = 1000;

    loadClientModule(require.resolve('../src/client/game/match/matchCoordinator.js'), { exports, require: () => ({
      spawnDamageImpact: noop, playHitFeedback: noop, hitstopForDelivery: () => 0,
      getCharacterSocketEvents: () => [],
      applyActionToLocalPlayer: () => false,
      spawnDuckGuardImpact: noop,
      spawnDeathBurst: noop,
      spawnSpawnBurst: noop,
      triggerDamageScreenPulse: noop,
      triggerDamageCameraShake: noop,
      playSpriteAnimation: noop,
      playPlayerSound: (scene, _source, key, options) => scene.sound.play(key, options),
      startServerClockSync: noop, stopServerClockSync: noop,
      resyncServerClock: noop, observeServerClockSnapshot: noop,
      createSnapshotDecoder: require('../src/shared/snapshotDelta').createSnapshotDecoder,
    }), window: {}, Date: { now: () => now } });

    const handlers = {};
    const sounds = [];
    const coordinator = exports.createMatchCoordinator({
      socket: { on: (name, fn) => { handlers[name] = fn; }, off: noop },
      getUsername: () => 'self',
      getGameScene: () => ({ sound: { play: (key, config) => sounds.push({ key, config }) } }),
      getPlayer: () => ({ x: 0, y: 0, height: 10 }),
      getCurrentCharacter: () => 'ninja',
      lastHealthByPlayer: { self: 900 },
      hud: {},
      getGameEnded: () => true,
      getIsLiveGame: () => true,
      powerupTickSounds: { health: { key: 'pu-tick-health', options: { volume: 0.2 } } },
      getMaxHealth: () => 1000,
      setMaxHealth: noop,
      getDead: () => false,
      setDead: noop,
      stopWallSlideAudio: () => {},
      spawnHealthMarker: noop,
      updateHealthBar: noop,
    });
    coordinator.register();

    handlers['health-update']({
      username: 'self',
      health: 900,
      maxHealth: 1000,
      cause: 'heal',
    });

    assert.equal(sounds.length, 1);
    assert.equal(sounds[0].key, 'pu-tick-health');
    assert.equal(sounds[0].config.volume, 0.2);
    handlers['powerup:tick']({ username: 'self', type: 'health' });
    assert.equal(sounds.length, 1, 'paired health update and power-up tick must not double-play');
    now += 1500;
    handlers['health-update']({ username: 'self', health: 1000, cause: 'heal' });
    assert.equal(sounds.length, 2, 'the next regeneration tick must play');
    now += 1500;
    handlers['powerup:tick']({ username: 'self', type: 'health' });
    handlers['health-update']({ username: 'self', health: 1000, cause: 'heal' });
    assert.equal(sounds.length, 3, 'reverse notification order must also play once');
  });

  test('match playback includes the freeze power-up tick', () => {
    const exports = {};
    const noop = () => {};

    loadClientModule(require.resolve('../src/client/game/match/matchCoordinator.js'), { exports, require: () => ({
      spawnDamageImpact: noop, spawnDuckGuardImpact: noop, playHitFeedback: noop, hitstopForDelivery: () => 0,
      getCharacterSocketEvents: () => [], applyActionToLocalPlayer: () => false,
      spawnDeathBurst: noop, spawnSpawnBurst: noop,
      triggerDamageScreenPulse: noop, triggerDamageCameraShake: noop,
      playSpriteAnimation: noop,
      playPlayerSound: (scene, _source, key, options) => scene.sound.play(key, options),
      startServerClockSync: noop, stopServerClockSync: noop,
      resyncServerClock: noop, observeServerClockSnapshot: noop,
      createSnapshotDecoder: require('../src/shared/snapshotDelta').createSnapshotDecoder,
    }), window: {} });

    const handlers = {};
    const sounds = [];
    const coordinator = exports.createMatchCoordinator({
      socket: { on: (name, fn) => { handlers[name] = fn; }, off: noop },
      getGameScene: () => ({ sound: { play: (key, config) => sounds.push({ key, config }) } }),
      getUsername: () => 'self', getPlayer: () => ({ x: 0, y: 0 }),
      powerupTickSounds: { freeze: { key: 'pu-tick-freeze', options: { volume: 0.7 } } },
      getGameEnded: () => true, getIsLiveGame: () => true,
    });
    coordinator.register();

    handlers['powerup:tick']({ username: 'self', type: 'freeze' });
    assert.deepEqual(sounds, [{ key: 'pu-tick-freeze', config: { volume: 0.7 } }]);
  });
});
