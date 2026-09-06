const test=require('node:test'),assert=require('node:assert/strict');
const {makeRoom}=require('./helpers/botRoom');
const combat=require('../src/server/core/gameRoom/ninjaCombat');
const model=require('../src/shared/ninjaProjectile');
function fixture(t,isBot=false){
  const f=makeRoom({characters:['ninja','wizard']});t.after(()=>f.room.cleanup());
  const [p,target]=f.players;Object.assign(p,{x:100,y:200,isBot,connected:true});
  Object.assign(target,{x:350,y:192,_bodyHalfWidth:20,_bodyHalfHeight:40,_bodyCenterOffsetX:0,_bodyCenterOffsetY:0,connected:true});
  f.room.geometry={...f.room.geometry,colliders:[]};f.room._tickId=0;f.room._simulationMono=0;
  f.step=(count=1)=>{for(let i=0;i<count;i++){f.room._tickId++;f.room._simulationMono+=model.STEP_MS;combat.tick(f.room);}};
  f.actions=type=>f.events.filter(e=>e.type==='game:action'&&e.payload.action.type===type).map(e=>e.payload.action);
  return f;
}
test('basic requests use canonical tuning and consume ammo once, for humans and bots',t=>{
  for(const bot of [false,true]){const f=fixture(t,bot),p=f.players[0];
    const request={type:'ninja-shuriken',id:'shot',angle:0,x:-999,forwardDistance:99999,damage:99999};
    assert.equal(f.room.handlePlayerAction(p.participantId,request),true);assert.equal(p.ammoState.charges,0);
    assert.equal(f.room.handlePlayerAction(p.participantId,request),true);
    assert.equal(f.room.handlePlayerAction(p.participantId,{...request,id:'second'}),false);
    f.step();const q=[...f.room._ninja.active.values()][0].projectile;
    assert.equal(q.x,130);assert.equal(q.y,192);assert.equal(q.cfg.forwardDistance,500);
    assert.equal(f.room._ninja.active.size,1);
  }
});
test('client hit and map-return claims cannot create damage or change phase',t=>{
  const f=fixture(t),[p,target]=f.players,hp=target.health;
  f.room.handleHit(p.participantId,{attacker:p.name,target:target.name,instanceId:'fake',attackType:'basic'});
  assert.equal(target.health,hp);
  f.room.handlePlayerAction(p.participantId,{type:'ninja-shuriken',id:'shot',angle:0});f.step();
  assert.equal(f.room.handlePlayerAction(p.participantId,{type:'ninja-shuriken-return',id:'shot'}),false);
  assert.equal([...f.room._ninja.active.values()][0].projectile.phase,'outward');
});
test('registered contact damages despite moving shooter, once per leg',t=>{
  const f=fixture(t),[p,target]=f.players,hp=target.health;
  f.room.handlePlayerAction(p.participantId,{type:'ninja-shuriken',id:'shot',angle:0});f.step();p.x=1900;p._posHistory=[];
  f.step(24);assert.equal(target.health,hp-p.baseDamage);
  assert.equal(f.actions('ninja-impact').length,1);
  f.step(10);assert.equal(target.health,hp-p.baseDamage);
});
test('thin terrain turns both human and bot shurikens back before targets behind it',t=>{
  for(const bot of [false,true]){const f=fixture(t,bot),[p,target]=f.players,hp=target.health;
    f.room.geometry={...f.room.geometry,colliders:[{left:220,right:221,top:0,bottom:500}]};
    f.room.handlePlayerAction(p.participantId,{type:'ninja-shuriken',id:'wall',angle:0});f.step(20);
    assert.equal(target.health,hp);
    const q=[...f.room._ninja.active.values()][0]?.projectile;
    assert.ok(q?.phase==='return'||f.actions('ninja-terminal').some(a=>a.reason==='returned'));
  }
});
test('return refunds ammunition exactly once, and reload still advances',t=>{
  const f=fixture(t),p=f.players[0];f.players[1].loaded=false;
  f.room.geometry={...f.room.geometry,colliders:[{left:170,right:171,top:0,bottom:500}]};
  f.room.handlePlayerAction(p.participantId,{type:'ninja-shuriken',id:'return',angle:0});f.step(40);
  assert.equal(f.actions('ninja-terminal').filter(a=>a.reason==='returned').length,1);
  assert.equal(p.ammoState.charges,1);assert.equal(p.ammoState.nextFireInMs,0);
  f.step(60);assert.equal(p.ammoState.charges,1);
});
test('human and bot supers share staggered projectiles without browser damage claims',t=>{
  for(const bot of [false,true]){const f=fixture(t,bot),p=f.players[0];f.players[1].loaded=false;p.superCharge=p.maxSuperCharge;
    assert.equal(combat.request(f.room,p,{id:'super',aim:{angle:0}},true),true);
    assert.equal(p.superCharge,0);f.step(35);
    assert.equal(f.actions('ninja-launch').length,model.swarmConfig().count);
    assert.ok([...f.room._ninja.active.values()].every(e=>e.projectile.special));
  }
});
test('death cancels staggered casts and active flight; reconnect carries terminal records',t=>{
  const f=fixture(t),p=f.players[0];p.superCharge=p.maxSuperCharge;
  combat.request(f.room,p,{id:'super',aim:{angle:0}},true);f.step();p.isAlive=false;f.step(40);
  assert.equal(f.room._ninja.active.size,0);assert.equal(f.room._ninja.pending.length,0);
  const state=combat.bootstrap(f.room);assert.equal(state.active.length,0);assert.ok(state.terminals.length>0);
});
test('shared flight is identical across render rates and swept segments do not tunnel',()=>{
  const terrain=[{left:270,right:271,top:-500,bottom:500}],owner={x:100,y:200};
  const reference=model.launch(owner,-.2,'shot');for(let i=0;i<90;i++)model.step(reference,owner,terrain);
  for(const hz of [30,60,120,240]){const q=model.launch(owner,-.2,'shot');let at=0;
    for(let frame=1;frame<=hz*1.5;frame++)while(at+model.STEP_MS<=frame*1000/hz+1e-7){model.step(q,owner,terrain);at+=model.STEP_MS;}
    assert.deepEqual(q,reference);
  }
});

