const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),babel=require('@babel/core');
const {EventEmitter}=require('node:events');
const loadServerClock=require('./helpers/serverClockModule');
const loadShotPrediction=require('./helpers/shotPredictionModule');
const model=require('../src/shared/characters/ninjaProjectile'),clock=require('../src/shared/characters/huntressReplication');
const code=babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/characters/ninja/network'),'utf8'),{babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code;
const playerAudio={};
vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/audio/playerAudio.js'),'utf8'),{babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code,{exports:playerAudio});
const projectileTexture={};
vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/characters/ninja/projectileTexture'),'utf8'),{babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code,{exports:projectileTexture,require:()=>require('../src/shared/projectilePresentation')});
function setup(initial={}){
  let now=0;const api={},images=[],sounds=[],ammo=[],releases=[],animation={};
  const flipLock={},timers=[];
  vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/characters/shared/flipLock'),'utf8'),{babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code,{exports:flipLock});
  vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/characters/shared/animationState'),'utf8'),{babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code,{exports:animation,performance:{now:()=>now}});
  const serverClock=loadServerClock({performance:{now:()=>now}});
  const shots=loadShotPrediction({serverClock});
  vm.runInNewContext(code,{exports:api,require:name=>name.includes('serverClock')?serverClock:name.includes('shotPrediction')?shots:name.includes('projectilePresentation')?require('../src/shared/projectilePresentation'):name.includes('playerAudio')?playerAudio:name.includes('animationState')?animation:name==='./swarmPresentation'?{presentSwarmRelease:(scene,player,ms,remote)=>releases.push({player,ms,remote})}:name==='./projectileTexture'?projectileTexture:name==='./throwPresentation'?require('../src/client/game/characters/ninja/throwPresentation'):name==='./effects'?{createShurikenEffects:()=>({update(){},destroy(){}})}:name.includes('ninjaProjectile')?model:name.includes('platformMotion')?require('../src/shared/maps/platformMotion'):name.includes('huntressReplication')?clock:name.includes('runtimeId')?{createRuntimeId:()=> 'request'}:name.includes('renderLayers')?{RENDER_LAYERS:{ATTACKS:20}}:name.includes('flipLock')?flipLock:{connected:false},
    performance:{now:()=>now},setInterval:()=>1,clearInterval(){}});
  const sprite=(x,y,texture)=>{const s={x,y,texture,active:true,setPosition(x,y){this.x=x;this.y=y;return this;},setScale(){return this;},setDepth(){return this;},setTint(){return this;},setVisible(v){this.visible=v;},setRotation(){},destroy(){this.active=false;}};images.push(s);return s;};
  const flashes=[];
  const scene={events:new EventEmitter(),add:{image:sprite,circle:(x,y)=>{const c={x,y,setDepth(){return c;},destroy(){}};flashes.push(c);return c;}},tweens:{add(){}},sound:{play:key=>sounds.push(key)}};
  const owner={active:true,x:100,y:200,flipX:false};
  scene._localPlayerAudioSprite=owner;
  api.configureNinjaNetwork({ninjaCombatVersion:1,epoch:'room',sentMono:0,simMono:0,colliders:[],active:[],terminals:[],...initial});
  api.attachNinjaScene(scene,{localUsername:'owner',localPlayer:owner,onAmmo:a=>ammo.push(a)});
  const frame=t=>{now=t;api.observeNinjaSnapshot({snapshotEpoch:'room',sentMono:t,tMono:t});scene.events.emit('update');};
  const packet=(a,name='owner')=>api.handleNinjaPacket(scene,{playerName:name,action:{ninjaCombatVersion:1,epoch:'room',simMono:now,sentMono:now,...a}},{localUsername:'owner',localPlayer:owner});
  scene.time={delayedCall:(ms,fn)=>timers.push({ms,fn})};
  return {api,scene,owner,frame,packet,images,sounds,ammo,releases,animation,shots,flashes,flipLock,timers};
}
test('local launch is immediate and matches authoritative launch/reticle geometry',()=>{
  const f=setup();const aim=require('../src/client/game/characters/shared/attackAim').resolveAttackAimContext({character:'ninja',player:f.owner,pointerWorldX:500,pointerWorldY:50});
  const request=f.api.predictNinja(f.scene,f.owner,'owner',{id:'shot',angle:aim.angle});f.frame(0);
  const q=model.launch(f.owner,request.angle,'owner:shot:0');q.ownerName='owner';
  assert.equal(f.images[0].x,q.x);assert.equal(f.images[0].y,q.y);
  assert.equal(aim.kind,'line');
  assert.equal(aim.throwPreview,null);
  assert.equal(aim.anchorX,q.x);
  assert.ok(Math.abs((aim.endX-aim.anchorX)*Math.sin(aim.angle)-(aim.endY-aim.anchorY)*Math.cos(aim.angle))<1e-9);
  f.packet({type:'ninja-launch',projectile:q,requestId:'shot'});f.frame(100);
  assert.equal(f.images.filter(s=>s.active&&s===f.images[0]).length,1);
  f.api.resetNinjaNetwork();assert.ok(f.images.every(s=>!s.active));
});
test('late launch advances to simulation age, independent of displayed shooter position',()=>{
  const f=setup();f.owner.x=900;f.frame(150);
  const q=model.launch({x:100,y:200},0,'owner:late:0');q.ownerName='owner';
  f.packet({type:'ninja-launch',projectile:q,simMono:0,sentMono:0});f.frame(150);
  const expected=structuredClone(q);for(let i=0;i<9;i++)model.step(expected,f.owner,[]);
  assert.ok(Math.abs(f.images[0].x-expected.x)<1e-6);f.api.resetNinjaNetwork();
});
test('rejections cancel every predicted super shard and late launches cannot resurrect them',()=>{
  const f=setup();f.api.predictNinja(f.scene,f.owner,'owner',{id:'super',aim:{angle:0}},true);f.frame(0);
  f.packet({type:'ninja-result',requestId:'super',accepted:false,revision:1,ammoState:{charges:1,capacity:1,reloadMs:1000,nextFireInMs:0}});
  const q=model.launch(f.owner,0,'owner:super:0',0);f.packet({type:'ninja-launch',projectile:q});f.frame(600);
  assert.ok(f.images.every(s=>!s.active));f.api.resetNinjaNetwork();
});
test('terminal-before-launch, reconnect and duplicate impacts are idempotent',()=>{
  const f=setup({terminals:[{id:'owner:old:0'}]});
  f.packet({type:'ninja-terminal',id:'owner:shot:0',revision:1,ammoState:{charges:1,capacity:1,reloadMs:1000,nextFireInMs:0}});
  for(const id of ['owner:old:0','owner:shot:0'])f.packet({type:'ninja-launch',projectile:model.launch(f.owner,0,id)});
  const hit={type:'ninja-impact',id:'owner:shot:0',phase:'outward',target:'target',appliedDamage:100};f.packet(hit);f.packet(hit);f.frame(100);
  assert.equal(f.images.length,0);assert.equal(f.sounds.length,1);assert.equal(f.ammo.length,1);f.api.resetNinjaNetwork();
});
test('server return correction revives a provisionally caught visual until terminal',()=>{
  const f=setup();const q=model.launch(f.owner,0,'owner:return:0');q.ownerName='owner';q.phase='return';q.x=110;
  f.packet({type:'ninja-launch',projectile:q});f.frame(20);assert.equal(f.images[0].visible,false);
  f.packet({type:'ninja-state',id:q.id,state:{x:400,y:200,phase:'return',elapsed:100,currentReturnSpeed:100}});f.frame(40);
  assert.equal(f.images[0].visible,true);
  f.packet({type:'ninja-terminal',id:q.id});assert.equal(f.images[0].active,false);f.api.resetNinjaNetwork();
});

