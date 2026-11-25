const { loadClientModule } = require('./helpers/clientModule');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe("Draven confirmed impacts", () => {
  function load(file, deps, globals = {}) {
    const exports = {};
    loadClientModule(file, {exports,require:name=>deps[name] || {}, ...globals});
    return exports;
  }
  test('remote cast never schedules a phantom explosion; confirmed impact renders once at target',()=>{
    const impacts=[];
    const Draven=load('src/client/game/characters/draven/constructor.js',{
      '../../../../shared/characters/characterTuning.js':{getResolvedCharacterAttackConfig:()=>({})},
      '../shared/characterEntityBase':{default:class {},__esModule:true},
      '../shared/animationState':{playSpriteAnimation(){}},
      './attack':{spawnExplosion:(...args)=>impacts.push(args)},
    }).default;
    const scene={sound:{play(){}},time:{delayedCall(){throw Error('phantom impact timer');}}};
    const owner={opponent:{active:true,x:10,y:20}};
    assert.equal(Draven.handleRemoteAttack(scene,{type:'draven-splash'},owner),true);
    assert.equal(impacts.length,0);
    Draven.handleRemoteAttack(scene,{type:'draven-splash-explode',x:240,y:160},owner);
    assert.equal(impacts.length,1);
    assert.equal(impacts[0][1],240);assert.equal(impacts[0][2],160);
  });

  test('Inferno shield follows local and remote Draven and clears on completion or interruption', () => {
    const { EventEmitter } = require('node:events');
    const tuning = require('../src/shared/characters/characterTuning');
    const audio = [];
    const transitions = { enter: 0, exits: [] };
    const api = load('src/client/game/characters/draven/special.js', {
      './infernoTransitions': {
        INFERNO_SHIELD_POP_MS: 360, infernoPopScale: () => 1, infernoBurnoutAlpha: () => 1,
        infernoEnterBeats: () => ({ gatherMs: 100, crownMs: 450, doneMs: 800 }),
        playInfernoEnter: () => { transitions.enter += 1; },
        playInfernoExit: (_scene, _player, options) => transitions.exits.push(options),
      },
      '../../../../shared/combat/runtime/abilities/dravenInfernoLift.js': require('../src/shared/combat/runtime/abilities/dravenInfernoLift.js'),
      './infernoAudio': { startInfernoAudio: () => { const run = { stops: [] }; audio.push(run); return released => run.stops.push(released); } },
      '../../../../shared/characters/characterTuning.js': tuning,
      '../../../../shared/projectilePresentation': require('../src/shared/projectilePresentation'),
      '../shared/runtimeId': { createRuntimeId: () => 'inferno' },
      '../shared/flipLock': { lockPlayerFlip: () => () => {} },
      '../shared/animationState.js': { markOneShotAnimation() {}, playSpriteAnimation() {}, resolveSpriteAnimationKey() {} },
      '../../scene/renderLayers': { RENDER_LAYERS: { PLAYER: 30 } },
      '../../scene/fx/shieldBubble': load('src/client/game/scene/fx/shieldBubble.js', {
        './pixelShapes': load('src/client/game/scene/fx/pixelShapes.js', {}),
      }),
    }, { Phaser: { BlendModes: { ADD: 1 }, Math: { Between: a => a, FloatBetween: a => a,
      Clamp: (v, min, max) => Math.max(min, Math.min(max, v)), Easing: { Cubic: { Out: v => v } } } } });
    for (const isOwner of [true, false]) for (const ending of ['complete', 'interrupt', 'destroy', 'shutdown', 'match-end']) {
      const timers = [];
      const shape = () => ({ active: true, rects: [],
        setDepth(v) { this.depth = v; }, setBlendMode() {},
        clear() { this.rects = []; },
        fillStyle() {}, lineStyle() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fillPath() {}, strokePath() {}, fillEllipse() {},
        fillCircle() {}, strokeCircle() {}, arc() {},
        fillRect(x, y, w, h) { this.rects.push({ x, y, w, h }); },
        center() {
          const minX = Math.min(...this.rects.map(r => r.x)), maxX = Math.max(...this.rects.map(r => r.x + r.w));
          const minY = Math.min(...this.rects.map(r => r.y)), maxY = Math.max(...this.rects.map(r => r.y + r.h));
          return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
        },
        destroy() { this.active = false; } });
      const player = Object.assign(new EventEmitter(), { active: true, x: 100, y: 200 });
      const scene = { events: new EventEmitter(), time: { now: 0, delayedCall(delay, callback) { timers.push({ delay, callback }); } },
        textures: { exists: () => false }, add: { graphics: shape, circle: shape }, tweens: { add() {} } };
      const exitsBefore = transitions.exits.length;
      api.perform({ scene, player, isOwner });
      const shield = player._dravenInfernoShield;
      assert.ok(shield.active);
      assert.ok(shield.rects.length > 0);
      assert.ok(shield.depth > 30);
      if (!isOwner) { player.x += 40; player.y -= 20; }
      timers.find(timer => timer.delay === 16).callback();
      // The stepped shell is centred on Draven to within a couple of grid cells.
      assert.ok(Math.abs(shield.center().x - player.x) <= 4);
      assert.ok(Math.abs(shield.center().y - player.y) <= 4);
      if (ending === 'match-end') {
        player._matchEnded = true;
        // Move away from the cast anchor so a surviving hover tick is observable.
        player.x += 25;
        player.y += 35;
        const position = { x: player.x, y: player.y };
        const timerCount = timers.length;
        timers.filter(timer => timer.delay === 16).at(-1).callback();
        assert.deepEqual({ x: player.x, y: player.y }, position);
        assert.equal(timers.length, timerCount, 'ended matches must not reschedule hover');
      }
      if (ending === 'complete' || ending === 'match-end') timers.find(timer => timer.delay === tuning.getResolvedCharacterSpecialConfig('draven', 'inferno').durationMs).callback();
      else if (ending === 'shutdown') scene.events.emit('shutdown');
      else player.emit(ending === 'interrupt' ? 'attack:interrupted' : 'destroy');
      if (ending === 'match-end') {
        assert.equal(player._dravenInfernoToken, undefined);
        assert.equal(player._dravenInfernoPrevGravity, undefined);
      }
      assert.equal(shield.active, false);
      assert.equal(player._dravenInfernoShield, undefined);
      // The sound stops with the super; only a completed channel plays its release.
      assert.deepEqual(audio.at(-1).stops, [ending === 'complete']);
      // A finished or stunned channel bursts at Draven; teardown and match end don't.
      const burst = ending === 'complete' || ending === 'interrupt';
      assert.equal(transitions.exits.length - exitsBefore, burst ? 1 : 0);
      if (burst) assert.deepEqual({ x: transitions.exits.at(-1).x, y: transitions.exits.at(-1).y }, { x: player.x, y: player.y });
      assert.equal(scene.events.listenerCount('shutdown'), 0);
    }
    assert.equal(transitions.enter, 10);
  });

  test('Inferno impacts show at most one smaller explosion per target per pulse', () => {
    const tuning = require('../src/shared/characters/characterTuning');
    const hits = [];
    const api = load('src/client/game/characters/draven/attack.js', {
      './infernoAudio': { playInfernoHit: (_scene, x) => hits.push(x) },
      '../../../../shared/characters/characterTuning.js': tuning,
      '../../../../shared/projectilePresentation': require('../src/shared/projectilePresentation'),
      '../../scene/renderLayers': { RENDER_LAYERS: { ATTACKS: 40 } },
    });
    const sprites = [];
    const scene = {
      textures: { exists: () => true }, anims: { exists: () => false }, tweens: { add() {} },
      add: { sprite(x, y) {
        const s = { x, y, setDepth: () => s, setScale(v) { s.scale = v; return s; }, setAlpha: () => s, destroy() {} };
        sprites.push(s); return s;
      } },
    };
    const pulse = tuning.getResolvedCharacterSpecialConfig('draven', 'inferno').explosionPulseMs;
    api.spawnInfernoExplosion(scene, 10, 20, null, 'bob', 1000);
    api.spawnInfernoExplosion(scene, 10, 20, null, 'bob', 1000 + pulse - 1);
    api.spawnInfernoExplosion(scene, 90, 20, null, 'amy', 1000 + pulse - 1);
    api.spawnInfernoExplosion(scene, 10, 20, null, 'bob', 1000 + pulse);
    assert.deepEqual(sprites.map(s => s.x), [10, 90, 10]);
    assert.deepEqual(hits, [10, 90, 10], 'each shown explosion sizzles once');
    api.spawnExplosion(scene, 5, 5);
    assert.ok(sprites[0].scale < sprites[3].scale, 'inferno impacts are smaller than splash impacts');
  });

  test('Inferno sound layers stop touching a sound once Phaser destroys it', () => {
    const { EventEmitter } = require('node:events');
    for (const destroyedBy of ['manager', 'complete']) {
      const api = load('src/client/game/characters/draven/infernoAudio.js', {
        '../../audio/playerAudio': { combatSoundVolume: () => 0.2, playerSoundVolume: (_s, _p, v) => v, playPlayerSound() {} },
      });
      // Like Phaser's BaseSound: destroy() nulls the config the volume setter writes to.
      const sounds = [];
      const makeSound = () => {
        const s = Object.assign(new EventEmitter(), { manager: {}, currentConfig: {}, duration: 4,
          play: () => true, setRate() {},
          destroy() { this.emit('destroy'); this.manager = null; this.currentConfig = null; } });
        Object.defineProperty(s, 'volume', { set(v) { this.currentConfig.volume = v; } });
        sounds.push(s);
        return s;
      };
      const tweens = [];
      const scene = { events: new EventEmitter(), sound: { add: makeSound },
        tweens: { add(cfg) { const t = { ...cfg, remove() { t.removed = true; } }; tweens.push(t); return t; } },
        time: { addEvent: () => ({ remove() {} }) } };
      const stop = api.startInfernoAudio(scene, { active: true, x: 0, y: 0 }, { riseMs: 100, durationMs: 5000 });
      assert.ok(sounds.length > 0);
      for (const s of sounds) {
        if (destroyedBy === 'manager') s.destroy();
        else s.emit('complete');
      }
      assert.doesNotThrow(() => {
        scene.events.emit('update');
        for (const t of tweens) t.onUpdate?.();
        stop(true);
        scene.events.emit('shutdown');
      });
    }
  });
});

