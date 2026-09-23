const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const physics = require('../src/shared/movementPhysics.json');
const { dashDirection, acceptDash } = require('../src/shared/dash');
const playerAudio = {};
vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/gameScene/playerAudio.js'), 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', {targets:{node:'current'}}]],
}).code, {exports: playerAudio});
const exported = {};
vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/gameScene/dash.js'), 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', {targets:{node:'current'}}]],
}).code, { exports: exported, require: path => path.endsWith('.json') ? physics : path.includes('sweptCollision') ? require('../src/shared/sweptCollision') : path.includes('playerAudio') ? playerAudio : {dashDirection}, Date });
const scene = { textures:{exists:()=>false} };
function player() {
  return { visible:true, flipX:false, body:{allowGravity:true, velocity:{x:0,y:-100}, blocked:{}},
    setFlipX(x){this.flipX=x;}, setAcceleration(){}, setDrag(){}, setMaxVelocity(){},
    setVelocity(x,y){this.body.velocity={x,y};} };
}
test('eight directions have identical distance; opposing keys cancel; no direction uses facing', () => {
  for (const [left,right,up,down] of [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[1,0,1,0],[0,1,1,0],[1,0,0,1],[0,1,0,1]]) {
    assert.ok(Math.abs(Math.hypot(...Object.values(dashDirection(left,right,up,down)))-1)<1e-10);
  }
  assert.deepEqual(dashDirection(0,0,0,0,-1),{x:-1,y:0});
  assert.deepEqual(dashDirection(1,1,1,0),{x:0,y:-1});
  const diagonal=dashDirection(1,0,1,0); assert.ok(diagonal.x<0 && diagonal.y<0); assert.equal(diagonal.x,diagonal.y);
});
test('ground or air dash suspends gravity, expires, and cannot repeat before 5 seconds after the burst', () => {
  for (const grounded of [true,false]) {
    const p=player();p.body.blocked.down=grounded;
    assert.equal(exported.updateDash(scene,p,{pressed:true,right:true,now:1000}),true);
    assert.equal(p.body.velocity.x,physics.dashSpeed);assert.equal(p.body.allowGravity,false);
    assert.equal(exported.updateDash(scene,p,{now:1160}),false);
    assert.equal(p.body.allowGravity,true);assert.equal(p.body.velocity.y,0);
    assert.equal(exported.updateDash(scene,p,{pressed:true,now:6159}),false);
    assert.equal(exported.updateDash(scene,p,{pressed:true,now:6160}),true);
  }
});
test('wall contact permanently removes normal velocity; interrupts preserve knockback', () => {
 const p=player();exported.updateDash(scene,p,{pressed:true,left:true,now:1000});
 p.body.blocked.left=true;p.body.velocity.x=0;
 assert.equal(exported.updateDash(scene,p,{now:1016}),true);assert.equal(p.body.velocity.x,0);
 p.body.velocity.x=0;assert.equal(exported.updateDash(scene,p,{now:1160}),false);
 assert.equal(p.body.velocity.x,0);assert.equal(p.body.allowGravity,true);
 p.body.blocked.left=false;exported.updateDash(scene,p,{pressed:true,up:true,now:6160});
 p.body.velocity.y=500;exported.updateDash(scene,p,{blocked:true,now:6176});
 assert.equal(p.body.velocity.y,500);assert.equal(p.body.allowGravity,true);
});
test('server grants a burst only once and rejects cooldown spam, dead/locked players, malformed direction', () => {
 const p={isAlive:true}; const input={dashSeq:1,dashX:-Math.SQRT1_2,dashY:-Math.SQRT1_2};
 assert.equal(acceptDash(p,input,1000),true);assert.equal(acceptDash(p,input,1001),false);
 assert.equal(acceptDash(p,{...input,dashSeq:2},6159),false);
 assert.equal(acceptDash(p,{...input,dashSeq:3},6160),true);
 for(const state of [{isAlive:false},{isAlive:true,_controlLockUntil:9000},{isAlive:true,_knockbackUntil:9000}]) assert.equal(acceptDash(state,input,1000),false);
 assert.equal(acceptDash({isAlive:true},{...input,dashX:99},1000),false);
 assert.equal(acceptDash({isAlive:true},{...input,dashSeq:Infinity},1000),false);
});