test('super presents each release once, without replaying on authoritative confirmation',()=>{
  const f=setup(),cfg=model.swarmConfig();
  f.api.predictNinja(f.scene,f.owner,'owner',{id:'burst',aim:{angle:0}},true);
  for(let i=0;i<cfg.count;i++){
    f.frame(i*cfg.releaseMs);
    const q=model.launch(f.owner,0,`owner:burst:${i}`,i);q.ownerName='owner';
    f.packet({type:'ninja-launch',projectile:q});
    f.frame(i*cfg.releaseMs);
  }
  assert.equal(f.releases.length,cfg.count);
  assert.ok(f.releases.every(r=>r.player===f.owner&&r.ms===cfg.releaseMs&&!r.remote));
  f.api.resetNinjaNetwork();
});

for (const rtt of [10, 50, 150, 250, 350]) test(`PvP owner confirmation preserves outbound direction at steady ${rtt} ms RTT`, () => {
  const f=setup();
  f.api.predictNinja(f.scene,f.owner,'owner',{id:'shot',angle:0}); f.frame(0);
  for(let t=10;t<=rtt;t+=10) f.frame(t);
  const q=model.launch(f.owner,0,'owner:shot:0'); q.ownerName='owner';
  f.packet({type:'ninja-launch',projectile:q,simMono:rtt/2,sentMono:rtt/2});
  let previous=f.images[0].x;
  // Owners keep their prediction lead, so stop before the predicted turn.
  const turn=model.config().outwardDuration+model.config().hoverDurationMs;
  for(let t=rtt;t<=Math.min(rtt+150,turn);t+=10){
    f.frame(t);assert.ok(f.images[0].x>=previous-1e-8, `backward at ${t}`);previous=f.images[0].x;
  }
  // A genuine server turn must still be allowed to return toward the owner.
  f.packet({type:'ninja-state',id:q.id,state:{x:500,y:200,phase:'return',elapsed:600,currentReturnSpeed:500}});
  f.frame(rtt+200);const before=f.images[0].x;f.frame(rtt+300);
  assert.ok(f.images[0].x<before);
  f.api.resetNinjaNetwork();
});

