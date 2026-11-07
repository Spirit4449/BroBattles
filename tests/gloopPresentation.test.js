const { loadClientModule } = require('./helpers/clientModule');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe("Slime presentation", () => {
  const { EventEmitter } = require('node:events');

  const api = {};

  const transformModule=file=>{
    const exports={};
    loadClientModule(file, {exports});
    return exports;
  };
  const pixelShapes=transformModule('src/client/game/powerups/pixelShapes.js');
  loadClientModule('src/client/game/characters/gloop/slimeVisual.js', {exports:api,require:name=>name.includes('pixelShapes') ? pixelShapes : name.includes('projectilePresentation') ? require('../src/shared/projectilePresentation') : name.includes('renderLayers')
    ? {RENDER_LAYERS:{ATTACKS:20}} : require('../src/shared/characters/gloopProjectile')});
  function setup(owner) {
    const objects=[];
    const scene={add:{graphics(){
      const g=Object.assign(new EventEmitter(),{colors:[],lines:[],destroyed:false,
        fillStyle(c){this.colors.push(c);return this;},
        lineTo(x,y){assert.ok(Number.isFinite(x)&&Number.isFinite(y));this.lines.push([x,y]);return this;},
        clear(){this.colors=[];this.lines=[];return this;},
        destroy(){
          assert.equal(this.destroying,undefined,'graphics destruction must not reenter');
          if(this.destroyed)return;
          this.destroying=true;
          this.emit('destroy');
          this.destroyed=true;
          this.destroying=undefined;
        },
      });
      g.setPosition=(x,y)=>{g.x=x;g.y=y;return g;};
      for(const name of ['setDepth','setVisible','beginPath','moveTo','closePath','fillPath','lineStyle','fillEllipse','lineBetween','strokeCircle','arc','strokePath','setScale','setRotation','setStrokeStyle','fillRect']) g[name]=()=>g;
      objects.push(g);return g;
    }}};
    const state={x:100,y:100,vx:200,vy:20,collisionRadius:28,floorY:500};
    const visual=api.createSlimeVisual(scene,state,1.5,owner);
    return {visual,objects,state,scene};
  }

  test('crystal goo survives rebound, deposits crystal residue and cleans up',()=>{
    const {visual,objects,state}=setup({_bbSkinTextureKey:'gloop__gloop-amethyst'});
    visual.impact({x:100,y:128,nx:0,ny:-1,speed:200,terminal:false});
    state.contactHold={remaining:50,duration:100,speed:200};
    assert.equal(visual.update(16),true);
    assert.ok(objects[1].colors.includes(0x3150b5));
    visual.finish({onCharacter:true});
    assert.equal(objects[0].colors.length,0);
    for(let i=0;i<50;i++)visual.update(100);
    assert.equal(visual.update(100),false);
    visual.destroy();assert.ok(objects.every(g=>g.destroyed));
  });

  test('a slimeball that bounces off a ledge falls with its physics instead of hovering at the ledge height',()=>{
    const {visual,objects,state}=setup({texture:{key:'gloop'}});
    state.vx=0;state.vy=0;state.y=100;
    visual.impact({x:100,y:128,nx:0,ny:-1,speed:300,terminal:false});
    state.contactHold={remaining:100,duration:100,speed:300};
    for(let t=0;t<100;t+=16){state.contactHold.remaining-=16;visual.update(16);}
    state.contactHold=null;
    // Rolled off the platform's edge: the ball drops well below its top.
    state.vx=120;state.vy=400;
    for(let i=0;i<30;i++){state.x+=2;state.y+=6.4;visual.update(16);}
    assert.ok(Math.abs(objects[0].y-state.y)<=4,`body at ${objects[0].y} trails the ball at ${state.y}`);
    visual.destroy();
  });

  test('slimeball graphics can be destroyed by Phaser without recursive destruction',()=>{
    const attackApi={};

    loadClientModule('src/client/game/characters/gloop/attack.js', {exports:attackApi,require:name=>{
      if(name.includes('slimeVisual'))return {createSlimeVisual:api.createSlimeVisual};
      if(name.includes('gloopProjectile'))return require('../src/shared/characters/gloopProjectile');
      if(name.includes('characterTuning'))return {getResolvedCharacterAttackConfig:()=>({collisionRadius:28,visualScale:1.5})};
      if(name.includes('renderLayers'))return {RENDER_LAYERS:{ATTACKS:20}};
      return {};
    }});
    for(const trigger of ['body','shutdown']){
      const {scene,objects}=setup();
      scene.events=new EventEmitter();
      scene.add.circle=()=>scene.add.graphics();
      scene.physics={world:{bounds:{x:0,y:0,width:2300,height:1000}}};
      const body=attackApi.spawnGloopSlimeballVisual(scene,{id:'test',start:{x:100,y:100}});
      assert.ok(body);
      if(trigger==='body')body.destroy();
      else scene.events.emit('shutdown');
      assert.ok(objects.slice(2).every(object=>object.destroyed));
      assert.equal(scene.events.listenerCount('update'),0);
      assert.equal(scene.events.listenerCount('postupdate'),0);
    }
  });

});