test('the actual movement handler completes its dash branch without touching later const state', () => {
  const source = fs.readFileSync(require.resolve('../src/player.js'), 'utf8');
  const ast = babel.parseSync(source, { babelrc:false, configFile:false, sourceType:'module' });
  const fn = ast.program.body.find(n => n.type === 'ExportNamedDeclaration' && n.declaration?.id?.name === 'handlePlayerMovement').declaration;
  const p = player(); p._dash = {x:-Math.SQRT1_2,y:-Math.SQRT1_2};
  p.body.touching = {down:false}; p.body.velocity = {x:-495,y:-495};
  const key = {isDown:false};
  const context = { player:p, scene:{game:{loop:{delta:16}}},
    mobileControlsController:null, combatMouseController:null, chatInputActive:false, window:{},
    drawDashCooldown(){}, updateDash:()=>true, keySpace:key,
    Phaser:{Input:{Keyboard:{JustDown:()=>true}}},
    cursors:{left:key,right:key,up:key,down:key}, movementKeys:{left:key,right:key,up:key,down:key},
    dead:false, isAttacking:false, movementSpeedMult:1, powerupInvisible:false,
    ammoCharges:1, ammoCapacity:1, reloadTimerMs:0, drawAmmoBar(){},
    stopMovementLoopSfx(){}, isMoving:false, wasWallSliding:true, applyFlipOffsetLocal(){},
    playCharacterAnimation(){}, currentCharacter:'ninja',currentSkinId:'',resolveAnimKey(){},
    syncLocalUiPosition(){},getMovementFxNetworkState:()=>({}), networkInputState:null,
  };
  vm.runInNewContext(`${source.slice(fn.start,fn.end)}; handlePlayerMovement(scene);`,context);
  assert.equal(context.networkInputState.animation,'dashing');
  assert.equal(context.networkInputState.wallSliding,false);
  assert.equal(context.wasWallSliding,false);
  assert.equal(p._wallAttachSide,null);
});

test('dash sound plays once per accepted launch, including when the visual effect is hidden', () => {
  const calls=[];const audioScene={...scene,cache:{audio:{exists:()=>true}},sound:{play:(...args)=>calls.push(args)}};
  const p=player();
  exported.updateDash(audioScene,p,{pressed:true,now:1000,showEffect:false});
  exported.updateDash(audioScene,p,{pressed:true,now:1050});
  exported.updateDash(audioScene,p,{pressed:true,now:2000});
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'sfx-dash');
  assert.equal(calls[0][1].volume,0.7);
  assert.ok(calls[0][1].rate>=0.97 && calls[0][1].rate<=1.03);
  exported.updateDash(audioScene,p,{pressed:true,now:6160,showEffect:false});
  assert.equal(calls.length,2);
  audioScene._localPlayerAudioSprite={active:true,x:0,y:0};
  exported.playDashSound(audioScene,true,{x:0,y:0});
  assert.ok(Math.abs(calls[2][1].volume-0.63)<1e-12);
});