test('PvP remote attack survives intervening movement snapshots, expires, and can repeat',()=>{
  const f=setup();
  const remote={x:300,y:200,active:true,texture:{key:'ninja__skin'},anims:{
    currentAnim:{key:'ninja__skin-running'},play(key){this.currentAnim={key};this.isPlaying=true;}}};
  f.scene.anims={exists:()=>true,get:()=>({frames:[{},{},{},{}],frameRate:15})};
  const wrapper={opponent:remote};
  f.api.attachNinjaScene(f.scene,{opponentPlayersRef:{human:wrapper}});
  const q=model.launch(remote,0,'human:attack:0');q.ownerName='human';
  f.packet({type:'ninja-launch',projectile:q},'human');
  assert.equal(remote.anims.currentAnim.key,'ninja__skin-throw');
  const renderMovement=t=>{
    f.frame(t);
    if(t>=f.animation.remoteAnimationLockUntil(remote,wrapper))
      f.animation.playCharacterAnimation({scene:f.scene,sprite:remote,character:'ninja',logical:'running',resolveAnimKey:()=> 'ninja__skin-running'});
  };
  for(const t of [17,100,250]){renderMovement(t);assert.equal(remote.anims.currentAnim.key,'ninja__skin-throw');}
  renderMovement(320);assert.equal(remote.anims.currentAnim.key,'ninja__skin-running');
  const next=model.launch(remote,0,'human:second:0');next.ownerName='human';
  f.packet({type:'ninja-launch',projectile:next},'human');renderMovement(340);
  assert.equal(remote.anims.currentAnim.key,'ninja__skin-throw');
  f.api.resetNinjaNetwork();
});

test('remote return uses authoritative owner position despite buffered actor movement',()=>{
  const f=setup(),remote={x:850,y:600,active:true};
  f.api.attachNinjaScene(f.scene,{opponentPlayersRef:{remote:{opponent:remote}}});
  const q=model.launch({x:100,y:200},0,'remote:return:0');q.ownerName='remote';
  Object.assign(q,{x:500,y:200,phase:'return',elapsed:700,currentReturnSpeed:300});
  f.packet({type:'ninja-launch',projectile:q},'remote');f.frame(0);f.frame(100);
  const expected=structuredClone(q);for(let i=0;i<6;i++)model.step(expected,q.returnTarget,[]);
  assert.ok(Math.abs(f.images[0].x-expected.x)<1e-6);assert.equal(f.images[0].y,200);
  f.api.resetNinjaNetwork();
});

test('two remote clients converge despite asymmetric launch delay and duplicate delivery',()=>{
  const clients=[setup(),setup()];
  const q=model.launch({x:100,y:200},0,'remote:delayed:0');q.ownerName='remote';
  for(let i=0;i<2;i++) {
    const f=clients[i];f.api.attachNinjaScene(f.scene,{opponentPlayersRef:{remote:{opponent:{active:true,x:700+i*100,y:450}}}});
    f.frame(i?310:40);f.packet({type:'ninja-launch',projectile:q,simMono:0,sentMono:0},'remote');f.frame(i?310:40);
    f.packet({type:'ninja-launch',projectile:q,simMono:0,sentMono:0},'remote');f.frame(400);
  }
  assert.ok(Math.abs(clients[0].images[0].x-clients[1].images[0].x)<1e-6);
  assert.ok(Math.abs(clients[0].images[0].y-clients[1].images[0].y)<1e-6);
  clients.forEach(f=>f.api.resetNinjaNetwork());
});

