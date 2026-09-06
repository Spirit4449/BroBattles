const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const babel=require('@babel/core');
const model=require('../src/shared/huntressProjectile');
const replication=require('../src/shared/huntressReplication');
const {resolveAttackAimContext}=require('../src/characters/shared/attackAim');
const tuning=require('../src/lib/characterTuning');
const {makeRoom}=require('./helpers/botRoom');
const combat=require('../src/server/core/gameRoom/huntressCombat');
const attackCode=babel.transformSync(fs.readFileSync(require.resolve('../src/characters/huntress/attack.js'),'utf8'),{
  babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]],
}).code;
const attackApi={};
vm.runInNewContext(attackCode,{exports:attackApi,require:name=>
  name.includes('characterTuning')?tuning:name.includes('huntressProjectile')?model:
  name.includes('runtimeId')?{createRuntimeId:()=> 'aim'}:
  name.includes('flipLock')?{lockPlayerFlip:()=>()=>{}}:
  name.includes('animationState')?{playSpriteAnimation(){}}:{},
  Phaser:{Physics:{Arcade:{Image:class{}}}}});
const code=babel.transformSync(fs.readFileSync(require.resolve('../src/characters/huntress/network.js'),'utf8'),{
  babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]],
}).code;
function setup(){
  const api={},created=[],sounds=[];let now=0;
  const socket={connected:false};
  vm.runInNewContext(code,{exports:api,require:name=>name.includes('huntressProjectile')?model:name.includes('huntressReplication')?replication:
    name.includes('runtimeId')?{createRuntimeId:()=> 'generated'}:name.includes('renderLayers')?{RENDER_LAYERS:{ATTACKS:10}}:socket,
    performance:{now:()=>now},setInterval:()=>1,clearInterval(){},window:{}});
  function sprite(x,y){const s={active:true,x,y,setPosition(x,y){this.x=x;this.y=y;return this;},setRotation(r){this.rotation=r;return this;},
    setScale(){return this;},setDepth(){return this;},setTint(){return this;},destroy(){this.active=false;}};created.push(s);return s;}
  const scene={events:new EventEmitter(),add:{sprite,circle:sprite},tweens:{add(){}},sound:{play:key=>sounds.push(key)}};
  api.configureHuntressNetwork({huntressCombatVersion:2,epoch:'room',sentMono:0,simMono:0,projectiles:[],terminals:[],collisionGeometry:{colliders:[]}});
  const owner={active:true,x:100,y:100,displayWidth:150,displayHeight:150,flipX:false};
  const frame=time=>{now=time;scene.events.emit('update',time,1000/120);};
  const packet=action=>({playerName:'owner',action:{huntressCombatVersion:2,epoch:'room',sentMono:now,simMono:now,...action}});
  return {api,created,sounds,scene,owner,frame,packet};
}
test('predicted arrow appears on the first render frame after windup without a server response',()=>{
  const {api,created,scene,owner,frame}=setup();
  const request=api.predictHuntressShot(scene,owner,'owner',{id:'shot',type:'huntress-arrow',angle:0,speed:model.resolveShot({angle:0,power:0.5}).speed});
  assert.ok(Math.abs(request.power-0.5)<1e-12);
  frame(99);assert.equal(created.length,0);
  frame(100);assert.equal(created.filter(s=>s.active).length,6); // Three arrows and three trail particles.
  assert.equal(created[2].x,118);assert.equal(created[2].y,124);
  api.resetHuntressNetwork();
});
test('rejection before windup suppresses launch, including a subsequent contradictory release',()=>{
  const {api,created,scene,owner,frame,packet}=setup();
  api.predictHuntressShot(scene,owner,'owner',{id:'shot',angle:0,speed:model.resolveShot({angle:0,power:0.5}).speed});
  api.handleHuntressPacket(scene,packet({type:'huntress-result',requestId:'shot',accepted:false}),{});
  frame(120);assert.equal(created.length,0);
  const projectiles=model.createVolley({x:100,y:100,width:150,height:150},model.resolveShot({angle:0}),'owner:shot',0);
  api.handleHuntressPacket(scene,packet({type:'huntress-projectiles',requestId:'shot',projectiles}),{});
  frame(130);assert.equal(created.length,0);
  api.resetHuntressNetwork();
});
test('remote late launch uses authoritative position and age, bypassing the displayed owner',()=>{
  const {api,created,scene,frame,packet}=setup();
  frame(200);
  const p=model.createVolley({x:100,y:100,width:150,height:150},model.resolveShot({angle:0}),'remote:shot',0)[1];
  api.handleHuntressPacket(scene,packet({type:'huntress-projectiles',requestId:'shot',projectiles:[p]}),{localUsername:'owner'});
  frame(200);
  const expected=model.sample(p,200);
  assert.equal(created[0].x,expected.x);assert.equal(created[0].y,expected.y);
  api.resetHuntressNetwork();
});
test('terminal before the first render frame embeds at the authoritative point and plays effects once',()=>{
  const {api,created,sounds,scene,frame,packet}=setup();
  const impact={type:'huntress-terminal',id:'remote:shot:0',requestId:'shot',reason:'target',target:'owner',x:120,y:140,rotation:1,
    visual:{scale:.22,embedMs:2000,special:false},appliedDamage:1000};
  const ctx={localUsername:'owner',localPlayer:{active:true,x:100,y:100}};
  api.handleHuntressPacket(scene,packet(impact),ctx);api.handleHuntressPacket(scene,packet(impact),ctx);
  frame(16);assert.equal(sounds.length,1);assert.equal(created.length,1);assert.equal(created[0].x,120);
  const p=model.createVolley({x:100,y:100,width:150,height:150},model.resolveShot({angle:0}),'remote:shot',0)[0];
  api.handleHuntressPacket(scene,packet({type:'huntress-projectiles',requestId:'shot',projectiles:[p]}),ctx);
  frame(32);assert.equal(created.length,1);
  api.resetHuntressNetwork();assert.equal(created[0].active,false);
});

