const { loadClientModule } = require('./helpers/clientModule');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const path = require('node:path');

test("retiring a fighter detaches its pending movement sound loaders", () => {
  const { EventEmitter } = require("node:events");
  const { createLocalMovementAudio } = loadClientModule("src/client/game/players/localMovementAudio.js", {
    require: () => ({}),
  });
  const audio = createLocalMovementAudio();
  const created = [];
  const makeScene = name => {
    const events = new EventEmitter();
    const sounds = new Set();
    return {
      events: new EventEmitter(),
      sound: { add(key) { created.push([name, key]); return {}; } },
      cache: { audio: { events, exists: key => sounds.has(key) } },
      load(key) { sounds.add(key); events.emit("add", key); },
    };
  };
  const first = makeScene("old");
  const second = makeScene("new");
  audio.attach(first);
  audio.attach(second);
  first.load("sfx-sliding");
  first.events.emit("shutdown");
  second.load("sfx-sliding");
  assert.deepEqual(created, [["new", "sfx-sliding"]]);
  audio.dispose();
  second.load("sfx-fall-air");
  assert.equal(created.length, 1);
});

test("the first local fall fades in from silence once the audio context is running", () => {
  const { EventEmitter } = require("node:events");
  const { createClientModuleGraph } = require("./helpers/clientModule");
  const graph = createClientModuleGraph();
  const { createLocalMovementAudio } = graph.load("src/client/game/players/localMovementAudio.js");
  const audio = createLocalMovementAudio();
  const starts = [];
  const loop = {
    isPlaying: false,
    // Web Audio can report unity gain while the first volume update is pending.
    get volume() { return 1; },
    setVolume(volume) { this.appliedVolume = volume; },
    setRate() {},
    play({ volume }) { starts.push(volume); this.isPlaying = true; return true; },
    stop() { this.isPlaying = false; },
  };
  const context = { state: "suspended", currentTime: 0 };
  const scene = {
    events: new EventEmitter(),
    cache: { audio: { events: new EventEmitter(), exists: key => key === "sfx-fall-air" } },
    sound: { locked: false, context, add: () => loop },
  };
  audio.attach(scene);
  audio.updateFallingAir(scene, true, 760);
  assert.deepEqual(starts, []);

  context.state = "running";
  audio.updateFallingAir(scene, true, 760);
  assert.deepEqual(starts, [0]);
  assert.equal(loop.appliedVolume, 0);
  context.currentTime += 0.1;
  audio.updateFallingAir(scene, true, 760);
  assert.ok(loop.appliedVolume > 0 && loop.appliedVolume < 0.18);
  context.state = "suspended";
  audio.updateFallingAir(scene, true, 760);
  assert.equal(loop.isPlaying, false);
  context.state = "running";
  audio.updateFallingAir(scene, true, 760);
  assert.deepEqual(starts, [0, 0]);
  assert.equal(loop.appliedVolume, 0);
  audio.dispose();
});

describe("Spatial mix and spectating", () => {
  const audio = {};
  loadClientModule('src/client/game/audio/playerAudio.js', { exports: audio });

  function scene() {
    const calls = [];
    const local = { active: true, x: 200, y: 200 };
    return { calls, local, _localPlayerAudioSprite: local,
      cameras: { main: { midPoint: { x: 200, y: 200 },
        worldView: { x: 0, y: 0, width: 1000, height: 700 } } },
      sound: { play: (...args) => { calls.push(args); return true; } } };
  }

  test('per-sample combat gains apply before distance attenuation and allow playback overrides', () => {
    const s = scene();
    const remote = { active: true, x: 480, y: 320 };
    const playVolume = (source, key, options) => {
      assert.equal(audio.playPlayerSound(s, source, key, options), true);
      return s.calls.at(-1)[1].volume;
    };
    for (const source of [s.local, remote]) {
      const sparrowHit = playVolume(source, 'sparrow-hit');
      const ninjaHit = playVolume(source, 'shurikenHit');
      const stockGain = playVolume(source, 'sfx-death');
      assert.ok(sparrowHit < stockGain && ninjaHit > stockGain);
      assert.equal(sparrowHit, audio.playerSoundVolume(s, source, audio.combatSoundVolume('sparrow-hit')));
      assert.equal(ninjaHit, audio.playerSoundVolume(s, source, audio.combatSoundVolume('shurikenHit')));
      const bounceVolume = audio.combatSoundVolume('gloop-hit') / 2;
      assert.equal(playVolume(source, 'gloop-hit', { volume: bounceVolume }),
        audio.playerSoundVolume(s, source, bounceVolume));
    }
  });

  test('spectating makes the watched fighter the full-volume listener and follows switches', () => {
    const s = scene();
    const watched = { active: true, x: 800, y: 300 };
    const other = { active: true, x: 800, y: 300 };
    s._spectatorModeActive = true;
    s._spectatedPlayerAudioSprite = watched;
    assert.equal(audio.playerAudioListener(s), watched);
    assert.equal(audio.playerSoundVolume(s, watched, 0.65), 0.65);
    assert.ok(audio.playerSoundVolume(s, other, 0.65) > 0 && audio.playerSoundVolume(s, other, 0.65) < 0.65);
    assert.ok(audio.playerSoundVolume(s, s.local, 0.65) < 0.65);
    s._spectatedPlayerAudioSprite = other;
    assert.equal(audio.playerSoundVolume(s, other, 0.65), 0.65);
    assert.ok(audio.playerSoundVolume(s, watched, 0.65) < 0.65);
    audio.playPlayerSound(s, other, 'special', { volume: 0.65, rate: 1.1 });
    assert.equal(s.calls[0][1].volume, 0.65);
    assert.equal(s.calls[0][1].rate, 1.1);
  });

});