test('bottom HUD counts down to ready, stays independent of player coordinates, and cleans up', t => {
  let now=1000;t.mock.method(Date,'now',()=>now);
  const parts={};
  const element=()=>({style:{setProperty(k,v){this[k]=v;}},dataset:{},textContent:'',setAttribute(k,v){this[k]=v;},remove(){this.removed=true;}});
  const root=element();root.querySelector=key=>parts[key] ||= element();
  const handlers={}; const body={appendChild(el){this.child=el;}};
  const document={body,createElement:()=>root,addEventListener(){},removeEventListener(){}};
  const hudExports={};
  vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/gameScene/dash.js'),'utf8'),{
    babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]],
  }).code,{exports:hudExports,require:path=>path.endsWith('.json')?physics:path.includes('playerAudio')?playerAudio:{dashDirection},Date,document});
  const p=player();p._dashReadyAt=6000;p.once=(name,fn)=>handlers[name]=fn;
  const hudScene={events:{once:(name,fn)=>handlers[name]=fn,off(){}}};
  hudExports.drawDashCooldown(hudScene,p);
  assert.equal(p._dashHud.fill.style.transform,'scaleX(0)');
  p._dash={until:1160};p._dashReadyAt=6160;
  hudExports.drawDashCooldown(hudScene,p);
  assert.equal(p._dashHud.status.textContent,'Dash!');
  assert.equal(p._dashHud.fill.style.transform,'scaleX(1)');
  assert.equal(p._dashHud.root.dataset.ready,'false');
  now=1080;hudExports.drawDashCooldown(hudScene,p);
  assert.equal(p._dashHud.fill.style.transform,'scaleX(0.5)');
  p._dash=null;now=1160;hudExports.drawDashCooldown(hudScene,p);
  assert.equal(p._dashHud.status.textContent,'5.0s');
  assert.equal(p._dashHud.fill.style.transform,'scaleX(0)');
  p._dashReadyAt=6000;
  now=3500;p.x=9000;hudExports.drawDashCooldown(hudScene,p);
  assert.equal(p._dashHud.fill.style.transform,'scaleX(0.5)');
  assert.equal(body.child,root);
  now=6000;hudExports.drawDashCooldown(hudScene,p);
  assert.equal(p._dashHud.status.textContent,'Ready');
  assert.equal(p._dashHud.fill.style.transform,'scaleX(1)');
  assert.equal(p._dashHud.root.dataset.idle,'false');
  now=12000;hudExports.drawDashCooldown(hudScene,p);
  assert.equal(p._dashHud.root.dataset.idle,'true');
  assert.equal(p._dashHud.root.style['--dash-pulse-opacity'],'0');
  now=17999;hudExports.drawDashCooldown(hudScene,p);
  assert.equal(p._dashHud.root.style['--dash-pulse-opacity'],'0');
  now=19000;hudExports.drawDashCooldown(hudScene,p);
  assert.ok(Number(p._dashHud.root.style['--dash-pulse-opacity'])>0);
  p._dashReadyAt=24000;hudExports.drawDashCooldown(hudScene,p);
  assert.equal(p._dashHud.root.dataset.idle,'false');
  handlers.shutdown();assert.equal(root.removed,true);assert.equal(p._dashHud,null);
});


test('dash starts at fixed speed regardless of incoming momentum and preserves exit velocity', () => {
 const p=player();p.body.velocity={x:200,y:-150};
 exported.updateDash(scene,p,{pressed:true,right:true,now:1000});
 assert.equal(p.body.velocity.x,physics.dashSpeed);assert.equal(p.body.velocity.y,0);
 exported.updateDash(scene,p,{now:1160});
 assert.equal(p.body.velocity.x,physics.dashSpeed);assert.equal(p.body.velocity.y,0);
 let acceleration,drag,limit;
 p.setAccelerationX=x=>acceleration=x;p.setDragX=x=>drag=x;p.setMaxVelocity=x=>limit=x;
 p.body.touching={down:false};
 exported.applyDashCoast(p,1,260,1160);
 assert.equal(acceleration,0);assert.equal(drag,900);assert.equal(limit,physics.dashSpeed);
 p.body.touching.down=true;
 exported.applyDashCoast(p,1,260,1160);
 assert.equal(drag,physics.dashSurfaceDrag);
 assert.ok(drag<physics.dashCoastDrag);
 p.body.touching.down=false;
 p.body.velocity={x:900,y:900};p._dashReadyAt=0;
 exported.updateDash(scene,p,{pressed:true,right:true,up:true,now:4000});
 assert.ok(Math.hypot(p.body.velocity.x,p.body.velocity.y)<=700.000001);
});