describe("Hook presentation", () => {
  const { EventEmitter } = require('node:events');

  const animationApi = {};
  loadClientModule('src/client/game/characters/gloop/handAnimation.js', { exports: animationApi });
  const loadServerClock = require('./helpers/serverClockModule');
  const loadShotPrediction = require('./helpers/shotPredictionModule');
  const packetDedupe = {};
  loadClientModule('src/client/game/characters/shared/packetDedupe.js', { exports: packetDedupe, Date });
  const playerAudio = {};
  loadClientModule('src/client/game/audio/playerAudio.js', { exports: playerAudio });
  function setup(animated = false) {
    const api = {}, objects = [], sounds = [];
    function object(x = 0, y = 0) {
      const o = new EventEmitter();
      Object.assign(o, { x, y, active: true, rects: [],
        setOrigin() { return this; },
        setDepth(depth) { this.depth = depth; return this; },
        setFrame(frame) { this.frame = frame; return this; },
        setVisible(visible) { this.visible = visible; return this; },
        setRotation(rotation) { this.rotation = rotation; return this; },
        fillStyle(color) { this.color = color; return this; },
        fillRect(x, y, w, h) { this.rects.push({ x, y, w, h, color: this.color }); return this; },
        setPosition(x, y) { this.x = x; this.y = y; return this; },
        setScale(x, y) { this.scaleX = x; this.scaleY = y; return this; },
        setTexture(key) { this.texture = key; return this; },
        clear() { this.rects = []; return this; },
        destroy() { this.active = false; this.emit('destroy'); },
      });
      for (const method of ['beginPath', 'closePath', 'fillPath', 'lineStyle', 'strokePath', 'lineBetween', 'fillEllipse']) o[method] = () => o;
      objects.push(o); return o;
    }
    const shots = loadShotPrediction({ serverClock: loadServerClock({ performance: { now: () => 0 } }) });
    const scene = { events: new EventEmitter(), textures: { exists: () => true },
      add: { sprite: object, graphics: object }, sound: { play: key => sounds.push(key) } };
    const owner = object(100, 200); owner.setDepth(10); owner.displayWidth = 80; owner.displayHeight = 100;
    scene._localPlayerAudioSprite = owner;
    loadClientModule('src/client/game/characters/gloop/special.js', { exports: api, require: name => name.includes('handAnimation') ? { ...animationApi, prepareHandAnimation: () => animated } : name.includes('characterTuning')
      ? { getResolvedCharacterSpecialConfig: () => ({ visualScale: 0.28, range: 500, speed: 1000,
        collisionRadius: 44, collisionForwardOffset: 28, collisionOffsetY: 50 }) }
      : name.includes('shotPrediction') ? shots
      : name.includes('shotContact') ? require('../src/shared/combat/shotContact')
      : name.includes('packetDedupe') ? packetDedupe
      : name.includes('runtimeId') ? { createRuntimeId: prefix => `${prefix}-1` }
      : name.includes('gloopHookGeometry') ? require('../src/shared/characters/gloopHookGeometry.js')
      : name.includes('playerAudio') ? playerAudio
      : name.includes('renderLayers') ? { RENDER_LAYERS: { PLAYER: 10, ATTACKS: 20 } } : { playSpriteAnimation() {} } });
    const launch = () => api.playHookAction(scene, owner, { id: 'hook1', start: { x: 120, y: 180 }, angle: 0, range: 500, speed: 1000 }, true);
    const frame = (ms = 50) => scene.events.emit('update', 0, ms);
    return { api, scene, owner, objects, sounds, launch, frame, shots };
  }

  test('catch closes at contact, uses pull duration and rejects stale/duplicate packets', () => {
    const f = setup(); f.launch(); f.frame();
    const catchData = { id: 'hook1', start: { x: 300, y: 180 }, end: { x: 150, y: 180 }, pullDurationMs: 200 };
    f.api.playHookCatchAction(f.scene, f.owner, { ...catchData, id: 'old' });
    assert.equal(f.objects[1].x, 170);
    f.api.playHookCatchAction(f.scene, f.owner, catchData);
    assert.equal(f.objects[1].texture, 'gloop-hand-closed');
    assert.equal(f.objects[1].x, 300);
    f.api.playHookCatchAction(f.scene, f.owner, catchData);
    assert.equal(f.sounds.filter(s => s === 'gloop-pull').length, 1);
    for (let i = 0; i < 4; i++) f.frame();
    assert.equal(f.objects[1].x, 150);
    for (let i = 0; i < 12; i++) f.frame();
    assert.equal(f.scene.events.listenerCount('update'), 0);
  });
  test('duplicate launch, recast, owner destruction and shutdown clean up visuals', () => {
    const f = setup(); f.launch(); f.launch();
    assert.equal(f.scene.events.listenerCount('update'), 1);
    assert.equal(f.sounds.length, 1);
    f.api.playHookAction(f.scene, f.owner, { id: 'hook2', angle: 0 });
    assert.equal(f.objects[1].active, false);
    assert.equal(f.scene.events.listenerCount('update'), 1);
    f.owner.destroy();
    assert.equal(f.scene.events.listenerCount('update'), 0);
    assert.equal(f.scene.events.listenerCount('shutdown'), 0);
    const g = setup(); g.launch(); g.scene.events.emit('shutdown');
    assert.ok(g.objects.slice(1).every(o => !o.active));
  });

  test('caught hand stays attached to the rendered victim as the pull destination moves', () => {
    const f = setup(); f.launch();
    const victim = { active: true, username: 'victim', x: 300, y: 180 };
    f.scene.children = { list: [victim] };
    f.api.playHookCatchAction(f.scene, f.owner, { id: 'hook1', target: 'victim',
      start: { x: 300, y: 180 }, end: { x: 150, y: 180 }, pullDurationMs: 200 });
    victim.x = 230; victim.y = 165; f.frame();
    assert.equal(f.objects[1].x, 230); assert.equal(f.objects[1].y, 165);
    victim.x = 185; f.frame(); assert.equal(f.objects[1].x, 185);
  });

  // The caster sees an enemy drawn with its body straddling the hook's damage line.
  function casterView(f) {
    const enemy = { active: true, visible: true, flipX: false, username: 'foe', x: 330, y: 247.75 };
    f.shots.trackShotTargets({ localUsername: 'me', opponentPlayersRef: { foe: { opponent: enemy, character: 'ninja' } } });
    f.scene.children = { list: [enemy] };
    const request = f.api.predictGloopHook(f.scene, f.owner, 'me', { aim: { angle: 0, direction: 1 } });
    return { enemy, request, hand: f.objects[1] };
  }

  test('the caster\'s hook leaves on press under its request id; the echo of that id is skipped', () => {
    const f = setup(), { request, hand } = casterView(f);
    assert.equal(request.id, 'gloopHook-1');
    assert.equal(f.api.consumeGloopHook(f.scene, request.id), false);
    f.frame(50);
    assert.ok(hand.x > 108.4, 'flying before any server packet');
  });

  test('the caster\'s hook latches onto the enemy as drawn and a confirmed catch closes without a jump', () => {
    const f = setup(), { enemy, request, hand } = casterView(f);
    for (let i = 0; i < 4; i++) f.frame(50);
    const latched = { x: hand.x - enemy.x, y: hand.y - enemy.y };
    assert.ok(hand.x < 330 && hand.x > 200, `held at ${hand.x}`);
    enemy.x += 40; f.frame(50);
    assert.equal(hand.x, enemy.x + latched.x, 'rides the drawn enemy');
    const before = { x: hand.x, y: hand.y };
    f.api.playHookCatchAction(f.scene, f.owner, { id: request.id, target: 'foe', start: { x: 300, y: 250 },
      end: { x: 120, y: 200 }, pullDurationMs: 300 });
    assert.deepEqual({ x: hand.x, y: hand.y }, before);
    assert.equal(f.sounds.filter(s => s === 'gloop-pull').length, 1);
  });

  test('an unconfirmed latch lets go after a round trip instead of holding forever', () => {
    const f = setup(), { hand } = casterView(f);
    for (let i = 0; i < 4; i++) f.frame(50);
    const held = hand.x;
    for (let elapsed = 0; elapsed <= f.shots.confirmWindowMs() + 50; elapsed += 50) f.frame(50);
    assert.equal(hand.visible, false);
    assert.equal(hand.x, held, 'released where it was held');
  });

  test('hooks launched by others are never latched by bodies on this screen', () => {
    const f = setup(), { enemy } = casterView(f);
    f.api.playHookAction(f.scene, f.owner, { id: 'remote', start: { x: 120, y: 180 }, angle: 0, range: 500, speed: 1000 }, false);
    const hand = f.objects.at(-3);
    for (let i = 0; i < 6; i++) f.frame(50);
    assert.ok(hand.x > enemy.x, `passed the drawn enemy to ${hand.x}`);
  });
});
