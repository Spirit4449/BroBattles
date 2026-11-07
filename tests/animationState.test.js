const { loadClientModule } = require('./helpers/clientModule');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe("Action playback and locks", () => {
  function load(file, dependencies = {}) {
    const exports = {};

    loadClientModule(require.resolve(file), { exports, require: key => dependencies[key] || {} });
    return exports;
  }
  const animation = load('../src/client/game/characters/shared/animationState');

  test('an interrupted jump resumes, while an uninterrupted completed jump stays on its last frame', () => {
    const calls = [];
    const sprite = { body: { touching: { down: false } }, anims: {
      play(key, ignoreIfPlaying) { calls.push({ key, ignoreIfPlaying }); this.currentAnim = { key }; },
    } };
    const play = logical => animation.playCharacterAnimation({ scene: {}, sprite, character: 'ninja',
      logical, resolveAnimKey: (_scene, char, wanted) => `${char}-${wanted}` });
    play('jumping');
    sprite.anims.isPlaying = false;
    play('jumping');
    assert.equal(calls.length, 1);
    play('throw');
    play('jumping');
    assert.equal(calls.length, 3);
    assert.equal(calls.at(-1).key, 'ninja-jumping');
  });

  test('remote death wins over residual velocity and dash snapshots reset landed jumps', () => {
    assert.equal(animation.chooseRemoteAnimationState({ animation: 'dying',
      currentPosition: { grounded: false, vy: -300, wallSliding: false } }), 'dying');
    const sprite = { _bbAnimationState: { jumpPlayedAirborne: true, restartJump: true } };
    assert.equal(animation.chooseRemoteAnimationState({ animation: 'dashing', sprite,
      currentPosition: { grounded: true } }), 'dashing');
    assert.equal(sprite._bbAnimationState.jumpPlayedAirborne, false);
    assert.equal(sprite._bbAnimationState.restartJump, false);
  });

  test('a remote follow-up packet that plays nothing keeps the windup lock instead of restarting it', () => {
    // Wizard: the windup plays the throw, the release 520 ms later plays nothing.
    const throwAnim = { frameRate: 18, frames: Array.from({ length: 8 }, () => ({ duration: 58 })) };
    const scene = { anims: { get: key => (key === 'wizard-throw' ? throwAnim : null) } };
    const sprite = { anims: { play(key) { this.currentAnim = { key }; } } };
    const wrapper = { opponent: sprite };
    const playThrow = () => { sprite.anims.play('wizard-throw'); animation.noteAnimationPlayed(sprite, 'throw'); return true; };
    const present = (actionType, handler) =>
      animation.presentRemoteAction({ scene, wrapper, character: 'wizard', actionType }, handler);

    const lockOf = target => animation.remoteAnimationLockUntil(target);
    assert.equal(present('wizard-fireball', playThrow), true);
    const lock = lockOf(sprite);
    assert.ok(lock > 0);

    assert.equal(present('wizard-fireball-release', () => true), true);
    assert.equal(lockOf(sprite), lock, 'the release does not extend the lock');

    // A handler that replays the animation (the next attack) gets a fresh lock.
    const start = Date.now(); while (Date.now() - start < 5) {}
    present('wizard-fireball', playThrow);
    assert.ok(lockOf(sprite) > lock);

    // Unconsumed actions never lock.
    const idle = { opponent: { anims: {} } };
    animation.presentRemoteAction({ scene, wrapper: idle, character: 'wizard', actionType: 'x' }, () => false);
    assert.equal(lockOf(idle.opponent), 0);
  });

  // The action layer on a controllable clock, with a fake Phaser animation set.
  function actionRig() {
    let now = 1000;
    const exports = {};

    loadClientModule(require.resolve('../src/client/game/characters/shared/animationState'), { exports, require: () => ({}), performance: { now: () => now }, Date: { now: () => now } });
    const clips = {
      'wizard-special': { frameRate: 50, frames: Array.from({ length: 16 }, () => ({ duration: 90 })) },
      'wizard-throw': { frameRate: 18, frames: Array.from({ length: 8 }, () => ({ duration: 58 })) },
    };
    for (const key of ['idle', 'running', 'jumping', 'dying', 'dashing']) clips[`wizard-${key}`] = { frameRate: 10, frames: [{}] };
    const scene = { anims: { exists: key => !!clips[key], get: key => clips[key] } };
    const plays = [];
    const sprite = { _bbCharacter: 'wizard', anims: { play(key, ignoreIfPlaying) {
      plays.push({ key, ignoreIfPlaying });
      if (!(ignoreIfPlaying && this.currentAnim?.key === key)) this.currentAnim = { key };
    } } };
    const api = exports;
    const action = (logical, options = {}) => api.playSpriteAnimation({ scene, sprite, character: 'wizard', logical, fallback: 'idle', ...options });
    const move = logical => api.playCharacterAnimation({ scene, sprite, character: 'wizard', logical,
      resolveAnimKey: (_scene, char, wanted) => `${char}-${wanted}` });
    return { api, sprite, plays, action, move, duration: key => api.getAnimationDurationMs(scene, key), advance: ms => { now += ms; } };
  }

  test('a special shows for its whole animation and movement cannot cut it short', () => {
    const rig = actionRig();
    rig.action('special');
    const length = rig.duration('wizard-special');
    rig.advance(length - 50);
    for (const logical of ['running', 'jumping', 'idle']) rig.move(logical);
    assert.equal(rig.sprite.anims.currentAnim.key, 'wizard-special');
    assert.equal(rig.api.getPresentedAnimation(rig.sprite), 'special');
    rig.advance(60);
    rig.move('running');
    assert.equal(rig.sprite.anims.currentAnim.key, 'wizard-running');
  });

  test('a new attack id restarts the throw, the same id does not', () => {
    const rig = actionRig();
    rig.action('throw', { id: 'a' });
    rig.action('throw', { id: 'a' });
    assert.equal(rig.plays.length, 1);
    rig.advance(100);
    rig.action('throw', { id: 'b' });
    assert.equal(rig.plays.length, 2);
    assert.equal(rig.plays[1].ignoreIfPlaying, false);
    assert.equal(rig.api.activeAction(rig.sprite).id, 'b');
  });

  test('dashing and dying end an action; other character animations replace it', () => {
    for (const interrupt of ['dashing', 'dying']) {
      const rig = actionRig();
      rig.action('special');
      rig.move(interrupt);
      assert.equal(rig.sprite.anims.currentAnim.key, `wizard-${interrupt}`);
      assert.equal(rig.api.activeAction(rig.sprite), null);
    }
    const rig = actionRig();
    rig.action('throw');
    rig.action('dying');
    assert.equal(rig.api.activeAction(rig.sprite), null);
    assert.equal(rig.sprite.anims.currentAnim.key, 'wizard-dying');
  });
});