const {sweepMovement}=require('../src/shared/sweptCollision');
test('sweeps stop at thin walls, ceilings, floors and slide without penetrating at low frame rates', () => {
 const box={x:0,y:0,width:20,height:20};
 const wall={left:50,right:52,top:-100,bottom:200};
 let result=sweepMovement(box,140,0,[wall]);assert.equal(result.x,30);assert.equal(result.hits.right,true);
 result=sweepMovement(box,140,80,[wall]);assert.equal(result.x,30);assert.equal(result.y,80);
 result=sweepMovement(box,0,-140,[{left:-100,right:200,top:-52,bottom:-50}]);assert.equal(result.y,-50);
 result=sweepMovement(box,0,140,[{left:-100,right:200,top:50,bottom:52}]);assert.equal(result.y,30);
 result=sweepMovement(box,140,140,[wall,{left:-100,right:200,top:90,bottom:92}]);
 assert.equal(result.x,30);assert.equal(result.y,70);
});
test('one-way surfaces, disabled colliders and travel away from contact remain free', () => {
 const box={x:30,y:0,width:20,height:20};const wall={left:50,right:52,top:-100,bottom:200};
 assert.equal(sweepMovement(box,-60,0,[wall]).x,-30);
 assert.equal(sweepMovement(box,60,0,[{...wall,enable:false}]).x,90);
 assert.equal(sweepMovement(box,60,0,[{...wall,collision:{left:false}}]).x,90);
 const floor={left:-100,right:200,top:50,bottom:52,collision:{down:false}};
 assert.equal(sweepMovement({x:0,y:70,width:20,height:20},0,-140,[floor]).y,-70);
});
test('Arcade body displacement is swept even when the body completely skips over a wall', () => {
 const Body=require('phaser/src/physics/arcade/Body');
 const world={defaults:{},gravity:{x:0,y:825}};
 const body=new Body(world);body.setSize(20,20);body.prev.set(0,0);body.x=140;body.y=0;
 body.newVelocity.set(140,0);body.velocity.set(1000,0);body.enable=true;
 const p={body,_dash:{}};
 exported.protectDashMotion({_mapObjects:[{body:{left:50,right:52,top:-100,bottom:200}}]},p,1000);
 assert.ok(Math.abs(body.x-30)<1e-6);assert.equal(body.velocity.x,0);assert.equal(body.blocked.right,true);
});

test('real Arcade steps coast smoothly and never reapply blocked dash velocity', () => {
 const Body=require('phaser/src/physics/arcade/Body');const World=require('phaser/src/physics/arcade/World');
 const world={defaults:{},gravity:{x:0,y:825},updateMotion:World.prototype.updateMotion,
   computeVelocity:World.prototype.computeVelocity,computeAngularVelocity:World.prototype.computeAngularVelocity};
 const body=new Body(world);body.setSize(20,20);body.x=0;body.y=0;body.enable=true;
 const p={visible:true,body,flipX:false,setFlipX(v){this.flipX=v;},setVelocity:(x,y)=>body.setVelocity(x,y),
   setMaxVelocity:(x,y)=>body.setMaxVelocity(x,y),setDrag:(x,y)=>body.setDrag(x,y),
   setAcceleration:(x,y)=>body.setAcceleration(x,y),setAccelerationX:x=>body.setAccelerationX(x),setDragX:x=>body.setDragX(x)};
 body.velocity.set(200,-120);
 exported.updateDash(scene,p,{pressed:true,right:true,now:1000});body.update(1/60);
 assert.equal(body.velocity.x,physics.dashSpeed);assert.equal(body.velocity.y,0);
 exported.updateDash(scene,p,{now:1160});exported.applyDashCoast(p,1,260,1160);body.update(1/60);
 assert.equal(body.velocity.x,physics.dashSpeed-15);assert.ok(body.velocity.y>0);
 p._dashReadyAt=0;body.x=0;body.y=0;body.velocity.set(0,0);
 const wallScene={...scene,_mapObjects:[{body:{left:25,right:26,top:-200,bottom:200}}]};
 for(let i=0;i<9;i++) {
   exported.updateDash(wallScene,p,{pressed:i===0,right:true,now:3000+i*16});
   assert.equal(body.velocity.x,i===0?physics.dashSpeed:0);
   body.resetFlags();body.update(1/60);exported.protectDashMotion(wallScene,p,3000+i*16);
   assert.ok(body.right<=25.000001);assert.equal(body.velocity.x,0);
 }
 exported.updateDash(wallScene,p,{now:3160});assert.equal(body.velocity.x,0);assert.equal(body.allowGravity,true);
});

