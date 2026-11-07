const path = require('node:path');
const { EventEmitter } = require('node:events');
const Body = require('phaser/src/physics/arcade/Body');
const World = require('phaser/src/physics/arcade/World');
const Vector2 = require('phaser/src/math/Vector2');
const { createBrowserFixture } = require('./browserFixture');
const physics = require('../../src/shared/physics/movementPhysics.json');
const { DEFAULT_BINDINGS } = require('../../src/client/site/keyBindings.mjs');

function createLocalPlayerFixture() {
  const keys = new Map();
  let now = 10000;
  class Clock extends Date { static now() { return now; } }
  const Phaser = {
    BlendModes: { ADD: 1 }, Geom: { Triangle: class {} },
    Input: { Keyboard: { JustDown(key) { const pressed = !!key.fresh; key.fresh = false; return pressed; } } },
    Math: { Clamp: (value, min, max) => Math.max(min, Math.min(max, value)) },
  };
  const f = createBrowserFixture('', { url: 'https://game.test/game/1', globals: { Phaser, Date: Clock } });
  const world = Object.assign(new EventEmitter(), {
    defaults: {}, bounds: { x: 0, y: 0, right: 4000, bottom: 2000 }, checkCollision: {}, gravity: new Vector2(0, physics.gravity),
    updateMotion: World.prototype.updateMotion, computeVelocity: World.prototype.computeVelocity,
    computeAngularVelocity: World.prototype.computeAngularVelocity,
  });
  const drawing = () => new Proxy({ active: true }, { get: (object, key) => key in object ? object[key] : () => drawingObject });
  // Rendering is outside this fixture; all physical state uses Arcade's real Body.
  let drawingObject;
  drawingObject = drawing();
  class Sprite extends EventEmitter {
    setOrigin(x, y) { this.originX = x; this.originY = y; this.displayOriginX = this.width * x; this.displayOriginY = this.height * y; return this; }
  }
  function sprite(x, y, texture) {
    const value = Object.assign(new Sprite(), { x, y, width: 256, height: 256,
      displayWidth: 256, displayHeight: 256, scaleX: 1, scaleY: 1, originX: 0.5, originY: 0.5,
      displayOriginX: 128, displayOriginY: 128, angle: 0, rotation: 0, active: true, visible: true,
      frame: { realWidth: 256, realHeight: 256, name: 'idle00' }, texture: { key: texture, has: () => true, get: () => ({ width: 256 }) },
      setScale(scale) { this.scaleX = this.scaleY = scale; this.displayWidth = this.width * scale; this.displayHeight = this.height * scale; return this; },
      setOrigin(x, y) { this.originX = x; this.originY = y; this.displayOriginX = this.width * x; this.displayOriginY = this.height * y; return this; },
      setVisible(value) { this.visible = value; return this; }, setDepth() { return this; },
      setFlipX(value) { this.flipX = value; return this; }, setPosition(x, y) { this.x = x; this.y = y; return this; },
    });
    value.anims = { isPlaying: true, play(key) { this.currentAnim = { key }; return value; }, stop() {} };
    value.body = new Body(world, value);
    for (const method of ['setCollideWorldBounds', 'setVelocity', 'setMaxVelocity', 'setAcceleration', 'setAccelerationX', 'setDrag', 'setDragX']) {
      value[method] = (...args) => { value.body[method](...args); return value; };
    }
    return value;
  }
  const input = Object.assign(new EventEmitter(), { keyboard: { enabled: true,
    addKey(code) { if (!keys.has(code)) keys.set(code, { isDown: false, isUp: true, fresh: false, reset() { this.isDown = false; this.isUp = true; } }); return keys.get(code); },
    resetKeys() {},
  } });
  const scene = { input, physics: { world, add: { sprite } }, events: new EventEmitter(),
    sys: { isActive: () => true }, _mapObjects: [],
    game: { loop: { delta: 1000 / 60 }, canvas: f.document.createElement('canvas') },
    textures: { exists: () => false }, sound: { play() {} },
    add: { graphics: () => drawingObject, text: () => drawingObject, image: () => drawingObject },
    tweens: { add() {} }, anims: { exists: () => true, get: () => ({ frameRate: 10, frames: [{}, {}] }) },
  };
  const modulePath = name => path.resolve(__dirname, '../../src/client/' + name);
  const noop = () => {};
  Object.assign(f.imports, {
    [modulePath('lib/socket')]: { __esModule: true, default: f.socket },
    [modulePath('site/preferences')]: { getSettings: () => ({ keys: DEFAULT_BINDINGS }), subscribeSettings: () => noop, bindCanvasName: noop },
    [modulePath('game/characters')]: { createFor: () => null, getTextureKey: () => 'ninja', getCharacterClassByKey: () => null,
      resolveAnimKey: (_, character, logical) => `${character}-${logical}`, getStats: () => ({ baseHealth: 8000 }), getEffectsClass: () => null },
    [modulePath('game/players/localSocketEvents')]: { bindLocalSocketEvents: () => noop },
    [modulePath('game/characters/networkRegistry')]: { predictCharacterSpecial: noop },
    [modulePath('game/scene/attackAimReticle')]: { createAttackAimReticleController: () => ({ hide: noop, destroy: noop }) },
    [modulePath('game/scene/mobileControls')]: { createMobileControlsController: () => ({ ensure: noop, update: noop, destroy: noop, isEnabled: () => false }) },
    [modulePath('game/scene/combatMouse')]: { createCombatMouseController: () => ({ isActive: () => true, shouldShowReticle: () => false, beginInput: () => true, destroy: noop, endDrag: noop }) },
    [modulePath('game/players/teamFootRing')]: { attachTeamFootRing: noop },
    [modulePath('game/scene/healthBarRenderer')]: { drawHealthBar: noop, resetHealthBarAnimation: noop },
    [modulePath('game/scene/superBarRenderer')]: { drawSuperChargeBar: noop, resetSuperBarAnimation: noop },
    [modulePath('game/players/localMovementAudio')]: { createLocalMovementAudio: () => ({ attach: noop, stopLoops: noop, dispose: noop, stopFallAir: noop, stopWallSlide: noop }) },
    [modulePath('game/players/localMovementFx')]: { createLocalMovementFx: () => ({ reset: noop, markGrounded: noop, clearWallSlide: noop,
      updateGroundMotion: () => 0, updateFalling: noop, updateLanding: noop, updateRunDust: noop, updateWallSlide: noop }) },
  });
  const api = f.load('src/client/game/players/localPlayer.js');
  api.createPlayer(scene, 'Player', 'ninja', null, null, [], [], {});
  api.player.setVisible(true);
  api.player.body.reset(400, 300);
  return { ...f, api, scene, keys, player: api.player,
    press(binding) { const key = keys.get(DEFAULT_BINDINGS[binding]); key.isDown = true; key.isUp = false; key.fresh = true; },
    release(binding) { const key = keys.get(DEFAULT_BINDINGS[binding]); key.isDown = false; key.isUp = true; key.fresh = false; },
    advance(ms) { now += ms; },
    frame() { api.handlePlayerMovement(scene); },
    destroy() { scene.events.emit('shutdown'); },
  };
}

module.exports = { createLocalPlayerFixture };
