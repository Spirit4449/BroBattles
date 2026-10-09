const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const loadServerClock=require('./helpers/serverClockModule');
const loadShotPrediction=require('./helpers/shotPredictionModule');
const babel=require('@babel/core');
const model=require('../src/shared/characters/huntressProjectile');
const replication=require('../src/shared/characters/huntressReplication');
const {resolveAttackAimContext}=require('../src/client/game/characters/shared/attackAim');
const tuning=require("../src/shared/characters/characterTuning.js");
const {makeRoom}=require('./helpers/botRoom');
const combat=require('../src/server/core/gameRoom/huntressCombat');
const attackCode=babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/characters/huntress/attack.js'),'utf8'),{
  babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]],
}).code;
const attackApi={};
const playerAudio={};
vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/audio/playerAudio.js'),'utf8'),{
  babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]],
}).code,{exports:playerAudio});
vm.runInNewContext(attackCode,{exports:attackApi,require:name=>name.includes('projectilePresentation')?require('../src/shared/projectilePresentation'):
  name.includes('characterTuning')?tuning:name.includes('huntressProjectile')?model:
  name.includes('playerAudio')?playerAudio:
  name.includes('runtimeId')?{createRuntimeId:()=> 'aim'}:
  name.includes('flipLock')?{lockPlayerFlip:()=>()=>{}}:
  name.includes('animationState')?{playSpriteAnimation(){}}:{},
  Phaser:{Physics:{Arcade:{Image:class{}}}}});