test('wall sliding loses tangential speed to surface friction during dash and coast without rebuilding normal speed', () => {
 const Body=require('phaser/src/physics/arcade/Body');
 const body=new Body({defaults:{},gravity:{x:0,y:825}});body.setSize(20,20);body.enable=true;
 const wall={left:50,right:52,top:-200,bottom:200};const wallScene={_mapObjects:[{body:wall}]};
 const p={body,_dash:{}};
 body.prev.set(0,0);body.newVelocity.set(60,-500/60);body.x=60;body.y=-500/60;body.velocity.set(500,-500);
 exported.protectDashMotion(wallScene,p,1000,1/60);
 assert.ok(Math.abs(body.x-30)<1e-6);assert.equal(body.velocity.x,0);assert.ok(Math.abs(body.velocity.y-exported.dampDashVertical(-500*Math.exp(-physics.dashWallDragRate/60),1/60))<1e-6);
 p._dash=null;p._dashCoastUntil=2000;
 body.prev.set(30,-20);body.newVelocity.set(0,-455/60);body.x=30;body.y=-28;
 exported.protectDashMotion(wallScene,p,1016,1/60);
 assert.equal(body.velocity.x,0);assert.ok(Math.abs(body.velocity.y-exported.dampDashVertical(-455*Math.exp(-physics.dashWallDragRate/60),1/60))<1e-6);
 // Once clear of the surface, its drag stops immediately.
 body.prev.set(20,-28);body.newVelocity.set(-5,-410/60);body.x=15;body.y=-36;
 exported.protectDashMotion(wallScene,p,1032,1/60);
 assert.ok(Math.abs(body.velocity.y-exported.dampDashVertical(-410,1/60))<1e-6);
});

test('ground and ceiling dash friction is independent of physics step frequency', () => {
 const Body=require('phaser/src/physics/arcade/Body');
 for(const fps of [30,60,120]) for(const ceiling of [false,true]) {
   const body=new Body({defaults:{},gravity:{x:0,y:825}});body.setSize(20,20);body.enable=true;
   const surface={left:-1000,right:1000,top:ceiling?-22:20,bottom:ceiling?0:22};
   body.velocity.set(700,0);body.x=0;body.y=0;const p={body,_dash:{}};
   for(let i=0;i<fps/10;i++) {
     body.prev.set(body.x,body.y);body.newVelocity.set(body.velocity.x/fps,0);body.x+=body.newVelocity.x;
     exported.protectDashMotion({_mapObjects:[{body:surface}]},p,1000+i*1000/fps,1/fps);
   }
   assert.ok(Math.abs(body.velocity.x-(700-physics.dashSurfaceDrag*0.1))<1e-6);
 }
});

test('ground input curves the dash and clears stale wall-jump steering locks', () => {
 const p=player();p.body.blocked.down=true;p._wallKickLockUntil=9999;
 exported.updateDash(scene,p,{pressed:true,right:true,now:1000});
 assert.equal(p._wallKickLockUntil,0);
 exported.updateDash(scene,p,{right:true,up:true,now:1032});
 assert.ok(p.body.velocity.x>0 && p.body.velocity.x<700);
 assert.ok(p.body.velocity.y<0);
 const before=p.body.velocity.x;
 exported.updateDash(scene,p,{left:true,now:1064});
 assert.equal(p.body.velocity.x,before); // Upward steering made this an air dash.
});
test('ground steering away from a wall works during dash but holding into it never rebuilds pressure', () => {
 const p=player();p.body.blocked.down=true;exported.updateDash(scene,p,{pressed:true,right:true,now:1000});
 p.body.blocked.right=true;p.body.velocity.x=0;
 exported.updateDash(scene,p,{right:true,now:1032});assert.equal(p.body.velocity.x,0);
 exported.updateDash(scene,p,{left:true,now:1064});assert.ok(p.body.velocity.x<0);
 exported.updateDash(scene,p,{now:1160});assert.equal(p._dash,null);assert.equal(p.body.allowGravity,true);
});
test('normal speed movement is not suppressed by post-dash coasting', () => {
 const p=player();p._dashCoastUntil=2000;p.body.velocity.x=50;
 p.setAccelerationX=()=>assert.fail('coast must not override normal acceleration');
 p.setDragX=()=>assert.fail('coast must not override normal drag');
 exported.applyDashCoast(p,1,260,1200);
});

