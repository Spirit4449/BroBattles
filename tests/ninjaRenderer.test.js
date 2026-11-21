const { loadClientModule } = require('./helpers/clientModule');
const test=require('node:test'), assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const loadServerClock=require('./helpers/serverClockModule');
const loadShotPrediction=require('./helpers/shotPredictionModule');
const loadProjectileReplication=require('./helpers/projectileReplicationModule');
const model=require('../src/shared/characters/ninjaProjectile'),clock=require('../src/shared/characters/sparrowReplication');
const playerAudio={};
loadClientModule(require.resolve('../src/client/game/audio/playerAudio.js'), {exports:playerAudio});
const projectileTexture={};
loadClientModule(require.resolve('../src/client/game/characters/ninja/projectileTexture'), {exports:projectileTexture,require:()=>require('../src/shared/projectilePresentation')});

test('shuriken effects render before the flight audio is ready and release the loop when hidden', () => {
  const { createShurikenEffects, FLIGHT_SOUND } = loadClientModule(
    require.resolve('../src/client/game/characters/ninja/effects'), {
      require: name => {
        if (name.includes('projectilePresentation')) return require('../src/shared/projectilePresentation');
        if (name.includes('renderLayers')) return { RENDER_LAYERS: { ATTACKS: 20 } };
        if (name.includes('playerAudio')) return playerAudio;
        return { createSwarmAura: () => null };
      },
    },
  );
  let cached = false;
  let drawn = 0;
  const loops = [];
  const manager = {
    add(key, config) {
      assert.ok(cached);
      assert.equal(key, FLIGHT_SOUND);
      assert.equal(config.loop, true);
      const loop = {
        manager,
        play() { return true; },
        destroy() { this.manager = null; },
      };
      loops.push(loop);
      return loop;
    },
  };
  const graphics = {
    setDepth() { return this; }, setBlendMode() { return this; }, setVisible() { return this; },
    setAlpha() { return this; }, setRotation() { return this; },
    setPosition() { return this; }, clear() { drawn++; return this; },
    fillStyle() { return this; }, fillRect() { return this; }, destroy() {},
  };
  const scene = { sound: manager, cache: { audio: { exists: () => cached } }, add: { graphics: () => graphics } };
  const sprite = Object.assign(new EventEmitter(), { x: 0, y: 0, depth: 20, displayWidth: 32, displayHeight: 32 });
  const effects = createShurikenEffects(scene, sprite, { launch: false });

  effects.update(0, true);
  assert.equal(drawn, 1);
  assert.equal(loops.length, 0);
  cached = true;
  effects.update(16, true);
  effects.update(32, true);
  assert.equal(loops.length, 1);
  effects.update(48, false);
  assert.equal(loops[0].manager, null);
  effects.update(64, true);
  assert.equal(loops.length, 2);
  effects.destroy();
  assert.equal(loops[1].manager, null);
});

