const { loadClientModule } = require('./helpers/clientModule');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');



describe("Respawn synchronization", () => {
  function loadOpPlayer(onRespawn = () => {}) {
    const exports = {};

    const noop = () => {};
    const modules = {
      '../scene/respawnEffect': { spawnRespawnEffect: onRespawn },
      '../characters': {
        getTextureKey: noop,
        resolveAnimKey: () => 'idle',
        getStats: noop,
        getEffectsClass: () => null,
      },
      '../scene/effects': new Proxy({}, { get: () => noop }),
      '../scene/healthBarRenderer': {
        drawHealthBar: noop,
        resetHealthBarAnimation: noop,
      },
      '../scene/superBarRenderer': {
        drawSuperChargeBar: noop,
        resetSuperBarAnimation: noop,
      },
    };
    loadClientModule(require.resolve('../src/client/game/players/RemotePlayer.js'), {
      exports,
      require: (id) => modules[id] || {},
      performance: { now: () => 10000 },
    });
    return exports.default;
  }

  test('a pending corpse-removal callback cannot hide a respawned opponent', () => {
    let respawnEffects = 0;
    const OpPlayer = loadOpPlayer(() => { respawnEffects++; });
    const wrapper = Object.create(OpPlayer.prototype);
    let corpseCallback;
    let timerRemoved = false;
    wrapper.scene = {
      time: {
        delayedCall(_delay, callback) {
          corpseCallback = callback;
          return { remove: () => { timerRemoved = true; } };
        },
      },
      sound: { play() {} },
    };
    wrapper.character = 'ninja';
    wrapper.skinId = '';
    wrapper.opMaxHealth = 100;
    wrapper.effects = null;
    wrapper.resizeBodyForDuck = () => {};
    wrapper.hideWorldUi = () => {};
    wrapper.setPresenceState = () => {};
    wrapper.updateUIPosition = () => {};
    wrapper.opponent = {
      active: true,
      visible: true,
      body: { enable: true, reset() {} },
      anims: { play() {} },
      setVelocity() {},
      setAlpha() {},
      setVisible(visible) { this.visible = visible; },
    };

    wrapper.startDeathPresentation();
    wrapper.handleRespawn({ x: 10, y: 20, health: 100 });
    corpseCallback();

    assert.equal(respawnEffects, 1);
    assert.equal(timerRemoved, true);
    assert.equal(wrapper._deathPresentationActive, false);
    assert.equal(wrapper._corpseRemoved, false);
    assert.equal(wrapper.opponent.visible, true);
  });

  test('a respawn leaves physics no stale previous body position to apply', () => {
    const OpPlayer = loadOpPlayer();
    const wrapper = Object.create(OpPlayer.prototype);
    wrapper.scene = { time: { delayedCall: () => ({ remove() {} }) }, sound: { play() {} } };
    wrapper.character = 'draven';
    wrapper.skinId = '';
    wrapper.opMaxHealth = 100;
    wrapper.effects = null;
    wrapper.setPresenceState = () => {};
    wrapper.updateUIPosition = () => {};
    const vector = (x, y) => ({ x, y, copy(v) { this.x = v.x; this.y = v.y; return this; } });
    const sprite = { x: 0, y: 0, flipX: false, active: true, visible: false, anims: { play() {} }, setVelocity() {}, setAlpha() {},
      setVisible(visible) { this.visible = visible; } };
    // Like Phaser's Arcade body: reset() records the sprite's top-left, and
    // updateFromGameObject() places the collider at its offset.
    sprite.body = { enable: false, position: vector(0, 0), prev: vector(0, 0), prevFrame: vector(0, 0), offset: vector(0, 0),
      sourceWidth: 70, sourceHeight: 106, width: 70,
      setSize(w, h) { this.sourceWidth = this.width = w; this.sourceHeight = h; },
      setOffset(x, y) { this.offset.x = x; this.offset.y = y; },
      reset(x, y) { sprite.x = x; sprite.y = y; this.position.x = x; this.position.y = y; this.prev.copy(this.position); this.prevFrame.copy(this.position); },
      updateFromGameObject() { this.position.x = sprite.x + this.offset.x; this.position.y = sprite.y + this.offset.y; } };
    wrapper.opponent = sprite;
    wrapper.opFrame = { realWidth: 300, realHeight: 300 };
    wrapper.bodyConfig = { widthShrink: 230, heightShrink: 194, offsetXFromHalf: 0, offsetY: 111 };

    wrapper.handleRespawn({ x: 500, y: 200, health: 100, afterSnapshot: { epoch: 'e', seq: 9 } });

    // Arcade's postUpdate moves the sprite by position - prevFrame.
    assert.deepEqual([sprite.body.position.x - sprite.body.prevFrame.x, sprite.body.position.y - sprite.body.prevFrame.y], [0, 0]);
    assert.deepEqual([sprite.x, sprite.y], [500, 200]);
    assert.deepEqual({ ...wrapper._lifeEvent }, { epoch: 'e', afterSeq: 9, dead: false });

    wrapper.startDeathPresentation({ x: 520, y: 200, afterSnapshot: { epoch: 'e', seq: 40 } });
    assert.deepEqual({ ...wrapper._lifeEvent }, { epoch: 'e', afterSeq: 40, dead: true });
  });
});