describe("Local movement cues", () => {
  const terrainAudio = require('../src/shared/physics/terrainAudio.json');

  const exported = {};

  loadClientModule(require.resolve('../src/client/game/audio/movementAudio.js'), { exports: exported, require: key => key.includes('movementSounds') ? require('../src/shared/physics/movementSounds') : terrainAudio });
  const { getTerrainSteps, footstepVolume, terrainLandingSound, shouldPlayLandingSound, preloadTerrainAudio } = exported;

  test('terrain preload queues each registered sound once and resolves its files', () => {
    const loads = [];
    preloadTerrainAudio({ load: { audio: (key, urls) => loads.push({ key, urls }) } }, '/assets');
    const expectedKeys = new Set(Object.values(terrainAudio.terrains).flatMap(terrain =>
      [...terrain.steps, terrain.landing].filter(Boolean).map(sound => sound.key)));
    assert.deepEqual(new Set(loads.map(sound => sound.key)), expectedKeys);
    assert.equal(loads.length, expectedKeys.size, 'shared samples queue once');
    for (const sound of loads) for (const url of sound.urls) {
      assert.ok(fs.statSync(path.join(__dirname, '../public', url)).size > 0, url);
    }
  });

  test('the opening spawn settle is silent and a real jump re-arms landing audio', () => {
    const player = { _suppressSpawnLandingSound: true, body: { velocity: { y: 88 } } };
    assert.equal(shouldPlayLandingSound(player, false), false);
    assert.equal(shouldPlayLandingSound(player, false), false);
    player.body.velocity.y = 0;
    assert.equal(shouldPlayLandingSound(player, true), false);
    assert.equal(player._suppressSpawnLandingSound, true);
    player.body.velocity.y = -400;
    assert.equal(shouldPlayLandingSound(player, false), true);
    player.body.velocity.y = 0;
    assert.equal(shouldPlayLandingSound(player, true), true, 'normal jump landing remains audible');
  });

});

