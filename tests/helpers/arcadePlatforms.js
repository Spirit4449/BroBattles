// Headless frame loop for moving-platform behaviour. Uses Phaser's real Arcade
// Body and World separation, the game's player/platform collision callback and
// the client moving-platform runtime, in the order a game frame runs them.
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const Body = require('phaser/src/physics/arcade/Body');
const World = require('phaser/src/physics/arcade/World');
const Vector2 = require('phaser/src/math/Vector2');
const { processPlayerPlatformCollision } = require('../../src/client/game/players/platformCollision');
const movement = require('../../src/shared/physics/movementPhysics.json');

const code = babel.transformSync(fs.readFileSync(require.resolve('../../src/client/game/maps/movingPlatforms.js'), 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code;

function loadMovingPlatforms(serverNowMono = () => null) {
  const exports = {};
  const dependencies = {
    '../../../shared/maps/platformMotion': require('../../src/shared/maps/platformMotion'),
    '../../../shared/physics/sweptCollision': require('../../src/shared/physics/sweptCollision'),
    '../match/serverClock': { serverNowMono },
  };
  vm.runInNewContext(code, { exports, performance, require: (id) => dependencies[id] });
  return exports;
}

// The client dash module, for its per-step dash correction (protectDashMotion).
function loadDash() {
  const exports = {};
  const source = babel.transformSync(fs.readFileSync(require.resolve('../../src/client/game/scene/dash.js'), 'utf8'), {
    babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  vm.runInNewContext(source, { exports, Date, require: (id) => id.endsWith('.json') ? movement
    : id.includes('sweptCollision') ? require('../../src/shared/physics/sweptCollision')
    : id.includes('playerAudio') ? { playPlayerSound() {} } : require('../../src/shared/physics/dash') });
  return exports;
}

function createArena() {
  const runtime = loadMovingPlatforms();
  const world = Object.assign(Object.create(World.prototype), {
    gravity: new Vector2(0, movement.gravity), OVERLAP_BIAS: 4, TILE_BIAS: 16, forceX: false,
    defaults: {}, useTree: false, emit() {},
  });
  const platforms = [], players = [];
  const object = (x, y, width, height) => {
    const sprite = { x, y, displayWidth: width, displayHeight: height, scaleX: 1, scaleY: 1,
      displayOriginX: width / 2, displayOriginY: height / 2, angle: 0, rotation: 0,
      setPosition(nx, ny) { this.x = nx; this.y = ny; return this; } };
    sprite.body = new Body(world, sprite);
    return sprite;
  };
  const scene = { _mapObjects: platforms };
  const process = (player, platform) => !runtime.passesThrough(player, platform) &&
    processPlayerPlatformCollision(player, platform);
  let time = 0;
  return {
    runtime, scene,
    // Centre-positioned, like map platform sprites.
    platform(x, y, width, height, motion = null) {
      const sprite = object(x, y, width, height);
      Object.assign(sprite.body, { immovable: true, allowGravity: false });
      sprite._mapMotion = motion; sprite._mapBase = { x, y };
      if (motion) sprite.body.friction.set(0, 0);
      platforms.push(sprite);
      return sprite;
    },
    player(x, y, width = 40, height = 80) {
      const sprite = object(x, y, width, height);
      sprite.body.setMaxVelocity(movement.maxSpeed, movement.maxVerticalSpeed);
      players.push(sprite);
      return sprite;
    },
    get time() { return time; },
    // One 60 Hz frame: platforms move (scene preupdate), bodies integrate,
    // colliders separate, `afterStep` (the local player's worldstep work,
    // e.g. dash correction) and the overlap settle run, bodies write back.
    frame({ afterStep } = {}) {
      time += 1000 / 60;
      runtime.advanceMovingPlatforms(scene, time, players);
      for (const sprite of [...platforms, ...players]) sprite.body.preUpdate(true, 1 / 60);
      for (const player of players) for (const platform of platforms) {
        World.prototype.separate.call(world, player.body, platform.body, process, null, false);
      }
      afterStep?.();
      runtime.settleMovingPlatformOverlaps(scene, players);
      for (const sprite of [...platforms, ...players]) sprite.body.postUpdate();
    },
  };
}

module.exports = { createArena, loadMovingPlatforms, loadDash };