describe("Loading presence", () => {
  function loadOpPlayer() {
    const exports = {};

    loadClientModule(require.resolve('../src/client/game/players/RemotePlayer.js'), { exports, require: () => new Proxy({}, { get: () => () => {} }), performance: { now: () => 0 } });
    return exports.default;
  }

  function displayObject() {
    return {
      active: true, visible: false, alpha: 1,
      setVisible(v) { this.visible = v; return this; },
      setAlpha(a) { this.alpha = a; return this; },
    };
  }

  function remoteFighter() {
    const wrapper = Object.create(loadOpPlayer().prototype);
    Object.assign(wrapper, {
      opponent: displayObject(),
      opPlayerName: displayObject(),
      opHealthBar: displayObject(),
      _spawnPresented: true,
      _powerupStatusIcons: [],
    });
    return wrapper;
  }

  test('an unloaded fighter is a faded ghost with its UI, then solid once loaded', () => {
    const fighter = remoteFighter();
    fighter.setPresenceState(true, false);
    assert.equal(fighter.opponent.visible, true);
    assert.ok(fighter.opponent.alpha < 1, 'drawn faded');
    assert.equal(fighter.opPlayerName.visible, true, 'name shows who is loading');
    assert.equal(fighter.opHealthBar.visible, true, 'health bar shows on a ghost');
    assert.ok(fighter.opHealthBar.alpha < 1, 'ghost UI is faded');

    fighter.setPresenceState(true, true);
    assert.equal(fighter.opponent.visible, true);
    assert.equal(fighter.opponent.alpha, 1);
    assert.equal(fighter.opHealthBar.visible, true);
  });

  test('a disconnected fighter that never loaded is still a ghost', () => {
    const fighter = remoteFighter();
    fighter.setPresenceState(false, false);
    assert.equal(fighter.opponent.visible, true);
    assert.ok(fighter.opponent.alpha < 1);
  });
});