describe("Replicated movement cues", () => {
  const { EventEmitter } = require('node:events');
  function load(path, dependencies = {}, extra = {}) {
    const exports = {};

    loadClientModule(path, { exports, require: key => {
      if (key.includes('movementSounds')) return require('../src/shared/physics/movementSounds');
      assert.ok(key in dependencies, key); return dependencies[key];
    }, ...extra });
    return exports;
  }
  const audio = load('src/client/game/audio/playerAudio.js');
  const movement = load('src/client/game/audio/movementAudio.js', {
    './playerAudio': audio, '../../../shared/physics/terrainAudio.json': require('../src/shared/physics/terrainAudio.json'),
  });
  function fixture() {
    let time = 0;
    const calls = [], sounds = [];
    const sprite = Object.assign(new EventEmitter(), { active: true, x: 200, y: 200 });
    const scene = { events: new EventEmitter(), _terrainType: 'grass',
      _localPlayerAudioSprite: { active: true, x: 200, y: 200 },
      cameras: { main: { worldView: { x: 0, y: 0, width: 1000, height: 700 } } },
      sound: { context: { state: 'running', get currentTime() { return time / 1000; } },
        play(key, options) { calls.push({ key, ...options }); return true; },
        add(key) {
          const sound = { key, isPlaying: false, destroyed: 0,
            setVolume(v) { this.volume = v; }, setRate(v) { this.rate = v; },
            play(options) { Object.assign(this, options); this.isPlaying = true; return true; },
            stop() { this.isPlaying = false; }, destroy() { this.destroyed++; },
          }; sounds.push(sound); return sound;
        } },
    };
    const module = load('src/client/game/audio/remoteMovementAudio.js', {
      './playerAudio': audio, './movementAudio': movement,
      '../../../shared/physics/movementPhysics.json': require('../src/shared/physics/movementPhysics.json'),
      '../scene/effects': { MOVEMENT_VFX_CONFIG: { fastFallMaxVelocity: 760, runSpeedReference: 260,
        landingMaxVelocity: 760, landingShockwaveMinFallPx: 150 } },
    }, { performance: { now: () => time } });
    const controller = module.createRemoteMovementAudio(scene, sprite);
    function update(state, delta = 16) { time += delta; controller.update(state); scene.events.emit('postupdate'); }
    return { scene, sprite, calls, sounds, controller, update,
      tick(delta) { time += delta; scene.events.emit('postupdate'); } };
  }

  test('event IDs suppress repeated jump, wall jump and landing audio and historical joins', () => {
    const f = fixture();
    f.update({ grounded: true, movementFxSeq: 5, movementFxType: 'jump' });
    assert.equal(f.calls.length, 0);
    const jump = { grounded: false, vy: -300, movementFxSeq: 6, movementFxType: 'jump' };
    f.update(jump); f.update(jump); assert.equal(f.calls.length, 1);
    const wallJump = { grounded: false, vx: 250, vy: -300, movementFxSeq: 7, movementFxType: 'wall-jump' };
    f.update(wallJump); f.update(wallJump); assert.equal(f.calls.length, 2);
    const land = { grounded: true, movementFxSeq: 8, movementFxType: 'land', movementFxImpactVelocity: 700, movementFxFallDistance: 200 };
    f.update(land); f.update(land);
    assert.deepEqual(f.calls.map(c => c.key), ['sfx-jump', 'sfx-walljump', 'sfx-grass-land']);
    f.controller.reset(); f.update(land); assert.equal(f.calls.length, 3);
    f.controller.destroy();
  });

  test('stale movement, presentation resets, shutdown and sprite destruction release loops', () => {
    for (const end of ['stale', 'reset', 'shutdown', 'destroy']) {
      const f = fixture();
      f.update({ grounded: false, wallSliding: true, vy: 100 });
      assert.ok(f.sounds[0].isPlaying);
      if (end === 'stale') f.tick(301);
      if (end === 'reset') f.scene.events.emit('presentation:reset');
      if (end === 'shutdown') f.scene.events.emit('shutdown');
      if (end === 'destroy') f.sprite.emit('destroy');
      assert.equal(f.sounds[0].isPlaying, false); assert.equal(f.sounds[0].destroyed, 1);
      f.controller.destroy();
      assert.equal(f.scene.events.listenerCount('postupdate'), 0);
      assert.equal(f.scene.events.listenerCount('presentation:reset'), 0);
      assert.equal(f.sprite.listenerCount('destroy'), 0);
    }
  });

  test('a remote fall starts its fade when the deferred wind sample becomes playable', () => {
    const f = fixture();
    const add = f.scene.sound.add;
    f.scene.sound.add = () => { throw new Error('audio still loading'); };
    const falling = { grounded: false, vy: 700 };
    f.update(falling);
    f.update(falling, 250);
    assert.equal(f.sounds.length, 0);
    f.scene.sound.add = add;
    f.update(falling);
    const wind = f.sounds[0];
    assert.equal(wind.key, 'sfx-fall-air');
    assert.equal(wind.volume, 0);
    f.update(falling, 40);
    assert.ok(wind.volume > 0);
    const earlyVolume = wind.volume;
    f.update(falling, 200);
    assert.ok(wind.volume > earlyVolume);
    f.controller.destroy();
  });

  test('locked audio stays silent; invisible fighters still produce movement cues', () => {
    const f = fixture(), walking = { grounded: true, vx: 260 };
    f.scene.sound.locked = true;
    f.update(walking); f.update({ grounded: false, wallSliding: true, vy: 100 });
    assert.equal(f.calls.length, 0); assert.equal(f.sounds.length, 0);
    f.scene.sound.locked = false;
    f.sprite.alpha = 0; f.sprite._powerupInvisible = true;
    f.controller.reset(); f.update(walking);
    assert.equal(f.calls.length, 1);
    f.controller.destroy();
  });

});