function setup(initial={}){
  let now=0;const api={},images=[],sounds=[],ammo=[],releases=[],animation={};
  const flipLock={},timers=[];
  loadClientModule(require.resolve('../src/client/game/characters/shared/flipLock'), {exports:flipLock});
  loadClientModule(require.resolve('../src/client/game/characters/shared/animationState'), {exports:animation,performance:{now:()=>now}});
  const serverClock=loadServerClock({performance:{now:()=>now}});
  const shots=loadShotPrediction({serverClock});
  const replicationHelpers=loadProjectileReplication({performance:{now:()=>now}});
  loadClientModule(require.resolve('../src/client/game/characters/ninja/network'), {exports:api,require:name=>name.includes('projectileReplication')?replicationHelpers:name.includes('serverClock')?serverClock:name.includes('shotPrediction')?shots:name.includes('projectilePresentation')?require('../src/shared/projectilePresentation'):name.includes('playerAudio')?playerAudio:name.includes('animationState')?animation:name==='./swarmPresentation'?{presentSwarmRelease:(scene,player,ms,remote)=>releases.push({player,ms,remote}),presentSwarmTurn(){},presentSwarmImpact(){},presentSwarmShardEnd(){}}:name==='./projectileTexture'?projectileTexture:name==='./throwPresentation'?require('../src/client/game/characters/ninja/throwPresentation'):name==='./effects'?{createShurikenEffects:()=>({update(){},destroy(){}}),HIT_SOUND:'ninja-shuriken-hit'}:name.includes('ninjaProjectile')?model:name.includes('platformMotion')?require('../src/shared/maps/platformMotion'):name.includes('sparrowReplication')?clock:name.includes('runtimeId')?{createRuntimeId:()=> 'request'}:name.includes('renderLayers')?{RENDER_LAYERS:{ATTACKS:20}}:name.includes('flipLock')?flipLock:{connected:false},
    performance:{now:()=>now},setInterval:()=>1,clearInterval(){}});
  const sprite=(x,y,texture)=>{const s={x,y,texture,active:true,setPosition(x,y){this.x=x;this.y=y;return this;},setScale(){return this;},setDepth(){return this;},setTint(){return this;},setVisible(v){this.visible=v;},setRotation(){},destroy(){this.active=false;}};images.push(s);return s;};
  const flashes=[];
  const scene={events:new EventEmitter(),add:{image:sprite,circle:(x,y)=>{const c={x,y,setDepth(){return c;},destroy(){}};flashes.push(c);return c;}},tweens:{add(){}},sound:{play:key=>sounds.push(key)}};
  const owner={active:true,x:100,y:200,flipX:false};
  scene._localPlayerAudioSprite=owner;
  api.configureNinjaNetwork({ninjaCombatVersion:model.VERSION,epoch:'room',sentMono:0,simMono:0,colliders:[],active:[],terminals:[],...initial});
  api.attachNinjaScene(scene,{localUsername:'owner',localPlayer:owner,onAmmo:a=>ammo.push(a)});
  const frame=t=>{now=t;api.observeNinjaSnapshot({snapshotEpoch:'room',sentMono:t,tMono:t});scene.events.emit('update');};
  const packet=(a,name='owner')=>api.handleNinjaPacket(scene,{playerName:name,action:{ninjaCombatVersion:model.VERSION,epoch:'room',simMono:now,sentMono:now,...a}},{localUsername:'owner',localPlayer:owner});
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

test('the Ninja super plays its aimed clip once through the barrage; other skins keep looping theirs',()=>{
  const load=(plays,locks)=>{const api={};loadClientModule(require.resolve('../src/client/game/characters/ninja/swarmPresentation'), {exports:api,performance:{now:()=>0},
    require:name=>name.includes('playerAudio')?playerAudio:name==='./swarmFx'?{beginSwarm:()=>null,swarmThrowSound(){}}:name.includes('aimPose')?require('../src/client/game/characters/shared/aimPose'):name.endsWith('animation-settings.json')?require('../public/assets/ninja/animation-settings.json'):{resolveSpriteAnimationKey:()=> 'ninja-special',markOneShotAnimation:(...args)=>locks.push(args)}});return api;};
  const anims=new Set(['ninja-special','ninja-special-up','ninja-special-low']);
  const scene={anims:{exists:key=>anims.has(key),get:()=>({msPerFrame:40,frames:Array.from({length:16},()=>({duration:0}))})}};
  let plays=[],locks=[];const api=load(plays,locks);
  const player={active:true,texture:{key:'ninja'},anims:{play:(...args)=>plays.push(args)}};
  // Aimed up and ahead: the `up` clip, started once for the whole barrage.
  api.presentSwarmRelease(scene,player,36,false,{x:0,y:0,angle:-0.6});api.presentSwarmRelease(scene,player,36,false,{x:0,y:0,angle:-0.6});
  assert.deepEqual(plays,[['ninja-special-up',false]]);
  assert.equal(locks.length,1);assert.equal(locks[0][1],'special');assert.equal(locks[0][2],16*40);
  // A skin with its own special row keeps looping it, never restarting.
  plays=[];locks=[];const skinned=load(plays,locks);
  const skin={active:true,texture:{key:'ninja-arena-sovereign'},anims:{play:(...args)=>plays.push(args)}};
  skinned.presentSwarmRelease(scene,skin,36,true,{x:0,y:0,angle:0});
  assert.equal(plays[0][0].repeat,-1);assert.equal(plays[0][1],true);assert.equal(locks[0][1],'special');
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
    f.shots.trackShotTargets({localUsername:'owner',opponentPlayersRef:{enemy:{opponent:enemy,character:'ozzy'}},
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
test('moving to a new scene stops drawing into the old one, whose shutdown then leaves the runtime alone',()=>{
  const f=setup(),next={events:new EventEmitter(),add:f.scene.add,tweens:f.scene.tweens,sound:f.scene.sound};
  f.api.attachNinjaScene(next,{localUsername:'owner',localPlayer:f.owner});
  assert.equal(f.scene.events.listenerCount('update'),0);
  assert.equal(next.events.listenerCount('update'),1);
  f.scene.events.emit('shutdown');
  assert.equal(f.api.ninjaEnabled(),true);
  next.events.emit('shutdown');
  assert.equal(f.api.ninjaEnabled(),false);
});
test('an enemy shuriken is drawn ahead by its rewind so it reaches this player when the server does; allies are not',()=>{
  const positions={};
  for(const shooter of ['foe','ally']){
    const f=setup();
    f.shots.trackShotTargets({localUsername:'owner',opponentPlayersRef:{foe:{opponent:{active:true,x:600,y:200},character:'ninja'}}});
    f.frame(0);
    const q=model.launch({x:600,y:200},Math.PI,`${shooter}:shot:0`);q.ownerName=shooter;q.launchMono=0;
    f.packet({type:'ninja-launch',projectile:q,viewRewindMs:100},shooter);
    let previous=Infinity;
    for(let t=0;t<=300;t+=4){f.frame(t);const star=f.images.find(s=>s.active);if(star){assert.ok(star.x<=previous+1e-6,'never runs backwards');previous=star.x;}}
    positions[shooter]=f.images.find(s=>s.active).x;
    f.api.resetNinjaNetwork();
  }
  // Ally: the server's present (age 300). Enemy: 100 ms further, once it has caught up (no ping or playout here).
  const flown=age=>{const q=model.launch({x:600,y:200},Math.PI,'x');for(let i=0;i<Math.round(age/model.STEP_MS);i++)model.step(q,{x:600,y:200},[]);return q.x;};
  assert.ok(Math.abs(positions.ally-flown(300))<1,`ally at ${positions.ally}`);
  assert.ok(Math.abs(positions.foe-flown(400))<1,`enemy at ${positions.foe}`);
});

test('an enemy Ninja\'s shuriken take his team colour, not the return point\'s',()=>{
  const f=setup();
  const foe={active:true,x:400,y:200,flipX:true,_bbTeamColor:require('../src/shared/projectilePresentation').TEAM_RED,anims:{play(){}}};
  f.scene.textures={exists:key=>key==='shuriken'||key==='shuriken-red'};
  f.api.attachNinjaScene(f.scene,{opponentPlayersRef:{foe:{opponent:foe}}});
  const q=model.launch(foe,Math.PI,'foe:r:0');q.ownerName='foe';
  f.packet({type:'ninja-launch',requestId:'r',projectile:q,viewRewindMs:0},'foe');
  for(let t=16;t<=400;t+=16)f.frame(t);
  const drawn=f.images.find(image=>String(image.texture).startsWith('shuriken'));
  assert.equal(drawn?.texture,'shuriken-red');
});

test('a swarm casts once per barrage, pockets each shuriken that returns, and closes with the last',()=>{
  const api={},played=[],objects=[];let now=0;
  loadClientModule(require.resolve('../src/client/game/characters/ninja/swarmFx'), {exports:api,performance:{now:()=>now},
    require:name=>name.includes('characterTuning')?require('../src/shared/characters/characterTuning.js'):name.includes('projectilePresentation')?require('../src/shared/projectilePresentation'):name.includes('renderLayers')?{RENDER_LAYERS:{PLAYER:10,ATTACKS:20}}:name.includes('playerAudio')?{playPlayerSound:(scene,source,key)=>played.push(key)}:name==='./projectileTexture'?{ninjaProjectileTexture:(scene,owner)=>owner.texture.key==='ninja'?'shuriken':`${owner.texture.key}-weapon-spin`}:{}});
  const sprite=()=>{const s={active:true,anims:{play(){},setProgress(){}},once(){},destroy(){s.active=false;}};
    for(const m of ['setDepth','setScale','setFlipX','setAlpha','setTint','setTexture','setOrigin','setPosition','setRotation','setBlendMode','setVisible'])s[m]=()=>s;
    objects.push(s);return s;};
  const delayed=[];
  const scene={add:{sprite},textures:{exists:()=>true},anims:{exists:()=>true},events:new EventEmitter(),tweens:{add(){},killTweensOf(){}},
    time:{get now(){return now;},delayedCall:(ms,fn)=>delayed.push(fn)}};
  const player={active:true,visible:true,x:0,y:0,flipX:false,texture:{key:'ninja'},frame:{name:'special00'}};
  const cfg=model.swarmConfig();
  for(let i=0;i<cfg.count;i++){now=i*cfg.releaseMs;assert.ok(api.beginSwarm(scene,player));scene.events.emit('update');}
  assert.deepEqual(played,[api.SWARM_SOUNDS.cast]);
  // One lost (blocked) shuriken; every other one is pocketed with its own sound.
  for(let i=0;i<cfg.count;i++)api.swarmShardEnded(scene,player,{returned:i>0});
  assert.equal(played.filter(key=>key===api.SWARM_SOUNDS.pocket).length,cfg.count-1);
  // The crown skin pockets with its own sound.
  const crowned={...player,texture:{key:'ninja-arena-sovereign'}};
  api.swarmShardEnded(scene,crowned,{returned:true});
  assert.equal(played.at(-1),api.SWARM_SOUNDS.pocketCrown);
  delayed.forEach(fn=>fn());
  assert.equal(player._ninjaSwarm,undefined);
  assert.equal(scene.events.listenerCount('update'),0);
});

test('a shuriken striking a wall plays the hit sound once',()=>{
  const f=setup({colliders:[{left:260,right:270,top:-500,bottom:500}]});
  f.api.predictNinja(f.scene,f.owner,'owner',{id:'wall',angle:0});
  for(let t=16;t<=600;t+=16)f.frame(t);
  assert.equal(f.sounds.filter(key=>key==='ninja-shuriken-hit').length,1);
});