describe("Remote duck geometry", () => {
  const Frame = require('phaser/src/textures/Frame');
  const Body = require('phaser/src/physics/arcade/Body');
  const { characterBody } = require('../src/shared/physics/duelGeometry');
  const { spritePresentation } = require('../src/client/game/characters/shared/spritePresentation');
  const { DUCK_HEIGHT_RATIO } = require('../src/shared/physics/ducking');
  const { characterDefinitions } = require('../src/shared/characters');

  const api = {};
  loadClientModule(require.resolve('../src/client/game/players/RemotePlayer'), { exports: api, require: id => id === '../../../shared/physics/ducking.js'
    ? { DUCK_HEIGHT_RATIO }
    : id === '../../../shared/characters/index.js' ? require('../src/shared/characters')
    : { playDuckTransitionSound() {} } });

  const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);

  function atlasFrames(character) {
    const atlas = JSON.parse(fs.readFileSync(`public/assets/${character}/animations.json`, 'utf8'));
    const frames = Array.isArray(atlas.frames) ? atlas.frames
      : Object.entries(atlas.frames).map(([filename, frame]) => ({ filename, ...frame }));
    return { atlas, byName: new Map(frames.map(frame => [frame.filename, frame])) };
  }

  // Every fighter seen as a remote player must crouch to the same hitbox the
  // server uses (DUCK_HEIGHT_RATIO, feet planted), as the local player does.
  for (const character of Object.keys(characterDefinitions)) {
    test(`${character}: remote duck collider matches the server hitbox in both facings`, () => {
      const { atlas, byName } = atlasFrames(character);
      const idle = byName.get('idle00');
      const sourceW = idle.sourceSize?.w ?? idle.frame.w;
      const sourceH = idle.sourceSize?.h ?? idle.frame.h;
      const texture = {
        key: character,
        source: [{ width: atlas.meta.size.w, height: atlas.meta.size.h }],
        has: (name) => byName.has(name),
        get: (name) => ({ width: (byName.get(name)?.sourceSize?.w ?? byName.get(name)?.frame.w) }),
      };
      const { scale, body: config, originX, originY } = spritePresentation(character, texture);
      const frame = new Frame(texture, 'idle00', 0, idle.frame.x, idle.frame.y, idle.frame.w, idle.frame.h);
      if (idle.trimmed) {
        const trim = idle.spriteSourceSize;
        frame.setTrim(sourceW, sourceH, trim.x, trim.y, trim.w, trim.h);
      }
      const sprite = { x: 500, y: 300, angle: 0, rotation: 0, scaleX: scale, scaleY: scale,
        displayOriginX: sourceW * originX, displayOriginY: sourceH * originY,
        width: sourceW, height: sourceH, frame };
      sprite.body = new Body({ defaults: {}, bounds: {} }, sprite);
      sprite.body.setSize(frame.realWidth - config.widthShrink, frame.realHeight - config.heightShrink, false);
      const remote = Object.assign(Object.create(api.default.prototype), {
        character, opponent: sprite, opFrame: frame, bodyConfig: config,
      });

      for (const flip of [false, true]) {
        sprite.flipX = flip;
        remote.applyFlipOffset();
        sprite.body.updateFromGameObject();
        const standing = { height: sprite.body.height, bottom: sprite.body.bottom, center: sprite.body.center.x };
        const server = characterBody(character, flip);
        close(standing.height, server.height, 'standing height');
        for (const ducking of [true, false]) {
          remote.setDucking(ducking);
          sprite.body.updateFromGameObject();
          close(sprite.body.height, server.height * (ducking ? DUCK_HEIGHT_RATIO : 1), `${ducking ? 'ducking' : 'restored'} height`);
          close(sprite.body.bottom, standing.bottom, 'feet stay planted');
          close(sprite.body.center.x, standing.center, 'horizontal center');
        }
      }
    });
  }

  test('remote HUD only nudges down while ducking instead of following the collider', () => {
    const sprite = { x: 0, y: 300, height: 120, scaleY: 0.5, _ducking: true,
      body: { y: 340, bottom: 380 } };
    const remote = Object.assign(Object.create(api.default.prototype), {
      opponent: sprite, opFrame: { realHeight: 200 }, bodyConfig: { heightShrink: 40 },
    });
    assert.equal(remote.hudTopY(), 380 - 160 * 0.5 + 8);
    sprite._ducking = false;
    assert.equal(remote.hudTopY(), 340);
    sprite._bbHudTopOffset = -35;
    assert.equal(remote.hudTopY(), 265);
  });
});