test('dedicated Ninja special continues across releases without accelerating normal attacks',()=>{
  const api={},plays=[],locks=[];
  const source=babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/characters/ninja/swarmPresentation'),'utf8'),{babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code;
  vm.runInNewContext(source,{exports:api,require:name=>name.includes('playerAudio')?playerAudio:{resolveSpriteAnimationKey:()=> 'ninja-special',markOneShotAnimation:(...args)=>locks.push(args)}});
  const player={active:true,anims:{play:(...args)=>plays.push(args)}};
  api.presentSwarmRelease({},player,36);api.presentSwarmRelease({},player,36);
  assert.equal(plays[0][0].frameRate,30);assert.equal(plays[0][0].repeat,-1);
  assert.equal(plays[1][1],true);assert.equal(plays[0][0].duration,undefined);
  assert.equal(locks[0][1],'special');
});

test('owner shuriken keep their predicted pace when the later server launch confirms them',()=>{
  const f=setup();
  const request=f.api.predictNinja(f.scene,f.owner,'owner',{id:'shot',angle:0});
  const q=model.launch(f.owner,request.angle,'owner:shot:0');q.ownerName='owner';
  const expected=structuredClone(q);
  // The predicted flight's own position at render time t, for per-frame pace.
  const modelAt=t=>{const m=structuredClone(q);while(m.elapsed+model.STEP_MS<=t)model.step(m,f.owner,[]);
    const n=structuredClone(m);model.step(n,f.owner,[]);return m.x+(n.x-m.x)*(t-m.elapsed)/model.STEP_MS;};
  let last=null;
  for(let t=0;t<=320;t+=16){
    // The server launches one upstream trip (80 ms) after the throw.
    if(t===160)f.packet({type:'ninja-launch',projectile:q,requestId:'shot',simMono:80,sentMono:80});
    f.frame(t);
    const x=f.images[0].x,pace=last===null?0:modelAt(t)-modelAt(t-16);
    if(last!==null)assert.ok(x-last>=pace*0.8,`shuriken stalled at ${t}ms: ${x-last}px of ${pace}px`);
    last=x;
  }
  while(expected.elapsed+model.STEP_MS<=320)model.step(expected,f.owner,[]);
  const next=structuredClone(expected);model.step(next,f.owner,[]);
  const at=expected.x+(next.x-expected.x)*(320-expected.elapsed)/model.STEP_MS;
  assert.ok(Math.abs(f.images[0].x-at)<1e-6,'confirmed flight stays on the predicted timeline');
  f.api.resetNinjaNetwork();
});

test('the thrower sees an impact on the enemy as drawn at once, once per leg; others do not',()=>{
  for(const thrower of ['owner','remote']){
    const f=setup();
    const enemy={active:true,visible:true,x:330,y:180,flipX:false};
    const felt=[];
    f.shots.trackShotTargets({localUsername:'owner',opponentPlayersRef:{enemy:{opponent:enemy,character:'wizard'}},
      playHitFeedback:sprite=>{felt.push(sprite);return true;}});
    const q=model.launch(f.owner,0,`${thrower}:shot:0`);q.ownerName=thrower;
    f.packet({type:'ninja-launch',projectile:q,requestId:'shot'},thrower);
    for(let t=0;t<=1400;t+=16)f.frame(t);
    // Outward and return legs each cross the enemy once.
    // Each crossing plays the shared hit feedback on the enemy as drawn.
    assert.equal(felt.length,thrower==='owner'?2:0,thrower);
    for(const sprite of felt)assert.equal(sprite,enemy);
    assert.equal(f.sounds.length,0,'hit sounds wait for the server');
    f.api.resetNinjaNetwork();
  }
});