test('dash sweep repairs a fractional landing side-stall and normal movement continues after coast', () => {
 const Body=require('phaser/src/physics/arcade/Body');const World=require('phaser/src/physics/arcade/World');
 const {processPlayerPlatformCollision}=require('../src/players/platformCollision');
 const world={defaults:{},gravity:{x:0,y:825},OVERLAP_BIAS:4,intersects:World.prototype.intersects};
 const body=new Body(world),surface=new Body(world);
 body.setSize(31,37.15384615384615);surface.setSize(500,20);
 surface.x=0;surface.y=100;surface.prev.set(0,100);surface.immovable=true;surface.moves=false;surface.updateCenter();
 body.gameObject={body};surface.gameObject={body:surface};body.enable=true;
 const p={body,_dashCoastUntil:1800};
 body.prev.set(-30.5,100-body.height-0.2);
 body.newVelocity.set(1,0.3);body.x=body.prev.x+1;body.y=body.prev.y+0.3;
 body._dx=1;body._dy=0.3;body.velocity.set(60,18);body.updateCenter();
 World.prototype.separate.call(world,body,surface,null,null,false);
 // Simulate the erroneous side separation left by Arcade at a rounded corner.
 body.blocked.right=true;body.velocity.x=0;
 exported.protectDashMotion({_mapObjects:[{body:surface}]},p,1000,1/60);
 assert.equal(body.velocity.x,60);assert.equal(body.blocked.right,false);assert.ok(body.bottom<=surface.top);
 const startingX=body.x;
 for(let i=0;i<60;i++) {
   body.resetFlags();body.prev.set(body.x,body.y);body.newVelocity.set(1,825/3600);
   body.x+=1;body.y+=825/3600;body._dx=1;body._dy=825/3600;body.velocity.set(60,825/60);body.updateCenter();
   World.prototype.separate.call(world,body,surface,processPlayerPlatformCollision,null,false);
   exported.protectDashMotion({_mapObjects:[{body:surface}]},p,1016+i*17,1/60);
   assert.equal(body.blocked.right,false);assert.equal(body.velocity.x,60);
 }
 assert.ok(body.x>startingX+59);
});
test('vertical resistance tapers with speed without forcing a stop or changing direction', () => {
 for(const v of [-700,-300,-10,-0.01,0,0.01,10,300,700]) {
   const next=exported.dampDashVertical(v,1/60);
   assert.equal(Math.sign(next),Math.sign(v));
   assert.ok(Math.abs(next)<=Math.abs(v));
 }
 const loss=v=>v-exported.dampDashVertical(v,1/60);
 assert.ok(loss(700)>loss(300));assert.ok(loss(300)>loss(10));assert.ok(loss(10)<0.003);
 assert.equal(exported.dampDashVertical(-700,1/60,0),-700);
});
test('vertical drag is frame-rate independent and ascent becomes descent through gravity', () => {
 const outcomes=[];
 for(const fps of [30,60,120]) {
   let v=-700;
   for(let i=0;i<fps;i++) v=exported.dampDashVertical(v,1/fps);
   outcomes.push(v);
 }
 assert.ok(Math.max(...outcomes)-Math.min(...outcomes)<1e-8);
 let v=-100;
 for(let i=0;i<30;i++) v=exported.dampDashVertical(v+825/60,1/60);
 assert.ok(v>250); // Gravity carries the player through the apex; no hover threshold.
});