describe('Bro Ball audio', () => {
  const { EventEmitter } = require('node:events');
  const { createClientModuleGraph } = require('./helpers/clientModule');
  const map = require('../src/shared/maps/6.json');
  const { ballRules } = require('../src/shared/broBall');
  const document = { hidden: false };
  const graph = createClientModuleGraph({ globals: { document } });
  const { broBallMovementTerrain, createBroBallAudio } = graph.load('src/client/game/modes/broBall/audio.js');
  const { canPlayTerrainCue, movementTerrainAt } = graph.load('src/client/game/audio/movementAudio.js');
  const objects = map.layout.hitboxes.map(({ id, x, y, width, height, collision }) => ({
    _mapObjectId: id,
    body: { enable: true, left: x - width / 2, right: x + width / 2, top: y - height / 2, checkCollision: collision },
  }));
  const getSurface = id => objects.find(o => o._mapObjectId === id).body;

  test('movement uses the supporting material for local and replicated landings', () => {
    const scene = { _mapObjects: objects, _terrainType: 'grass', _movementTerrainAt: broBallMovementTerrain };
    const deck = getSurface('platform-left');
    const goal = getSurface('left-goal-base');
    const fighter = {
      body: { left: deck.left + 10, right: deck.left + 50, bottom: deck.top, width: 40, height: 80, offset: { x: 0, y: 0 } },
      scaleX: 1, scaleY: 1, displayOriginX: 20, displayOriginY: 40,
    };
    assert.equal(movementTerrainAt(scene, fighter), 'wood');
    fighter.body.bottom -= 120;
    assert.equal(movementTerrainAt(scene, fighter, { x: deck.left + 30, y: deck.top - 40 }), 'wood');
    assert.equal(movementTerrainAt(scene, fighter, { x: goal.left + 30, y: goal.top - 40 }), 'hard');
    assert.equal(movementTerrainAt(scene, fighter, { x: deck.left + 30, y: getSurface('pitch-floor').top - 40 }), 'grass');
  });

  test('a deck creak needs a strong landing and reserves time to decay across fighters', () => {
    const { cadence } = require('../src/shared/physics/terrainAudio.json').terrains.wood;
    const local = { x: 620, y: 730 };
    const teammate = { x: 635, y: 730 };
    const scene = { time: { now: 100 }, _localPlayerAudioSprite: local };
    const step = { volume: 0.1 };
    const softLanding = { volume: 0.2, landingStrength: cadence.minLandingStrength / 2 };
    const hardLanding = { volume: 0.3, landingStrength: 1 };
    assert.equal(canPlayTerrainCue(scene, 'wood', softLanding), false);
    assert.equal(canPlayTerrainCue(scene, 'wood', step), true);
    assert.equal(canPlayTerrainCue(scene, 'wood', { ...step, source: teammate }), false);
    scene.time.now += cadence.stepGapMs;
    assert.equal(canPlayTerrainCue(scene, 'wood', { ...hardLanding, source: teammate }), true);
    assert.equal(canPlayTerrainCue(scene, 'wood', step), false);
    assert.equal(canPlayTerrainCue(scene, 'wood', hardLanding), false);
    assert.equal(canPlayTerrainCue(scene, 'grass', step), true);
    scene.time.now += cadence.landingTailMs;
    assert.equal(canPlayTerrainCue(scene, 'wood', step), true);
    assert.equal(canPlayTerrainCue(scene, 'wood', hardLanding), false);
    scene.time.now += cadence.landingGapMs;
    assert.equal(canPlayTerrainCue(scene, 'wood', hardLanding), true);
  });

  test('off-camera ball impacts stay audible and powerful shots get a single launch swish', () => {
    const calls = [], fades = [], loops = new Map();
    const scene = {
      events: new EventEmitter(), game: { events: new EventEmitter() }, time: { now: 8000 },
      cache: { audio: { exists: () => true } },
      _mapObjects: objects, _localPlayerAudioSprite: { x: 1000, y: 850 },
      cameras: { main: { worldView: { x: 850, y: 680, width: 400, height: 270 } } },
      _bgmEnvelope: { fade: intensity => fades.push(intensity) },
      sound: {
        play(key, options) {
          calls.push({ key, ...options });
          return true;
        },
        add(key) {
          const sound = {
            play(options) { this.isPlaying = true; Object.assign(this, options); },
            stop() { this.isPlaying = false; },
            setVolume(volume) { this.volume = volume; },
            setRate() {},
            destroy() { this.destroyed = true; },
          };
          loops.set(key, sound);
          return sound;
        },
      },
    };
    const audio = createBroBallAudio(scene);
    const ball = { x: 300, y: getSurface('pitch-floor').top - ballRules.radius, vx: ballRules.kickSpeed, vy: 0 };
    audio.kickoff(true);
    calls.length = 0;
    const airborne = { ...ball, y: ball.y - 120, vx: ballRules.dashSpeed, vy: -150 };
    audio.update(airborne, 0.016, false);
    const crowd = loops.get('bro-ball-stands-crowd');
    assert.ok(crowd.isPlaying);
    assert.equal(loops.size, 1, 'open air has no ball loop');
    assert.equal(calls.length, 0);
    audio.update({ ...ball, y: ball.y - 4, vy: ballRules.settleSpeed / 2 }, 0.016, false);
    assert.ok(loops.get('bro-ball-roll').isPlaying);
    audio.impact({ ...ball, kind: 'body', seq: 1, strength: ballRules.settleSpeed }, false);
    assert.equal(calls[0].key, 'bro-ball-touch');
    assert.ok(calls[0].volume > 0 && calls[0].pan < 0, 'off-camera taps keep their direction and remain audible');
    audio.impact({ ...ball, kind: 'kick', seq: 2, strength: ballRules.kickSpeed }, false);
    audio.impact({ ...ball, kind: 'super', seq: 3, strength: ballRules.superKickSpeed }, false);
    audio.update(airborne, 0.016, false);
    assert.deepEqual(calls.slice(1).map(call => call.key), ['bro-ball-kick', 'bro-ball-kick-2', 'bro-ball-shot-swish']);
    calls.length = 0;
    audio.impact({ ...ball, kind: 'post', seq: 4, strength: ballRules.kickSpeed }, false);
    assert.deepEqual(calls.map(call => call.key), ['bro-ball-rebound']);
    calls.length = 0;
    audio.impact({ ...ball, kind: 'goal', seq: 5, strength: ballRules.kickSpeed }, false);
    assert.deepEqual(calls.map(call => call.key), ['bro-ball-rebound', 'bro-ball-goal-celebration']);
    assert.ok(calls[1].volume > calls[0].volume, 'the stadium celebration leads the rebound');
    const previousCrowdVolume = crowd.volume;
    audio.update(airborne, 0.016, true);
    assert.ok(crowd.volume > previousCrowdVolume, 'the live stadium bed swells during the goal');
    audio.kickoff();
    assert.equal(loops.get('bro-ball-roll').isPlaying, false);
    assert.equal(loops.get('bro-ball-stands-crowd'), crowd);
    assert.ok(crowd.isPlaying, 'the stadium crowd keeps playing through a goal and kickoff');
    assert.equal(calls.at(-1).key, 'bro-ball-kickoff-whistle');
    assert.ok(fades[0] < fades[1]);
    const winningImpact = { ...ball, kind: 'goal', seq: 6, winner: 'team1', strength: ballRules.kickSpeed };
    audio.impact(winningImpact, false, 'team2');
    assert.deepEqual(calls.slice(-3).map(call => call.key),
      ['bro-ball-rebound', 'bro-ball-goal-celebration', 'bro-ball-final-whistle']);
    assert.equal(audio.playedWinningGoal, false);
    audio.impact(winningImpact, false, 'team1');
    assert.deepEqual(calls.slice(-3).map(call => call.key),
      ['bro-ball-rebound', 'bro-ball-goal-victory', 'bro-ball-final-whistle']);
    assert.equal(audio.playedWinningGoal, true);
    scene._battleEnded = true;
    audio.update(ball, 0.016, false);
    assert.equal(crowd.isPlaying, false);
    audio.destroy();
    assert.ok([...loops.values()].every(sound => sound.destroyed));
    assert.equal(scene.game.events.listenerCount('blur'), 0);
  });
});