test('the owner turns toward the super on the press and holds that facing through the barrage',()=>{
  for(const [startLeft,angle,left] of [[false,Math.PI,true],[true,0,false],[true,Math.PI,true],[false,0,false]]){
    const f=setup();f.owner.flipX=startLeft;
    f.api.predictNinja(f.scene,f.owner,'owner',{id:'super',aim:{angle}},true);
    assert.equal(f.owner.flipX,left,`aim ${angle} from ${startLeft?'left':'right'}`);
    assert.equal(f.owner._lockFlip,true,'running cannot turn him back');
    const swarm=model.swarmConfig?model.swarmConfig():null;
    if(swarm)assert.equal(f.timers.at(-1).ms,swarm.count*swarm.releaseMs+swarm.lockPaddingMs);
    f.timers.at(-1).fn();assert.equal(f.owner._lockFlip,false);
    f.api.resetNinjaNetwork();
  }
});

test('a newer facing lock survives the older lock releasing, and aim maps to facing',()=>{
  const {flipLock}=setup();const player={flipX:false};
  const first=flipLock.faceAttack(null,player,true,0);
  const second=flipLock.faceAttack(null,player,true,0);
  first();assert.equal(player._lockFlip,true,'an earlier unlock does not release the newer lock');
  second();assert.equal(player._lockFlip,false);
  assert.equal(flipLock.aimFacesLeft({angle:0},true),false,'a rightward aim turns right');
  assert.equal(flipLock.aimFacesLeft({angle:Math.PI},false),true);
  assert.equal(flipLock.aimFacesLeft({angle:-Math.PI/2},true),true,'a vertical aim keeps facing');
  assert.equal(flipLock.aimFacesLeft({direction:1,angle:Math.PI},true),false,'an explicit direction wins');
});

test('a directional throw keeps the star in the hand until the release beat, then eases it onto the unchanged flight',()=>{
  const throwing=require('../src/client/game/characters/ninja/throwPresentation');
  const config={releaseMs:70,blendMs:90,startScale:0.5,directions:[
    {key:'up',elevation:35,hand:[20,-18]},{key:'level',elevation:0,hand:[26,-2]},{key:'down',elevation:-35,hand:[22,12]}]};
  assert.equal(throwing.throwPose(-0.5,config).key,'up','screen angles rise toward negative y');
  assert.equal(throwing.throwPose(Math.PI+0.5,config).key,'up','a throw to the left picks the same pose');
  assert.equal(throwing.throwPose(0.1,config).key,'level');
  assert.equal(throwing.throwPose(Math.PI/2,config).key,'down','a steep shot takes the nearest pose');
  assert.equal(throwing.throwPose(0,{}),null,'art without directional poses has none');

  // The same shot twice: once presented the old way, once leaving the hand.
  const plain=setup();plain.api.predictNinja(plain.scene,plain.owner,'owner',{id:'shot',angle:-0.5});
  const held=setup();
  assert.equal(throwing.beginThrow(held.owner,-0.5,0,config),'up');
  held.api.predictNinja(held.scene,held.owner,'owner',{id:'shot',angle:-0.5});
  for(const t of [0,30,60]){plain.frame(t);held.frame(t);}
  assert.equal(held.images.length,0,'nothing is drawn while the pose still holds the star');
  plain.frame(72);held.frame(72);
  const star=held.images[0],hand=throwing.handPoint(held.owner,config.directions[0].hand);
  assert.ok(Math.hypot(star.x-hand.x,star.y-hand.y)<1e-6,'the star appears at the fingertips');
  let last=Math.hypot(star.x-plain.images[0].x,star.y-plain.images[0].y);
  for(const t of [90,120,150]){
    plain.frame(t);held.frame(t);
    const gap=Math.hypot(star.x-plain.images[0].x,star.y-plain.images[0].y);
    assert.ok(gap<last,'it closes on its true path');last=gap;
  }
  plain.frame(170);held.frame(170);
  assert.ok(Math.hypot(star.x-plain.images[0].x,star.y-plain.images[0].y)<1e-6,'and then follows it exactly');
  plain.api.resetNinjaNetwork();held.api.resetNinjaNetwork();

  const mirrored={x:100,y:200,flipX:true};
  assert.equal(throwing.handPoint(mirrored,[20,-18]).x,80,'the hand mirrors with the facing');
  const player={x:0,y:0,_bbSkinTextureKey:'ninja',texture:{key:'ninja'}};
  assert.equal(throwing.beginThrow(player,-0.5,0,config),'up','the default skin, as players carry it, throws directionally');
  const skin={x:0,y:0,_bbSkinTextureKey:'ninja-king'};
  assert.equal(throwing.beginThrow(skin,0,0,config),null,'skins keep their own throw');
  assert.equal(skin._ninjaThrow,undefined);
});