describe("Atlas animation setup", () => {
  const { createAnimationBuilder } = require('../src/client/game/characters/shared/animationBuilder');

  function setup(names) {
    const animations = new Map();
    const scene = {
      textures: { get: () => ({ getFrameNames: () => names }) },
      anims: {
        exists: key => animations.has(key),
        create: config => animations.set(config.key, config),
      },
    };
    return { builder: createAnimationBuilder(scene, 'character'), animations };
  }

  test('repeated setup preserves existing animation definitions and skips missing frames', () => {
    const { builder, animations } = setup(['idle00']);
    builder.make('idle', 'idle', 8, -1);
    builder.make('idle', 'idle', 12, 0);
    builder.make('missing', ['absent'], 8, -1);
    assert.equal(animations.size, 1);
    assert.equal(animations.get('idle').frameRate, 8);
  });

});

describe("Attached presentation lifecycle", () => {
  const { EventEmitter } = require('node:events');
  const { attachToPlayer, PLAYER_LAYERS } = require('../src/client/game/characters/shared/attachToPlayer.js');

  function world() {
    const made = [];
    const scene = { events: new EventEmitter(), add: { graphics() {
      const g = { active: true, setDepth(d) { this.depth = d; return this; }, destroy() { this.active = false; } };
      made.push(g); return g;
    } } };
    const sprite = Object.assign(new EventEmitter(), { active: true, depth: 30, body: { enable: true } });
    const listeners = () => ['postupdate', 'shutdown', 'presentation:reset'].reduce((n, e) => n + scene.events.listenerCount(e), 0)
      + sprite.listenerCount('destroy') + sprite.listenerCount('attack:interrupted');
    return { scene, sprite, made, listeners };
  }

  test('every way an attachment can end cleans it up', () => {
    const endings = {
      'player dies': ({ sprite, scene }) => { sprite.body.enable = false; scene.events.emit('postupdate', 0, 16); },
      'player destroyed': ({ sprite }) => sprite.emit('destroy'),
      'scene shutdown': ({ scene }) => scene.events.emit('shutdown'),
      'presentation reset': ({ scene }) => scene.events.emit('presentation:reset'),
      'sprite event': ({ sprite }) => sprite.emit('attack:interrupted'),
      'update returns false': ({ scene, stop }) => { stop.now = true; scene.events.emit('postupdate', 0, 16); },
    };
    for (const [name, end] of Object.entries(endings)) {
      const w = world();
      const stop = { now: false };
      let ended = 0;
      const fx = attachToPlayer(w.scene, w.sprite, { layers: ['behind'], endOn: ['attack:interrupted'],
        onEnd: () => ended++, update: () => !stop.now });
      end({ ...w, stop });
      assert.equal(fx.active, false, name);
      assert.equal(ended, 1, name);
      assert.ok(w.made.every(g => !g.active), name);
      assert.equal(w.listeners(), 0, name);
    }
  });

  test('a keyed attachment replaces the previous one; detach hands its objects on', () => {
    const { scene, sprite } = world();
    const ball = { active: true, destroy() { this.active = false; } };
    const first = attachToPlayer(scene, sprite, { key: 'cast', objects: [ball] });
    const second = attachToPlayer(scene, sprite, { key: 'cast', objects: [ball] });
    assert.equal(first.active, false);
    assert.equal(ball.active, false, 'the replaced attachment took its objects with it');
    const kept = { active: true, destroy() { this.active = false; } };
    const third = attachToPlayer(scene, sprite, { key: 'cast', objects: [kept] });
    assert.equal(second.active, false);
    third.detach();
    assert.equal(third.active, false);
    assert.equal(kept.active, true, 'detached objects survive');
    assert.equal(sprite._bbAttachments.size, 0);
  });
});