test('air dash ignores direction changes until the burst ends', () => {
 const p=player();exported.updateDash(scene,p,{pressed:true,right:true,up:true,now:1000});
 const initial={...p.body.velocity};const facing=p.flipX;
 exported.updateDash(scene,p,{left:true,down:true,now:1050});
 assert.deepEqual(p.body.velocity,initial);assert.equal(p.flipX,facing);
 exported.updateDash(scene,p,{now:1160});assert.equal(p._dash,null);
});
test('wall contact restores gravity during the burst and vertical speed grows after it', () => {
 const Body=require('phaser/src/physics/arcade/Body');const World=require('phaser/src/physics/arcade/World');
 const world={defaults:{},gravity:{x:0,y:825},updateMotion:World.prototype.updateMotion,
 computeVelocity:World.prototype.computeVelocity,computeAngularVelocity:World.prototype.computeAngularVelocity};
 const body=new Body(world);body.setSize(20,20);body.enable=true;body.x=30;body.y=0;body.allowGravity=false;
 const p={body,_dash:{allowGravity:true},_dashCoastUntil:2000};
 const wallScene={_mapObjects:[{body:{left:50,right:52,top:-100,bottom:1000}}]};
 body.prev.set(30,0);body.newVelocity.set(0,0);
 exported.protectDashMotion(wallScene,p,1000,1/60);assert.equal(body.allowGravity,true);
 assert.equal(p._dash.wallContact,true);
 p._dash=null;
 for(let i=0;i<30;i++) {
  body.resetFlags();body.update(1/60);exported.protectDashMotion(wallScene,p,1016+i*16,1/60);
  assert.ok(body.velocity.y>0);
 }
 assert.ok(body.y>50);assert.ok(body.velocity.y>150);
});