const code=babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/characters/huntress/network.js'),'utf8'),{
  babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]],
}).code;
function setup(colliders=[]){
  const api={},created=[],sounds=[];let now=0;
  const socket={connected:false};
  const serverClock=loadServerClock({performance:{now:()=>now}});
  const shots=loadShotPrediction({serverClock});
  vm.runInNewContext(code,{exports:api,require:name=>name.includes('serverClock')?serverClock:name.includes('shotPrediction')?shots:name.includes('projectilePresentation')?require('../src/shared/projectilePresentation'):name.includes('huntressProjectile')?model:name.includes('huntressReplication')?replication:
    name.includes('platformMotion')?require('../src/shared/maps/platformMotion'):
    name.includes('playerAudio')?playerAudio:
    name.includes('runtimeId')?{createRuntimeId:()=> 'generated'}:name.includes('renderLayers')?{RENDER_LAYERS:{ATTACKS:10}}:socket,
    performance:{now:()=>now},setInterval:()=>1,clearInterval(){},window:{}});
  function sprite(x,y,texture){const s={active:true,x,y,texture,setPosition(x,y){this.x=x;this.y=y;return this;},setRotation(r){this.rotation=r;return this;},
    setScale(){return this;},setDepth(){return this;},setTint(){return this;},destroy(){this.active=false;}};created.push(s);return s;}
  const scene={events:new EventEmitter(),add:{sprite,circle(){throw new Error("Huntress fire must not emit round smoke or halos");},graphics(){const g=sprite(0,0);for(const key of ["setAlpha","fillStyle","fillRect"])g[key]=()=>g;return g;}},tweens:{add(){}},sound:{play:key=>sounds.push(key)}};
  api.configureHuntressNetwork({huntressCombatVersion:2,epoch:'room',sentMono:0,simMono:0,projectiles:[],terminals:[],collisionGeometry:{colliders}});
  const owner={active:true,x:100,y:100,displayWidth:150,displayHeight:150,flipX:false};
  scene._localPlayerAudioSprite=owner;
  const frame=time=>{now=time;scene.events.emit('update',time,1000/120);};
  const tick=time=>{now=time;api.observeHuntressSnapshot({snapshotEpoch:'room',sentMono:time,tMono:time});frame(time);};
  const packet=action=>({playerName:'owner',action:{huntressCombatVersion:2,epoch:'room',sentMono:now,simMono:now,...action}});
  return {api,created,sounds,scene,owner,frame,tick,packet,shots};
}
test('predicted arrow appears on the first render frame after windup without a server response',()=>{
  const {api,created,scene,owner,frame}=setup();
  const request=api.predictHuntressShot(scene,owner,'owner',{id:'shot',type:'huntress-arrow',angle:0,speed:model.resolveShot({angle:0,power:0.5}).speed});
  assert.ok(Math.abs(request.power-0.5)<1e-12);
  frame(99);assert.equal(created.length,0);
  frame(100);assert.equal(created.filter(s=>s.active && s.texture === "huntress-arrow").length,3); // Flame particles do not count as arrows.
  const arrows=created.filter(s=>s.texture === "huntress-arrow");
  assert.ok(arrows.some(s => s.x === 118 && s.y === 124), "central arrow launches from the muzzle");
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
  frame(16);assert.equal(sounds.length,1);assert.equal(created.filter(s=>s.texture === "huntress-arrow").length,1);assert.equal(created[0].x,120);
  const p=model.createVolley({x:100,y:100,width:150,height:150},model.resolveShot({angle:0}),'remote:shot',0)[0];
  api.handleHuntressPacket(scene,packet({type:'huntress-projectiles',requestId:'shot',projectiles:[p]}),ctx);
  frame(32);assert.equal(created.filter(s=>s.texture === "huntress-arrow").length,1);
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

test('burning arrows emit pixel flames in flight and at attached impacts, then clean up',()=>{
  const {api,scene,owner,created,frame,packet}=setup();
  api.predictHuntressShot(scene,owner,'owner',{id:'fire',aim:{angle:0}},true);
  frame(230);
  const arrows=created.filter(s=>s.texture === 'huntress-arrow');
  const flames=created.filter(s=>s.texture !== 'huntress-arrow');
  assert.ok(arrows.length>0 && flames.length>=arrows.length, 'every super arrow is burning');
  api.handleHuntressPacket(scene,packet({type:'huntress-terminal',id:'owner:fire:0',requestId:'fire',
    reason:'target',target:'owner',targetOffset:{x:5,y:10},x:105,y:110,rotation:0,
    visual:{special:true,scale:.24,embedMs:2200},appliedDamage:0}),{localUsername:'owner',localPlayer:owner});
  owner.x=200;
  const before=created.length;
  frame(330);
  assert.equal(created[0].x,205);
  assert.ok(created.slice(before).some(s=>s.x===205&&s.y===110),'burn follows the attachment');
  api.resetHuntressNetwork();
  assert.ok(created.every(s=>!s.active));
});

test('normal arrows emit fire, flames fade and the network renderer detaches on cleanup', () => {
  const {api,created,scene,owner,frame}=setup();
  const tweens=[];
  scene.tweens.add=options=>tweens.push(options);
  api.predictHuntressShot(scene,owner,'owner',{id:'trail',angle:0,speed:model.resolveShot({angle:0}).speed});
  frame(101);
  const trails=tweens.filter(tween=>tween.targets.texture !== "huntress-arrow");
  assert.ok(trails.length>=created.filter(s=>s.texture === "huntress-arrow").length);
  for(const tween of trails){assert.equal(tween.alpha,0);tween.onComplete();assert.equal(tween.targets.active,false);}
  api.resetHuntressNetwork();
  assert.equal(scene.events.listenerCount('update'),0);
  assert.ok(created.every(sprite=>!sprite.active));
});

test('PvP Huntress launches from the displayed moving opponent and converges to server flight',()=>{
  const f=setup();
  const remote={active:true,x:240,y:100,displayWidth:150,displayHeight:150};
  f.api.attachHuntressScene(f.scene,{localUsername:'viewer',opponentPlayersRef:{human:{opponent:remote}}});
  const shot=model.resolveShot({angle:0,power:0.5});
  const projectiles=model.createVolley({...remote,x:300,width:150,height:150},shot,'human:shot',0).map(p=>({...p,ownerName:'human'}));
  f.api.handleHuntressPacket(f.scene,{...f.packet({type:'huntress-projectiles',requestId:'shot',projectiles}),playerName:'human'},{});
  f.frame(0);
  assert.equal(f.created[0].x,projectiles[0].x-60);
  f.frame(100);
  assert.ok(Math.abs(f.created[0].x-model.sample(projectiles[0],100).x)<1e-6);
  f.api.resetHuntressNetwork();
});

// The local shooter sees an enemy drawn at (300, 120); its box straddles the arrow.
function shooterView(f,{owner='owner'}={}){
  const enemy={active:true,visible:true,x:300,y:120,flipX:false};
  const opponentPlayersRef={enemy:{opponent:enemy,character:'ninja'}};
  f.shots.trackShotTargets({localUsername:'owner',opponentPlayersRef});
  f.api.attachHuntressScene(f.scene,{localUsername:'owner',localPlayer:f.owner,opponentPlayersRef});
  const p=model.createVolley({x:100,y:100,width:150,height:150},model.resolveShot({angle:0,power:.5}),`${owner}:shot`,0)[1];
  p.ownerName=owner;
  f.api.handleHuntressPacket(f.scene,{...f.packet({type:'huntress-projectiles',requestId:'shot',projectiles:[p]}),playerName:owner},{});
  const arrow=()=>f.created.find(s=>s.texture==='huntress-arrow');
  const terminal=(action)=>f.api.handleHuntressPacket(f.scene,{...f.packet({type:'huntress-terminal',id:p.id,requestId:'shot',
    rotation:0,visual:{scale:.22,embedMs:2000,special:false},...action}),playerName:owner},{});
  return {enemy,p,arrow,terminal,box:model.insetBounds(require('../src/shared/combat/shotContact').characterHitBounds('ninja',300,120))};
}
test('owner arrows stick into the enemy as drawn and stay put when the server confirms',()=>{
  const f=setup(),{enemy,arrow,terminal,box}=shooterView(f);
  for(let t=0;t<=400;t+=16){f.tick(t);assert.ok(arrow().x<=box.left+1e-6,`arrow passed into the body at ${t}ms`);}
  assert.ok(Math.abs(arrow().x-box.left)<1e-6,'arrow rests on the body as drawn');
  const stuck={x:arrow().x-enemy.x,y:arrow().y-enemy.y};
  enemy.x+=50;f.tick(416);
  assert.ok(Math.abs(arrow().x-(enemy.x+stuck.x))<1e-6,'arrow rides the displayed enemy');
  // The server's own attachment differs slightly; the drawn arrow does not jump to it.
  terminal({reason:'target',target:'enemy',x:280,y:150,targetOffset:{x:-25,y:30},appliedDamage:850});
  for(const t of [432,800,1500]){f.tick(t);assert.ok(Math.abs(arrow().x-(enemy.x+stuck.x))<1e-6);assert.equal(arrow().active,true);}
  f.api.resetHuntressNetwork();
});

test('an unconfirmed predicted hit fades in place instead of flying on or jumping',()=>{
  const f=setup(),{arrow,terminal,box}=shooterView(f);
  const shown=arrow;
  let t=0;for(;t<=400;t+=16)f.tick(t);
  const at={x:shown().x,y:shown().y};
  // No confirmation within the window (one round trip plus margin).
  const window=f.shots.confirmWindowMs();
  for(;t<=400+window+200;t+=16){
    f.tick(t);
    const live=f.created.filter(s=>s.texture==='huntress-arrow'&&s.active);
    for(const s of live)assert.ok(Math.abs(s.x-at.x)<1e-6&&Math.abs(s.y-at.y)<1e-6,`moved while withdrawn at ${t}ms`);
  }
  assert.equal(f.created.filter(s=>s.texture==='huntress-arrow'&&s.active).length,0,'withdrawn');
  // The server's arrow flew on and later struck a wall: that is drawn where it happened.
  terminal({reason:'terrain',x:900,y:400});f.tick(t);
  const embedded=f.created.filter(s=>s.texture==='huntress-arrow'&&s.active);
  assert.equal(embedded.length,1);assert.equal(embedded[0].x,900);
  assert.ok(box.left<900);
  f.api.resetHuntressNetwork();
});

test('a predicted hit the server resolves differently fades without moving',()=>{
  const f=setup(),{arrow,terminal}=shooterView(f);
  let t=0;for(;t<=320;t+=16)f.tick(t);
  const at={x:arrow().x,y:arrow().y},sprite=arrow();
  terminal({reason:'terrain',x:640,y:200});
  for(;t<=600;t+=16){f.tick(t);if(sprite.active)assert.ok(sprite.x===at.x&&sprite.y===at.y);}
  assert.equal(sprite.active,false);
  f.api.resetHuntressNetwork();
});

test('other players\' arrows are never stopped by bodies on this screen',()=>{
  const f=setup(),{p,arrow}=shooterView(f,{owner:'remote'});
  for(const t of [0,100,200,300,400]){
    f.tick(t);const expected=model.sample(p,t);
    assert.ok(Math.abs(arrow().x-expected.x)<1e-6);assert.ok(Math.abs(arrow().y-expected.y)<1e-6);
  }
  f.api.resetHuntressNetwork();
});

test('owner arrows keep moving forward at full speed when the later server launch confirms them',()=>{
  const f=setup();
  const shot=model.resolveShot({angle:0,power:.5});
  f.api.predictHuntressShot(f.scene,f.owner,'owner',{id:'shot',type:'huntress-arrow',angle:0,speed:shot.speed});
  // The server receives the request one upstream trip (80 ms) later.
  const projectiles=model.createVolley({x:100,y:100,width:150,height:150},shot,'owner:shot',180).map(p=>({...p,ownerName:'owner'}));
  const arrow=()=>f.created.find(s=>s.texture==='huntress-arrow');
  let last=null;
  for(let t=100;t<=500;t+=16){
    if(t===260)f.api.handleHuntressPacket(f.scene,f.packet({type:'huntress-projectiles',requestId:'shot',projectiles}),{});
    f.tick(t);
    const x=arrow().x;
    if(last!==null)assert.ok(x-last>shot.speed*0.016*0.9,`arrow slowed at ${t}ms: ${x-last}px`);
    last=x;
  }
  f.api.resetHuntressNetwork();
});

test('arrows stop at terrain before the server terminal arrives and stay there once it does',()=>{
  const wall={id:'wall',left:400,right:460,top:0,bottom:400};
  const f=setup([wall]);
  const shot=model.resolveShot({angle:0,power:.5});
  const p=model.createVolley({x:100,y:100,width:150,height:150},shot,'remote:shot',0)[1];p.ownerName='remote';
  f.api.handleHuntressPacket(f.scene,{...f.packet({type:'huntress-projectiles',requestId:'shot',projectiles:[p]}),playerName:'remote'},{localUsername:'owner'});
  const arrow=()=>f.created.find(s=>s.texture==='huntress-arrow');
  for(let t=0;t<=600;t+=16){f.tick(t);assert.ok(arrow().x<=wall.left+1e-6,`arrow entered the wall at ${t}ms`);}
  assert.ok(Math.abs(arrow().x-wall.left)<1e-6,'arrow rests on the wall face');
  const contact={x:arrow().x,y:arrow().y};
  f.api.handleHuntressPacket(f.scene,{...f.packet({type:'huntress-terminal',id:p.id,requestId:'shot',reason:'terrain',
    x:contact.x,y:contact.y,rotation:0,visual:{scale:.22,embedMs:2000,special:false}}),playerName:'remote'},{localUsername:'owner'});
  f.tick(616);
  assert.ok(Math.abs(arrow().x-contact.x)<1e-6);
  f.api.resetHuntressNetwork();
});
