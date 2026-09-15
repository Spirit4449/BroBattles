const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),babel=require('@babel/core');
const {EventEmitter}=require('node:events');
const model=require('../src/shared/ninjaProjectile'),clock=require('../src/shared/huntressReplication');
const code=babel.transformSync(fs.readFileSync(require.resolve('../src/characters/ninja/network'),'utf8'),{babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code;
const projectileTexture={};
vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/characters/ninja/projectileTexture'),'utf8'),{babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code,{exports:projectileTexture});
function setup(initial={}){
  let now=0;const api={},images=[],sounds=[],ammo=[];
  vm.runInNewContext(code,{exports:api,require:name=>name==='./projectileTexture'?projectileTexture:name==='./effects'?{createShurikenEffects:()=>({update(){},destroy(){}})}:name.includes('ninjaProjectile')?model:name.includes('huntressReplication')?clock:name.includes('runtimeId')?{createRuntimeId:()=> 'request'}:name.includes('renderLayers')?{RENDER_LAYERS:{ATTACKS:20}}:{connected:false},
    performance:{now:()=>now},setInterval:()=>1,clearInterval(){}});
  const sprite=(x,y,texture)=>{const s={x,y,texture,active:true,setPosition(x,y){this.x=x;this.y=y;return this;},setScale(){return this;},setDepth(){return this;},setTint(){return this;},setVisible(v){this.visible=v;},setRotation(){},destroy(){this.active=false;}};images.push(s);return s;};
  const scene={events:new EventEmitter(),add:{image:sprite},tweens:{add(){}},sound:{play:key=>sounds.push(key)}};
  const owner={active:true,x:100,y:200,flipX:false};
  api.configureNinjaNetwork({ninjaCombatVersion:1,epoch:'room',sentMono:0,simMono:0,colliders:[],active:[],terminals:[],...initial});
  api.attachNinjaScene(scene,{localUsername:'owner',localPlayer:owner,onAmmo:a=>ammo.push(a)});
  const frame=t=>{now=t;api.observeNinjaSnapshot({snapshotEpoch:'room',sentMono:t,tMono:t});scene.events.emit('update');};
  const packet=a=>api.handleNinjaPacket(scene,{playerName:'owner',action:{ninjaCombatVersion:1,epoch:'room',simMono:now,sentMono:now,...a}},{localUsername:'owner',localPlayer:owner});
  return {api,scene,owner,frame,packet,images,sounds,ammo};
}
test('local launch is immediate and matches authoritative launch/reticle geometry',()=>{
  const f=setup();const aim=require('../src/characters/shared/attackAim').resolveAttackAimContext({character:'ninja',player:f.owner,pointerWorldX:500,pointerWorldY:50});
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

test('king basic, swarm and trails use crown; default and missing skin assets fall back',()=>{
  const key='ninja__ninja-arena-sovereign-weapon';
  for(const special of [false,true]){
    const f=setup();f.owner._bbSkinTextureKey='ninja__ninja-arena-sovereign';
    f.scene.textures={exists:k=>k===key};
    f.api.predictNinja(f.scene,f.owner,'owner',{id:'crown',angle:0,aim:{angle:0}},special);
    f.frame(0);f.frame(100);
    assert.ok(f.images.length>1);
    assert.ok(f.images.every(image=>image.texture===key));
    f.api.resetNinjaNetwork();
  }
  assert.equal(projectileTexture.ninjaProjectileTexture({textures:{exists:()=>false}},{_bbSkinTextureKey:'ninja__ninja-arena-sovereign'}),'shuriken');
  assert.equal(projectileTexture.ninjaProjectileTexture({textures:{exists:k=>k===key}},{texture:{key:'ninja'}}),'shuriken');
});
test('authoritative crown launch resolves remote owner skin',()=>{
  const f=setup(),key='ninja__ninja-arena-sovereign-weapon';
  f.scene.textures={exists:k=>k===key};
  const remote={x:200,y:200,_bbSkinTextureKey:'ninja__ninja-arena-sovereign'};
  f.api.attachNinjaScene(f.scene,{opponentPlayersRef:{king:{opponent:remote}}});
  const q=model.launch(remote,0,'king:shot:0');q.ownerName='king';
  f.packet({type:'ninja-launch',projectile:q});f.frame(100);
  assert.ok(f.images.length>0);assert.ok(f.images.every(image=>image.texture===key));
  f.api.resetNinjaNetwork();
});