function dashVfxFixture() {
  const { EventEmitter } = require('node:events');
  const shapes = [], timers = [], delayed = [], sounds = [];
  const sprite = Object.assign(new EventEmitter(), {active:true, visible:true, alpha:1,
    x:100, y:120, depth:30, texture:{key:'hero'}, frame:{name:'idle00'},
    originX:0.5, originY:0.5, scaleX:1, scaleY:1, flipX:false});
  function shape(type) {
    const s = {type, lines:[], destroyed:false, destroy(){this.destroyed=true;}};
    for (const method of ['setOrigin','setScale','setFlipX','setTint','setAlpha','setDepth','setRotation','lineStyle','strokeEllipse']) s[method]=()=>s;
    s.setRotation=angle=>{s.rotation=angle;return s;};
    s.setPosition=(x,y)=>{s.x=x;s.y=y;return s;};
    s.lineBetween=(...args)=>{s.lines.push(args);return s;};
    shapes.push(s); return s;
  }
  const scene = {_localPlayerAudioSprite:{active:true,x:100,y:120},
    events:new EventEmitter(), add:{image:()=>shape('image'),graphics:()=>shape('graphics')},
    tweens:{add(){}}, sound:{play:(...args)=>sounds.push(args)}, time:{
      addEvent(config){const timer={...config,removed:false,remove(){this.removed=true;}};timers.push(timer);return timer;},
      delayedCall(ms,fn){delayed.push(fn);},
    }};
  return {scene,sprite,shapes,timers,delayed,sounds};
}
test('dash has an immediate visible cue at rest, trails actual motion, and stops on shutdown',()=>{
  const f=dashVfxFixture();
  exported.spawnDashEffect(f.scene,f.sprite,1,0);
  assert.equal(f.shapes.length,2, 'leading bow and afterimage exist before movement');
  f.timers[0].callback(); assert.equal(f.shapes.length,2, 'wall contact adds no false trail');
  f.sprite.x+=15; f.timers[0].callback();
  assert.equal(f.shapes.length,4);
  assert.ok(f.shapes[2].lines.every(line=>line.every(Number.isFinite)));
  f.sprite.x+=1000;f.timers[0].callback(); assert.equal(f.shapes.length,4);
  f.scene.events.emit('shutdown');assert.equal(f.timers[0].removed,true);
  assert.equal(f.sprite.listenerCount('destroy'),0);
  f.sprite.x+=15;f.timers[0].callback();assert.equal(f.shapes.length,4);
});
test('remote dash survives skipped snapshots and ignores duplicate, missing and older IDs',()=>{
  const f=dashVfxFixture(), tracker={};
  const present=(state,hidden=false)=>
    exported.presentRemoteDash(f.scene,f.sprite,state,tracker,hidden);
  present({dashSeq:4});assert.equal(f.sounds.length,0,'historical join baseline');
  present({dashSeq:6,dashX:1,dashY:0});assert.equal(f.sounds.length,1);
  assert.ok(Math.abs(f.sounds[0][1].volume-0.63)<1e-12);
  present({});present({dashSeq:2});present({dashSeq:6});present({dashSeq:NaN});
  assert.equal(f.sounds.length,1);
  present({dashSeq:7,dashX:0,dashY:-1},true);present({dashSeq:7});
  assert.equal(f.sounds.length,1,'hidden dash cannot leak or replay');
  f.scene._localPlayerAudioSprite.x=1000;
  present({dashSeq:8,dashX:0,dashY:-1});
  assert.equal(f.sounds.length,2);
  assert.ok(f.sounds[1][1].volume<0.3);
});
test('an invisible opponent dash remains audible without drawing its trail',()=>{
  const f=dashVfxFixture(),tracker={_lastDashSeq:1};
  f.sprite.visible=false;
  f.sprite._powerupInvisible=true;
  exported.presentRemoteDash(f.scene,f.sprite,{dashSeq:2,dashX:1,dashY:0},tracker);
  assert.equal(f.shapes.length,0);
  assert.equal(f.sounds.length,1);
  assert.ok(Math.abs(f.sounds[0][1].volume-0.63)<1e-12);
});
test('joining during an active dash plays once and sprite destruction stops trail',()=>{
  const f=dashVfxFixture(),tracker={},state={dashSeq:3,animation:'dashing',dashX:-1,dashY:0};
  exported.presentRemoteDash(f.scene,f.sprite,state,tracker);
  exported.presentRemoteDash(f.scene,f.sprite,state,tracker);
  assert.equal(f.sounds.length,1);
  f.sprite.emit('destroy');assert.equal(f.timers[0].removed,true);
  assert.equal(f.scene.events.listenerCount('shutdown'),0);
});


test('dash leading edge follows the rendered player and turns with actual travel',()=>{
  const f=dashVfxFixture();
  exported.spawnDashEffect(f.scene,f.sprite,1,0);
  const head=f.shapes[0];
  assert.equal(head.x,f.sprite.x);assert.equal(head.rotation,0);
  assert.ok(head.lines.some(([x1,,x2])=>x1>20 && x2>20), 'bow projects in front');
  f.sprite.y+=12;
  f.scene.events.emit('postupdate');
  assert.equal(head.y,f.sprite.y);assert.equal(head.rotation,Math.PI/2);
  f.delayed[0]();
  assert.equal(head.destroyed,true);
  assert.equal(f.scene.events.listenerCount('postupdate'),0);
});

test('straight-down dash has the boosted launch speed and vertical cap; diagonals stay normal', () => {
  for (const right of [false, true]) {
    const p = player(); let cap;
    p.setMaxVelocity = (x, y) => { cap = { x, y }; };
    exported.updateDash(scene, p, { pressed: true, down: true, right, now: 1000 });
    const expected = right ? physics.dashSpeed : physics.dashDownSpeed;
    assert.ok(Math.abs(Math.hypot(p.body.velocity.x, p.body.velocity.y) - expected) < 1e-9);
    assert.equal(cap.x, physics.dashMaxSpeed);
    assert.equal(cap.y, right ? physics.dashMaxSpeed : physics.dashDownSpeed);
    const bot = { isAlive: true, grounded: false };
    const direction = dashDirection(false, right, false, true);
    require('../src/server/core/bots/physics').startDash(bot, direction, 1000);
    assert.equal(bot.vy, p.body.velocity.y);
  }
});