test('aim preview, predicted request and authoritative flight agree at the selected target',()=>{
  for (const special of [false,true]) for (const [dx,dy] of [[450,0],[-450,0],[300,-250],[-300,-250],[160,200],[0,-300]]) {
    const {api,scene,owner}=setup();
    const aim=resolveAttackAimContext({character:'huntress',player:owner,family:special?'special':'basic',
      pointerWorldX:owner.x+dx,pointerWorldY:owner.y+dy});
    scene.time={delayedCall(){}};
    const payload=special?{id:'aim',aim}:attackApi.performHuntressArrowSpread({scene,player:owner},aim);
    const request=api.predictHuntressShot(scene,owner,'owner',payload,special);
    const shot=model.resolveShot(special?request.aim:request,special);
    const flight=model.aimAtTarget({x:owner.x,y:owner.y,width:150,height:150},
      {x:aim.targetX,y:aim.targetY},special?0.5:request.power,special,aim.config.trajectorySamples);
    assert.ok(Math.abs(shot.angle-flight.shot.angle)<1e-9);
    assert.ok(Math.abs(shot.speed-flight.shot.speed)<1e-9);
    assert.equal(flight.reachable,true,`${special}: ${dx},${dy}`);
    assert.ok(Math.hypot(aim.endX-aim.targetX,aim.endY-aim.targetY)<0.001);
    const arrows=model.createVolley({x:owner.x,y:owner.y,width:150,height:150},shot,'owner:aim',0);
    for(let i=0;i<aim.throwPreview.points.length;i++) {
      const ms=flight.durationMs*i/(aim.throwPreview.points.length-1);
      const actual=model.sample(flight.projectile,ms), preview=aim.throwPreview.points[i];
      assert.ok(Math.hypot(actual.x-preview.x,actual.y-preview.y)<0.001);
      if(!special) assert.ok(Math.hypot(model.sample(arrows[1],ms).x-preview.x,model.sample(arrows[1],ms).y-preview.y)<0.001);
    }
    // Full-range arrows should feel quick, including upward shots.
    if(dx===450&&dy===0) assert.ok(flight.durationMs<650,`${flight.durationMs}ms`);
    api.resetHuntressNetwork();
  }
});

