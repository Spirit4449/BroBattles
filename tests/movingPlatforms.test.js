const test=require('node:test');
const assert=require('node:assert/strict');
const {clone,validateMap,geometryFromMap,constrainPoint}=require('../src/shared/maps/mapDocument');
const motionRules=require('../src/shared/maps/platformMotion');
const {motionOffset,motionPeakSpeed,advanceGeometry,staticGeometry,MOTION_DEFAULTS,PLATFORM_STEP_UP_PX}=motionRules;
const {tickMovingPlatforms}=require('../src/server/core/gameRoom/movingPlatforms');
const {bounds,stepBody,forecastGeometry,carryOnPlatforms}=require('../src/server/core/bots/physics');
const {standOn,previewManeuver}=require('../src/server/core/bots/navigation');
const {findGroundSpan,holdDuckGround}=require('../src/shared/physics/ducking');
const {createArena,loadDash}=require('./helpers/arcadePlatforms');
const {makeRoom}=require('./helpers/botRoom');
const defaults=require('../src/shared/maps').mapDefaults;

// A map whose first platform that no spawn uses moves with `motion`.
function movingMap(motion){
 const map=clone(defaults[0]);
 const anchored=new Set(JSON.stringify(map.spawns).match(/"anchorId":"[^"]+"/g).map(s=>s.slice(12,-1)));
 const platform=map.layout.platforms.find(p=>!anchored.has(p.id));
 platform.motion={...MOTION_DEFAULTS,...motion};
 return {map,platform};
}

test('a platform travels to its far end, dwells, and returns on a fixed cycle',()=>{
 const motion={axis:'x',distance:-200,speed:100,ease:'sine',pauseMs:500,phase:0};
 assert.deepEqual(motionOffset(motion,0),{x:0,y:0});
 assert.equal(motionOffset(motion,2000).x,-200);
 assert.equal(motionOffset(motion,2400).x,-200,'holds at the far end during the pause');
 assert.ok(Math.abs(motionOffset(motion,3500).x+100)<1e-9,'halfway back');
 assert.deepEqual(motionOffset(motion,5000),{x:0,y:0});
 assert.equal(motionOffset(motion,5000*7+2000).x,-200,'the cycle repeats');
 assert.equal(motionOffset({...motion,phase:2000/5000},0).x,-200,'phase staggers the cycle');
 assert.equal(motionOffset({...motion,axis:'y'},2000).y,-200);
 const linear={...motion,ease:'linear'};
 assert.ok(Math.abs(motionPeakSpeed(linear)-100)<1e-6);
 for(const ease of motionRules.MOTION_EASES.filter(e=>e!=='linear'))assert.ok(motionPeakSpeed({...motion,ease})>100,`${ease} peaks above the average speed`);
});

test('moving platforms validate their motion and never support spawns',()=>{
 const {map,platform}=movingMap({axis:'y',distance:160});
 assert.deepEqual(validateMap(map),[]);
 for(const [field,value] of [['axis','z'],['ease','bounce'],['distance',3],['speed',0],['phase',2]]){
  const bad=clone(map);bad.layout.platforms.find(p=>p.id===platform.id).motion[field]=value;
  assert.ok(validateMap(bad).some(e=>e.includes('.motion.')),`${field}=${value} is rejected`);
 }
 const anchored=clone(map);anchored.spawns.players.team1[0].anchorId=platform.id;
 assert.ok(validateMap(anchored).some(e=>e.includes('cannot anchor to a moving platform')));
 const point=constrainPoint(map,map.spawns.players.team1[0],platform.x,platform.y-40);
 assert.notEqual(point.anchorId,platform.id,'spawn snapping skips moving platforms');
});

test('geometry advances moving colliders in place and plans bots over static ones',()=>{
 const {map,platform}=movingMap({axis:'x',distance:120,speed:60,ease:'linear',pauseMs:0});
 const geometry=geometryFromMap(map);const collider=geometry.anchors[platform.id];
 assert.deepEqual(geometry.movingColliders,[collider]);
 assert.ok(Math.abs(geometry.platformSpeed.x-60)<1e-6);assert.equal(geometry.platformSpeed.y,0);
 const rest={left:collider.left,top:collider.top};
 assert.deepEqual(advanceGeometry(geometry,0),[]);
 const [move]=advanceGeometry(geometry,1000);
 assert.equal(move.collider,collider);assert.equal(move.dx,60);assert.equal(move.dy,0);
 assert.equal(collider.left,rest.left+60);assert.equal(collider.top,rest.top);
 assert.equal(collider.right-collider.left,collider.base.right-collider.base.left);
 const fixed=staticGeometry(geometry);
 assert.ok(!fixed.colliders.includes(collider));assert.equal(staticGeometry(geometry),fixed);
 assert.equal(staticGeometry(geometryFromMap(defaults[0])).colliders.length,geometryFromMap(defaults[0]).colliders.length);
});

test('the server carries a bot riding a moving platform and it stays grounded',()=>{
 const {room,players:[bot]}=makeRoom();
 const {map,platform}=movingMap({axis:'y',distance:-100,speed:100,ease:'linear',pauseMs:0});
 room.geometry=geometryFromMap(map,1);
 const collider=room.geometry.anchors[platform.id];
 tickMovingPlatforms(room,0);
 Object.assign(bot,standOn(collider,bot.char_class,(collider.left+collider.right)/2),{isAlive:true});
 const x=bot.x;
 for(let t=16;t<=480;t+=16){
  tickMovingPlatforms(room,t);
  stepBody(bot,{direction:0},room.geometry,16,t);
  assert.ok(bot.grounded&&bot.platformId===platform.id,`grounded on the platform at ${t}ms`);
 }
 assert.ok(Math.abs(bounds(bot).bottom-collider.top)<0.2);
 assert.ok(Math.abs(collider.top-(collider.base.top-48))<1e-9);
 assert.ok(Math.abs(bot.x-x)<1e-9,'vertical motion does not slide the rider');
});

test('players ride moving platforms in both directions without drifting',()=>{
 for(const motion of [{axis:'y',distance:-200,speed:120,ease:'sine',pauseMs:0,phase:0},{axis:'x',distance:300,speed:150,ease:'cubic',pauseMs:200,phase:0}]){
  const arena=createArena(),platform=arena.platform(500,500,200,20,motion),player=arena.player(500,450);
  arena.frame();arena.frame();
  const offset=player.x-platform.x;
  for(let i=0;i<400;i++){
   arena.frame();
   assert.ok(Math.abs(player.body.bottom-platform.body.top)<0.01,`${motion.axis} rider stays on the surface`);
   assert.ok(Math.abs(player.x-platform.x-offset)<0.01,`${motion.axis} rider keeps its footing`);
  }
 }
});

test('a rising platform never carries a player through a ceiling',()=>{
 const arena=createArena();
 const lift=arena.platform(500,500,200,20,{axis:'y',distance:-260,speed:120,ease:'linear',pauseMs:0,phase:0});
 const ceiling=arena.platform(500,300,300,20),floor=arena.platform(500,700,600,40),player=arena.player(500,450);
 let passed=false;
 for(let i=0;i<300;i++){arena.frame();passed||=lift.body.top<ceiling.body.bottom;assert.ok(player.body.top>=ceiling.body.bottom-0.01,`frame ${i}: below the ceiling`);}
 assert.ok(passed,'the lift rose past the ceiling');
 assert.ok(Math.abs(player.body.bottom-floor.body.top)<0.01,'squeezed out, the player drops to the floor instead');
});

test('moving platforms push players they run into, and pass through players they would crush',()=>{
 {
  const arena=createArena(),floor=arena.platform(500,600,800,40);
  const block=arena.platform(200,540,100,40,{axis:'x',distance:500,speed:100,ease:'linear',pauseMs:0,phase:0});
  const player=arena.player(500,530);
  for(let i=0;i<300;i++)arena.frame();
  assert.ok(player.body.left>=block.body.right-0.01,'pushed ahead of the block');
  assert.ok(Math.abs(player.body.bottom-floor.body.top)<0.01);
 }
 {
  const arena=createArena(),floor=arena.platform(500,600,800,40),wall=arena.platform(620,500,40,200);
  const block=arena.platform(200,540,100,40,{axis:'x',distance:400,speed:100,ease:'linear',pauseMs:0,phase:0});
  const player=arena.player(500,530);
  let passed=false;
  for(let i=0;i<300;i++){arena.frame();passed||=block.body.right>player.body.right;assert.ok(player.body.right<=wall.body.left+0.01,'never shoved into the wall');}
  assert.ok(passed,'the block passed through the trapped player');
 }
 {
  const arena=createArena(),floor=arena.platform(500,600,800,40);
  arena.platform(500,300,200,20,{axis:'y',distance:260,speed:100,ease:'linear',pauseMs:0,phase:0});
  const player=arena.player(500,540);
  for(let i=0;i<300;i++){arena.frame();assert.ok(Math.abs(player.body.bottom-floor.body.top)<0.01,'not crushed into the floor');}
 }
});

const rising={axis:'y',distance:-200,speed:150,ease:'linear',pauseMs:0,phase:0};
const sinking={axis:'y',distance:200,speed:150,ease:'linear',pauseMs:0,phase:0};
const sideways={axis:'x',distance:200,speed:150,ease:'linear',pauseMs:0,phase:0};

test('the sides of moving platforms are walls, never a lift onto the top or under',()=>{
 for(const [name,motion] of [['rising',rising],['sinking',sinking]]){
  const arena=createArena(),floor=arena.platform(500,640,1400,40);
  const platform=arena.platform(600,560,120,120,motion),player=arena.player(460,580);
  // Until the platform turns back (200 px at 150 px/s).
  for(let i=0;i<75;i++){
   player.body.velocity.x=200;arena.frame();
   // Stepping onto a top that passes within a stair's height of the feet is fine.
   assert.ok(floor.body.top-player.body.bottom<=PLATFORM_STEP_UP_PX,`${name} frame ${i}: never lifted onto the top`);
   assert.ok(player.body.bottom<=floor.body.top+0.01,`${name} frame ${i}: never pushed under`);
   const beside=player.body.bottom>platform.body.top+0.5&&player.body.top<platform.body.bottom-0.5;
   if(beside)assert.ok(player.body.right<=platform.body.left+0.01,`${name} frame ${i}: stopped at the side`);
  }
 }
 // A step fast enough to end inside a side is stopped at that side, not lifted or dropped.
 for(const [name,motion] of [['rising',rising],['sinking',sinking]]){
  const arena=createArena(),platform=arena.platform(600,400,120,120,motion),player=arena.player(600,400);
  arena.frame();
  player.setPosition(platform.body.left-21,platform.body.top+60);player.body.updateFromGameObject();
  player.body.allowGravity=false;player.body.maxVelocity.x=6000;player.body.velocity.x=1800;
  const top=player.body.top;
  arena.frame();
  assert.ok(player.body.right<=platform.body.left+0.01,`${name}: pushed out of the side it was nearest`);
  assert.ok(Math.abs(player.body.top-top)<1,`${name}: not moved vertically beyond gravity`);
 }
});

test('dashing up into a moving platform bonks, and only steps on when the feet clear the top',()=>{
 const dash=loadDash();
 const run=(motion,{x,platformY=420,dashX=0,dashY=-560,frames=80})=>{
  const arena=createArena(),floor=arena.platform(500,640,1400,40);
  const platform=arena.platform(600,platformY,120,40,motion),player=arena.player(x,580);
  let now=1e6,highest=Infinity,landedOn=false;
  for(let i=0;i<frames;i++){
   now+=1000/60;
   if(i===3){player._dash={allowGravity:true};player._dashCoastUntil=now+400;}
   if(i===12)player._dash=null;
   // The scene update sets dash velocity before the physics step integrates it.
   if(player._dash){player.body.velocity.x=dashX;player.body.velocity.y=dashY;}
   // Steer like a player: stop drifting once above the platform.
   else if(dashX&&player.body.left>platform.body.left)player.body.velocity.x=0;
   arena.frame({afterStep:()=>dash.protectDashMotion(arena.scene,player,now,1/60)});
   const b=player.body,p=platform.body;
   const overlapping=b.right>p.left+0.5&&b.left<p.right-0.5;
   if(overlapping)highest=Math.min(highest,b.top);
   // A platform descending onto a player on the floor passes through them (no crush).
   assert.ok(platform._passThrough?.has(player)||!(overlapping&&b.bottom>p.top+0.5&&b.top<p.bottom-0.5),`frame ${i}: never inside the platform`);
   landedOn||=overlapping&&Math.abs(b.bottom-p.top)<0.01;
  }
  return {player,floor,platform,landedOn};
 };
 for(const [name,motion] of [['rising',rising],['sinking',sinking],['sideways',sideways]]){
  const under=run(motion,{x:600});
  assert.ok(!under.landedOn,`${name}: a dash from underneath never lands on top`);
  assert.ok(Math.abs(under.player.body.bottom-under.floor.body.top)<0.01,`${name}: falls back down`);
 }
 // A diagonal dash that clears the edge gets you on.
 for(const [name,motion] of [['rising',rising],['sinking',sinking],['sideways',sideways]]){
  assert.ok(run({...motion,speed:40},{x:430,platformY:560,dashX:396,dashY:-396,frames:100}).landedOn,`${name}: lands on top`);
 }
});

test('ducking on a moving platform follows it, never hovers, and still guards its edges',()=>{
 const scenarios=[['y',0],['y',55],['x',0],['x',-55],['x',55]];
 for(const [axis,walk] of scenarios){
  const arena=createArena();
  const platform=arena.platform(500,500,200,20,{axis,distance:axis==='x'?300:-200,speed:150,ease:'sine',pauseMs:0,phase:0});
  const player=arena.player(500,450);
  arena.frame();arena.frame();
  let span=findGroundSpan(player.body,arena.scene._mapObjects);
  for(let i=0;i<300;i++){
   player.body.velocity.x=walk;
   arena.frame({afterStep:()=>{if(player.body.velocity.y>=0)span=holdDuckGround(player.body,span,arena.scene._mapObjects)?.span||null;}});
   const b=player.body,p=platform.body,centre=(b.left+b.right)/2;
   assert.ok(span,`${axis}/${walk} frame ${i}: still guarded`);
   assert.ok(Math.abs(b.bottom-p.top)<0.01&&centre>=p.left-0.01&&centre<=p.right+0.01,`${axis}/${walk} frame ${i}: standing on the platform, not hovering`);
  }
 }
 // Ground that leaves releases the guard instead of holding the player up.
 const arena=createArena(),player=arena.player(500,450),platform=arena.platform(500,500,200,20);
 arena.frame();
 const span=findGroundSpan(player.body,arena.scene._mapObjects);
 platform.setPosition(800,500);platform.body.updateFromGameObject();
 assert.equal(holdDuckGround(player.body,span,arena.scene._mapObjects),null);
});

test('leaving a moving platform gives no extra speed',()=>{
 const arena=createArena(),platform=arena.platform(300,500,200,20,{axis:'x',distance:600,speed:150,ease:'linear',pauseMs:0,phase:0});
 const player=arena.player(300,450);
 for(let i=0;i<20;i++)arena.frame();
 const x=player.x;
 player.body.velocity.y=-400;
 for(let i=0;i<20;i++){arena.frame();assert.equal(player.x,x,'a straight-up jump keeps its own x');}
});

test('an open underside is passed through, never turned into a shove out of a side',()=>{
 for(const motion of [{axis:'x',distance:150,speed:20,ease:'linear',pauseMs:0,phase:0},{axis:'y',distance:-100,speed:40,ease:'linear',pauseMs:0,phase:0}]){
  for(const [jump,landsOnTop] of [[-520,false],[-640,true]]){
   const arena=createArena(),floor=arena.platform(500,640,1400,40);
   const platform=arena.platform(600,470,200,40,motion);
   Object.assign(platform.body.checkCollision,{up:true,down:false,left:true,right:true});
   const player=arena.player(600,580);
   arena.frame();
   player.body.velocity.y=jump;
   // Riding the slow platform after landing moves a fraction of a pixel a frame.
   for(let i=0;i<120;i++){const x=player.x;arena.frame();assert.ok(Math.abs(player.x-x)<1,`${motion.axis} ${jump} frame ${i}: no sideways shove`);}
   const ground=landsOnTop?platform.body.top:floor.body.top;
   assert.ok(Math.abs(player.body.bottom-ground)<0.01,`${motion.axis} ${jump}: ${landsOnTop?'lands on top':'falls back to the floor'}`);
  }
 }
 // A sideways platform with open sides slides past a player without pushing.
 const arena=createArena(),floor=arena.platform(500,640,1400,40);
 const block=arena.platform(300,560,100,80,{axis:'x',distance:500,speed:150,ease:'linear',pauseMs:0,phase:0});
 Object.assign(block.body.checkCollision,{left:false,right:false});
 const player=arena.player(500,580);
 for(let i=0;i<150;i++){arena.frame();assert.equal(player.x,500);}
});

test('remote riders drawn in the past are shifted onto the platform they ride',()=>{
 const arena=createArena();
 arena.platform(500,400,200,20,{axis:'x',distance:100,speed:100,ease:'linear',pauseMs:0,phase:0});
 const remote=arena.player(560,350,40,60);
 arena.runtime.advanceMovingPlatforms(arena.scene,500);
 assert.deepEqual({...arena.runtime.remoteRideOffset(arena.scene,remote,560,360,400,500)},{x:10,y:0});
 assert.deepEqual({...arena.runtime.remoteRideOffset(arena.scene,remote,560,200,400,500)},{x:0,y:0},'an airborne remote is left alone');
});

test('bot predictions see platforms where they will be, not where they are',()=>{
 const {map,platform}=movingMap({axis:'x',distance:300,speed:150,ease:'linear',pauseMs:0,phase:0});
 const geometry=geometryFromMap(map,1),collider=geometry.anchors[platform.id];
 advanceGeometry(geometry,0);
 const bot={...standOn(collider,'ninja',(collider.left+collider.right)/2),isAlive:true};
 const forecast=forecastGeometry(geometry);
 for(let i=0;i<60;i++){forecast.step(bot,i*16);stepBody(bot,{direction:0},forecast.geometry,16,i*16);}
 assert.equal(collider.left,collider.base.left,'forecasting never moves the live platform');
 assert.ok(bot.grounded&&bot.platformId===platform.id,'the predicted rider stays on');
 assert.ok(Math.abs(bot.x-standOn(collider,'ninja',(collider.left+collider.right)/2).x-150*59*16/1000)<0.01,'and travels with it');
 // A hop straight up from a sideways platform gains no speed from it.
 const sideways=movingMap({axis:'x',distance:300,speed:150,ease:'linear',pauseMs:0,phase:0});
 const sideGeometry=geometryFromMap(sideways.map,1),sideCollider=sideGeometry.anchors[sideways.platform.id];
 advanceGeometry(sideGeometry,0);
 const rider={...standOn(sideCollider,'ninja',(sideCollider.left+sideCollider.right)/2),isAlive:true};
 const ride=forecastGeometry(sideGeometry);
 for(let i=0;i<4;i++){ride.step(rider,i*16);stepBody(rider,{direction:0},ride.geometry,16,i*16);}
 const sideHop=previewManeuver(rider,{direction:0,jumpPressed:true},ride.geometry,{},64);
 assert.ok(!sideHop||Math.abs(sideHop.end.x-rider.x)<1,'lands where it jumped, or not at all');
 // A hop from a rising platform lands back on it, higher than it left.
 const lift=movingMap({axis:'y',distance:-200,speed:150,ease:'linear',pauseMs:0,phase:0});
 const liftGeometry=geometryFromMap(lift.map,1),liftCollider=liftGeometry.anchors[lift.platform.id];
 advanceGeometry(liftGeometry,0);
 const start=standOn(liftCollider,'ninja',(liftCollider.left+liftCollider.right)/2);
 const hop=previewManeuver(start,{direction:0,jumpPressed:true},liftGeometry,{},0);
 assert.ok(hop&&hop.end.platformId===lift.platform.id&&hop.end.y<start.y-60);
});

test('bots inside a moving platform leave it like a wall, not over the top',()=>{
 const {map,platform}=movingMap({axis:'y',distance:-200,speed:150,ease:'linear',pauseMs:0,phase:0});
 const geometry=geometryFromMap(map,1),collider=geometry.anchors[platform.id];
 advanceGeometry(geometry,0);
 const bot={...standOn(collider,'ninja',collider.left),isAlive:true,grounded:false,platformId:null};
 const b0=bounds(bot);bot.x-=b0.right-collider.left-8;bot.y+=(collider.bottom-collider.top)/2+(b0.bottom-b0.top)/2;
 const before=bounds(bot);
 // It began its last step outside the platform's left side.
 bot._platformStepStart={...before,left:before.left-10,right:before.right-10};
 const moved=advanceGeometry(geometry,16);
 const fromBelow={...bot,_platformStepStart:{...before,top:collider.bottom+2,bottom:collider.bottom+2+before.bottom-before.top}};
 carryOnPlatforms(bot,moved,geometry.colliders);
 const after=bounds(bot);
 assert.ok(after.right<=collider.left+0.01,'out of the side');
 assert.equal(after.top,before.top,'not lifted');
 // Coming up through an open underside is not a side hit.
 collider.collision={...collider.collision,down:false};
 const start=bounds(fromBelow);
 carryOnPlatforms(fromBelow,advanceGeometry(geometry,32),geometry.colliders);
 assert.equal(bounds(fromBelow).left,start.left,'not shoved sideways');
});

test('bots on a moving map keep their footing and step off moving platforms onto static ground',t=>{
 let now=1e6;t.mock.method(Date,'now',()=>now);t.mock.method(console,'log',()=>{});
 const {map,platform}=movingMap({axis:'x',distance:200,speed:90,ease:'sine',pauseMs:300,phase:0});
 const h=makeRoom({characters:['ninja','wizard'],trophies:0,seed:5,mapData:map});
 t.after(()=>h.room.cleanup());
 const [bot,other]=h.players,brain=h.room.botControllers.get(bot.participantId);
 other.isAlive=false;
 const collider=h.room.geometry.anchors[platform.id];
 h.tick(now);
 h.place(bot,(collider.left+collider.right)/2,collider);
 let left=false;
 for(let i=0;i<600&&!left;i++){now+=1000/60;h.tick(now);left=bot.grounded&&bot.platformId!==platform.id;}
 assert.ok(left,'the bot hopped off onto static ground');
 assert.equal(brain.metrics.falls,0);
 assert.ok(brain.metrics.rideExits>=1);
});