test('shielded contacts cannot grant damage or charge, and vault contacts use registered flight',t=>{
  const f=fixture(t),[p,target]=f.players,hp=target.health;
  require('../src/server/core/gameRoom/effects/effectManager').apply(target,'respawnShield',Date.now(),{durationMs:3000},f.room);
  f.room.handlePlayerAction(p.participantId,{type:'ninja-shuriken',id:'shield',angle:0});f.step(25);
  assert.equal(target.health,hp);assert.equal(p.superCharge,0);
  assert.ok(f.actions('ninja-impact').every(a=>a.appliedDamage===0));
  target.loaded=false;
  const vault={x:450,y:192,width:80,height:80,health:10000};
  f.room.gameMode={getVaultState:team=>team==='team2'?vault:null,damageVault:(team,damage)=>{vault.health-=damage;return vault;}};
  p.ammoState.charges=1;p.ammoState.nextFireInMs=0;
  f.room.handlePlayerAction(p.participantId,{type:'ninja-shuriken',id:'vault',angle:0});f.step();p.x=2000;p._posHistory=[];
  f.step(22);assert.ok(vault.health<10000);
});

test('wall returns occur on the collider surface, without the player-hit radius gap',()=>{
  for(const direction of [1,-1])for(const special of [false,true]){
    const owner={x:500,y:200},q=model.launch(owner,direction===1?0:Math.PI,'touch',special?7:null);
    const wall=direction===1?{left:700,right:701,top:-500,bottom:500}:{left:299,right:300,top:-500,bottom:500};
    let contact;
    for(let i=0;i<60&&!contact;i++)contact=model.step(q,owner,[wall]).find(s=>s.terrain);
    assert.ok(contact,'swept path detects a one-pixel wall');
    assert.equal(q.phase,'return');
    assert.ok(Math.abs(q.x-(direction===1?wall.left:wall.right))<1e-9,'center reaches the actual surface');
  }
});

test('shurikens damage disconnected targets but disconnected shooters cannot attack',t=>{
  const f=fixture(t),[p,target]=f.players,hp=target.health;
  target.connected=false; target.socketId=null;
  f.room.handlePlayerAction(p.participantId,{type:'ninja-shuriken',id:'offline-target',angle:0});
  f.step(25);
  assert.equal(target.health,hp-p.baseDamage);
  p.connected=false;
  assert.equal(f.room.handlePlayerAction(p.participantId,{type:'ninja-shuriken',id:'offline-shooter',angle:0}),false);
});