describe("Ninja collision and playback", () => {
  const { spritePresentation } = require('../src/client/game/characters/shared/spritePresentation');
  const { characterBody } = require('../src/shared/physics/characterBody');

  test('Arena Sovereign plays its own expanded movement and aimed crown clips', () => {
    const { registerSovereignAnimations, sovereignThrowSettings } =
      require('../src/client/game/characters/ninja/sovereignAnimations');
    const { beginThrow, claimThrow } = require('../src/client/game/characters/ninja/throwPresentation');
    const atlas = require('../public/assets/ninja/skins/ninja-arena-sovereign/animations.json');
    const names = new Set(atlas.frames.map(({ filename }) => filename));
    const texture = { key: 'ninja__ninja-arena-sovereign', has: name => names.has(name) };
    const clips = new Map();
    const scene = { anims: {
      exists: key => clips.has(key),
      create: clip => {
        for (const { key, frame } of clip.frames) {
          assert.equal(key, texture.key);
          assert.ok(texture.has(frame), `${clip.key} references missing frame ${frame}`);
        }
        clips.set(clip.key, clip);
      },
    } };
    registerSovereignAnimations(scene, texture);
    const clip = suffix => clips.get(`${texture.key}-${suffix}`);
    assert.ok(clip('running').frames.length > 7);
    assert.equal(clip('running').repeat, -1);
    assert.ok(clip('jumping').frames.length > 9);
    for (const suffix of ['landing', 'dashright', 'dashup', 'dashdiagonal', 'dashdown', 'dashdowndiagonal']) {
      assert.ok(clip(suffix).frames.length > 1);
    }
    for (const suffix of ['', '-high', '-up', '-down', '-low']) {
      assert.ok(clip(`throw${suffix}`));
      assert.ok(clip(`special${suffix}`));
    }
    const sprite = { texture };
    assert.equal(beginThrow(sprite, -Math.PI / 2, 0), 'high');
    const flight = claimThrow(sprite);
    assert.deepEqual(flight.hand, sovereignThrowSettings.hands.high);
    assert.equal(flight.releaseMs, 1000 / clip('throw-high').frameRate);
  });

  test('standard Ninja preserves authoritative standing and ducking collision geometry', () => {
    // The base atlas's cell size, whatever the installed art uses.
    const cell = require('../src/shared/characters').characterPresentation('ninja').hiResArt.sourceSize;
    const presentation = spritePresentation('ninja', { key:'ninja', has:()=>true, get:()=>({width:cell}) });
    const {body,scale,originX,originY} = presentation;
    const original = characterBody('ninja');
    const width = cell-body.widthShrink, height = cell-body.heightShrink;
    const close = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
    close(width*scale,original.width);
    close(height*scale,original.height);
    // Client body centre: origin plus offset (the origin sits under the rig's feet).
    close((cell/2+body.offsetXFromHalf-cell*originX)*scale,original.offsetX);
    close((body.offsetY+height/2-cell*originY)*scale,original.offsetY);
    for(const ratio of [1,0.55]) {
      const duckHeight=height*ratio;
      close((body.offsetY+height-duckHeight+duckHeight-cell*originY)*scale,
        original.offsetY+original.height/2);
    }
  });

});
