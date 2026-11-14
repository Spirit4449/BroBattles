const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

describe("Draven confirmed impacts", () => {
  function load(file, deps, globals = {}) {
    const exports = {};
    const code = babel.transformSync(fs.readFileSync(file,'utf8'), {babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code;
    vm.runInNewContext(code,{exports,require:name=>deps[name] || {}, ...globals});
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
    const api = load('src/client/game/characters/draven/special.js', {
      '../../../../shared/characters/characterTuning.js': tuning,
      '../../../../shared/projectilePresentation': require('../src/shared/projectilePresentation'),
      '../shared/runtimeId': { createRuntimeId: () => 'inferno' },
      '../shared/flipLock': { lockPlayerFlip: () => () => {} },
      '../shared/animationState.js': { markOneShotAnimation() {}, playSpriteAnimation() {}, resolveSpriteAnimationKey() {} },
      '../../scene/renderLayers': { RENDER_LAYERS: { PLAYER: 30 } },
      '../../powerups/shieldBubble': load('src/client/game/powerups/shieldBubble.js', {
        './pixelShapes': load('src/client/game/powerups/pixelShapes.js', {}),
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
      api.perform(scene, player, [], [], 'draven', 1, isOwner);
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
      assert.equal(scene.events.listenerCount('shutdown'), 0);
    }
  });
});

describe("Ninja collision and playback", () => {
  const { spritePresentation } = require('../src/client/game/characters/shared/spritePresentation');
  const { characterBody } = require('../src/shared/physics/duelGeometry');

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