test('real steep attack payload reaches the reticle on the server and retains full upward speed',t=>{
  for(const [dx,dy] of [[0,-430],[220,-430],[-220,-430]]) {
    const {api,scene,owner}=setup();
    scene.time={delayedCall(){}};
    const aim=resolveAttackAimContext({character:'huntress',player:owner,
      pointerWorldX:owner.x+dx,pointerWorldY:owner.y+dy});
    const payload=attackApi.performHuntressArrowSpread({scene,player:owner},aim);
    const request=api.predictHuntressShot(scene,owner,'owner',payload);
    const f=makeRoom({characters:['huntress','ninja']});
    t.after(()=>f.room.cleanup());
    const p=f.players[0];
    Object.assign(p,{x:owner.x,y:owner.y,isBot:false,connected:true});
    f.room.huntressCombatVersion=2;
    f.room._tickId=0;f.room._simulationMono=0;
    f.room.geometry={...f.room.geometry,colliders:[]};f.players[1].loaded=false;
    assert.equal(f.room.handlePlayerAction(p.participantId,request),true);
    for(let i=0;i<6;i++) {f.room._tickId++;f.room._simulationMono+=model.STEP_MS;combat.tick(f.room);}
    const release=f.events.find(e=>e.type==='game:action'&&e.payload.action.type==='huntress-projectiles').payload.action;
    const arrow=release.projectiles[1];
    const expectedSpeed=model.attackConfig().speed*aim.speedScale;
    assert.ok(Math.abs(Math.hypot(arrow.vx,arrow.vy)-expectedSpeed)<1e-6);
    const flight=model.aimAtTarget({x:owner.x,y:owner.y,width:150,height:150},
      {x:aim.targetX,y:aim.targetY},request.power);
    const actual=model.sample(arrow,flight.durationMs);
    assert.ok(Math.hypot(actual.x-aim.endX,actual.y-aim.endY)<0.001);
    assert.ok(Math.hypot(actual.x-aim.targetX,actual.y-aim.targetY)<0.001);
    if(dx===0) {
      const apex=model.sample(arrow,-arrow.vy/arrow.gravity*1000);
      assert.ok(arrow.y-apex.y>650,'straight-up arrows retain their height');
    }
    api.resetHuntressNetwork();
  }
});

test('unreachable aims display the real flight endpoint rather than a fictitious curve',()=>{
  const flight=model.aimAtTarget({x:0,y:0,width:150,height:150},{x:0,y:-2000},0,false);
  assert.equal(flight.reachable,false);
  assert.ok(Number.isFinite(flight.preview.endY));
  assert.notEqual(flight.preview.endY,-2000);
  assert.deepEqual(flight.preview.points.at(-1),model.sample(flight.projectile,flight.durationMs));
});

test('burning arrows emit flames in flight and smoke at attached impacts, then clean up',()=>{
  const {api,scene,owner,created,frame,packet}=setup();
  api.predictHuntressShot(scene,owner,'owner',{id:'fire',aim:{angle:0}},true);
  frame(230);
  assert.equal(created.filter(s=>s.active).length,24); // Six arrows, two flames and smoke each.
  api.handleHuntressPacket(scene,packet({type:'huntress-terminal',id:'owner:fire:0',requestId:'fire',
    reason:'target',target:'owner',targetOffset:{x:5,y:10},x:105,y:110,rotation:0,
    visual:{special:true,scale:.24,embedMs:2200},appliedDamage:0}),{localUsername:'owner',localPlayer:owner});
  owner.x=200;
  const before=created.length;
  frame(330);
  assert.equal(created[0].x,205);
  assert.ok(created.slice(before).some(s=>s.x===205&&s.y===110),'burn follows the attachment');
  api.resetHuntressNetwork();
  // The one-shot impact glow is independently owned by its finishing tween.
  assert.ok(created.filter(s=>s.active).length<=1);
});

test('normal power spans the original minimum to the previous average speed',()=>{
  assert.ok(Math.abs(model.resolveShot({angle:0,power:0}).speed-459.2)<1e-9);
  assert.equal(model.resolveShot({angle:0,power:1}).speed,900);
  assert.equal(model.resolveShot({angle:-Math.PI/2,power:1}).speed,900);
});
