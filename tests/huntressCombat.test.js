const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRoom } = require('./helpers/botRoom');
const combat = require('../src/server/core/gameRoom/huntressCombat');
const model = require('../src/shared/huntressProjectile');
const { characterBody, getDuelGeometry } = require('../src/shared/duelGeometry');
const { HuntressReplica, CombatClock } = require('../src/shared/huntressReplication');

function fixture(t, map = 1) {
  const f = makeRoom({ characters: ['huntress', 'ninja'], map });
  f.room.huntressCombatVersion = 2;
  f.room._simulationMono = 10000;
  f.room._tickId = 0;
  f.room.geometry = { ...f.room.geometry, colliders: [] };
  for (const [i, p] of f.players.entries()) {
    Object.assign(p, { x: 100 + 500 * i, y: 200, _bodyHalfWidth: 30, _bodyHalfHeight: 60,
      _bodyCenterOffsetX: 0, _bodyCenterOffsetY: 0, connected: true });
    p.isBot = false; // Exercise the previously browser-authoritative path.
  }
  f.step = (n = 1) => { for (let i = 0; i < n; i++) {
    f.room._tickId++; f.room._simulationMono += model.STEP_MS; combat.tick(f.room);
  } };
  f.actions = type => f.events.filter(e => e.type === 'game:action' && e.payload.action.type === type).map(e => e.payload.action);
  t.after(() => f.room.cleanup());
  return f;
}

test('human and bot launches share canonical tuning, windup, muzzle and ammunition', t => {
  for (const isBot of [false, true]) {
    const { room, players: [p], step, actions } = fixture(t);
    p.isBot = isBot;
    const initial = p.ammoState.charges;
    const data = { type: 'huntress-arrow', id: 'shot', angle: 0, power: 0.5,
      start: { x: -999, y: -999 }, speed: 99999, gravity: 0, count: 99, damage: 99999 };
    assert.equal(room.handlePlayerAction(p.participantId, data), true);
    room.handlePlayerAction(p.participantId, data);
    assert.equal(p.ammoState.charges, initial - 1);
    step(5); assert.equal(room._huntress.active.size, 0);
    step(); assert.equal(room._huntress.active.size, 3);
    assert.equal(actions('huntress-projectiles').length, 1);
    const center = actions('huntress-projectiles')[0].projectiles[1], body = characterBody('huntress');
    assert.equal(center.x, p.x + body.displayWidth * model.attackConfig().forwardOffset);
    assert.equal(center.y, p.y - body.displayHeight * model.attackConfig().verticalOffset);
    assert.equal(center.vx, model.resolveShot({angle:0,power:0.5}).speed);
    assert.equal(center.gravity, model.attackConfig().gravity);
    const replica = new HuntressReplica(); replica.launch(center);
    assert.deepEqual(replica.active.get(center.id).projectile, center);
  }
});

test('forged client hits/releases, invalid power, cooldown and uncharged specials are rejected', t => {
  const { room, players: [p, target], actions } = fixture(t);
  const hp = target.health;
  room.handleHit(p.participantId, { attacker: p.name, target: target.name, attackType: 'huntress-arrow', instanceId: 'forged' });
  room.handlePlayerAction(p.participantId, { type: 'huntress-arrow-release', id: 'forged' });
  assert.equal(target.health, hp); assert.equal(room._huntress.active.size, 0);
  assert.equal(room.handlePlayerAction(p.participantId, { type: 'huntress-arrow', id: 'bad', angle: 0, power: 1.1 }), false);
  assert.equal(room.requestSpecial(p.participantId, { id: 'special', aim: { angle: 0 } }), false);
  assert.equal(room.handlePlayerAction(p.participantId, { type: 'huntress-arrow', id: 'ok', angle: 0 }), true);
  assert.equal(room.handlePlayerAction(p.participantId, { type: 'huntress-arrow', id: 'fast', angle: 0 }), false);
  assert.equal(actions('huntress-result').at(-1).reason, 'not-ready');
});

test('a registered arrow can damage after its shooter moves beyond legacy range; once only', t => {
  const { room, players: [p, target], step, actions } = fixture(t);
  room.handlePlayerAction(p.participantId, { type: 'huntress-arrow', id: 'range', angle: 0 });
  step(6);
  const arrow = [...room._huntress.active.values()][1];
  for (const [id, a] of room._huntress.active) if (a !== arrow) room._huntress.active.delete(id);
  p.x = 1900;
  target.x = arrow.x + 100; target.y = arrow.y;
  const before = target.health;
  step(20);
  assert.equal(target.health, before - 1000);
  assert.equal(room._huntress.active.size, 0);
  assert.equal(actions('huntress-terminal').length, 1);
  assert.equal(actions('huntress-terminal')[0].accepted, true);
  step(20); assert.equal(target.health, before - 1000);
});

test('swept player contact uses the same inset circle geometry, including thin targets and walls', () => {
  const bounds = model.insetBounds({ left: 270, right: 330, top: 140, bottom: 260 });
  assert.equal(model.firstContact({x:260,y:200},{x:260,y:200},16,[],[{name:'p',bounds}]), null);
  const target = { name:'p', bounds: {left:145,right:155,top:180,bottom:220} };
  assert.equal(model.firstContact({x:100,y:200},{x:200,y:200},4,[],[target]).target,'p');
  const wall = {left:180,right:181,top:0,bottom:500};
  assert.equal(model.firstContact({x:100,y:200},{x:200,y:200},4,[wall],[target]).reason,'target');
  assert.equal(model.firstContact({x:100,y:200},{x:200,y:200},4,[{...wall,left:120,right:121}],[target]).reason,'terrain');
  assert.equal(model.firstContact({x:100,y:200},{x:200,y:200},0,[target.bounds],[target]).reason,'terrain');
  // Rounded corners must not become square expanded hitboxes.
  assert.equal(model.sweep({x:130,y:165},{x:131,y:166},target.bounds,16),null);
});

test('confirmed arrows attach to the body even when their visual position trails far behind', () => {
  const body = { left: 300, right: 330, top: 220, bottom: 270 };
  assert.deepEqual(model.attachmentPoint({ x: 100, y: 190 }, body), { x: 300, y: 220 });
  assert.deepEqual(model.attachmentPoint({ x: 500, y: 240 }, body), { x: 330, y: 240 });
  assert.deepEqual(model.attachmentPoint({ x: 310, y: 250 }, body), { x: 310, y: 250 });
});

test('all shipped map colliders participate in point-based arrow contact', () => {
  for (const map of [1,2,3,4]) {
    const geometry = getDuelGeometry(map);
    assert.ok(geometry.colliders.length);
    for (const r of geometry.colliders) {
      const x=(r.left+r.right)/2;
      const hit=model.firstContact({x,y:r.top-5},{x,y:r.top+1},16,[r],[]);
      assert.equal(hit.reason,'terrain'); assert.ok(Math.abs(hit.y-r.top)<1e-8);
    }
  }
});

test('flight matches iterative 60 Hz simulation at every tick and is independent of render rate', () => {
  for (const special of [false,true]) {
    const p=model.createVolley({x:100,y:100,width:150,height:150},model.resolveShot({angle:-0.7,power:0.7},special),'shot',0)[1];
    let x=p.x,y=p.y,vy=p.vy;
    for(let tick=1;tick<=120;tick++) {
      vy+=p.gravity/60; x+=p.vx/60; y+=vy/60;
      const actual=model.sample(p,tick*model.STEP_MS);
      assert.ok(Math.hypot(actual.x-x,actual.y-y)<1e-7);
    }
    for (const hz of [30,60,120,144,240]) {
      let frame;
      for(let i=1;i<=hz;i++) frame=model.sample(p,i*1000/hz);
      assert.deepEqual(frame,model.sample(p,1000));
    }
  }
});

test('burning arrows consume charge once, apply burn once, and publish precise terminal metadata', t => {
  const { room,players:[p,target],step,actions }=fixture(t);
  p.superCharge=p.maxSuperCharge;
  assert.equal(room.requestSpecial(p.participantId,{id:'burn',aim:{angle:0}}),true);
  step(14);
  const arrow=[...room._huntress.active.values()][2];
  for(const [id,a] of room._huntress.active) if(a!==arrow) room._huntress.active.delete(id);
  target.x=arrow.x+40;target.y=arrow.y;
  step(10);
  assert.equal(p.superCharge,1);
  const terminal=actions('huntress-terminal')[0];
  assert.equal(terminal.appliedDamage,1000); assert.ok(terminal.targetOffset);
  assert.ok(Math.abs(terminal.targetOffset.x) <= target._bodyHalfWidth);
  assert.ok(target.effects.huntressBurn || target.activeEffects.huntressBurn);
});

test('owner death cancels pending and active arrows and bootstrap restores only active flight', t => {
  const {room,players:[p],step,actions}=fixture(t);
  room.handlePlayerAction(p.participantId,{type:'huntress-arrow',id:'death',angle:0});
  step(6);
  assert.equal(combat.bootstrap(room).projectiles.length,3);
  p.isAlive=false;step();
  assert.equal(combat.bootstrap(room).projectiles.length,0);
  assert.equal(combat.bootstrap(room).terminals.length,3);
  assert.ok(actions('huntress-terminal').every(a=>a.reason==='cancelled'));
});

test('shielded contact consumes the arrow without damage or super charge', t => {
  const {room,players:[p,target],step,actions}=fixture(t);
  require('../src/server/core/gameRoom/effects/effectManager').apply(target,'respawnShield',Date.now(),{durationMs:3000},room);
  room.handlePlayerAction(p.participantId,{type:'huntress-arrow',id:'shield',angle:0});step(6);
  const arrow=[...room._huntress.active.values()][1];
  for(const [id,a]of room._huntress.active)if(a!==arrow)room._huntress.active.delete(id);
  target.x=arrow.x+40;target.y=arrow.y;const hp=target.health;
  step(10);
  assert.equal(target.health,hp);assert.equal(p.superCharge,0);
  assert.equal(actions('huntress-terminal').length,1);
  assert.equal(actions('huntress-terminal')[0].accepted,true);
  assert.equal(actions('huntress-terminal')[0].appliedDamage,0);
});

test('vault contacts use authoritative flight even when the shooter has moved away', t => {
  const {room,players:[p,target],step,actions}=fixture(t,4);
  target.isAlive=false;
  const vault={x:500,y:300,width:100,height:100,health:10000};
  room.gameMode={getVaultState:()=>vault,damageVault(_team,damage){vault.health-=damage;return vault;}};
  room.handlePlayerAction(p.participantId,{type:'huntress-arrow',id:'vault',angle:0});step(6);
  const arrow=[...room._huntress.active.values()][1];
  for(const [id,a]of room._huntress.active)if(a!==arrow)room._huntress.active.delete(id);
  vault.x=arrow.x+50;vault.y=arrow.y;p.x=2200;step(10);
  assert.equal(vault.health,9000);
  assert.equal(actions('huntress-terminal')[0].target,'vault:team2');
});

test('the room feature flag is immutable and incompatible clients cannot join v2 rooms', async t => {
  const {room}=fixture(t);
  const {registerGameEvents}=require('../src/server/core/socketEvents/gameEvents');
  const handlers=new Map(),emitted=[];let joined=0;
  const socket={data:{user:{user_id:1,name:'human'}},on:(name,fn)=>handlers.set(name,fn),emit:(...args)=>emitted.push(args)};
  registerGameEvents(socket,{db:{},gameHub:{getGameRoom:()=>room,handlePlayerJoin:async()=>{joined++;return true;}}});
  let ack;
  await handlers.get('game:join')({matchId:1},a=>{ack=a;});
  assert.equal(ack.error,'client_update_required');assert.equal(joined,0);
  await handlers.get('game:join')({matchId:1,huntressCombatVersion:2,ninjaCombatVersion:1},a=>{ack=a;});
  assert.equal(ack.ok,true);assert.equal(joined,1);
  const prior=process.env.BB_HUNTRESS_COMBAT_V2;
  process.env.BB_HUNTRESS_COMBAT_V2='0';assert.equal(combat.enabled(room),true);
  if(prior===undefined)delete process.env.BB_HUNTRESS_COMBAT_V2;else process.env.BB_HUNTRESS_COMBAT_V2=prior;
});

test('prediction is reconciled by ID; terminal-before-launch, duplicates and epochs cannot resurrect arrows', () => {
  const replica=new HuntressReplica();replica.reset('room');
  const p=model.createVolley({x:100,y:100,width:150,height:150},model.resolveShot({angle:0}),'owner:req',0)[0];
  assert.equal(replica.launch(p,true),true);
  assert.equal(replica.launch({...p,x:120}),true);assert.equal(replica.active.size,1);
  assert.equal(replica.launch(p),false);
  assert.equal(replica.terminate({id:p.id},100),true);
  assert.equal(replica.launch(p),false);assert.equal(replica.terminate({id:p.id},101),false);
  replica.reset('new-room');assert.equal(replica.active.size,0);
  replica.reject(p.requestId,100);assert.equal(replica.launch(p,true),false);
});

test('two client timelines age identical launch packets under 50/100/150 ms RTT, jitter and stalls', () => {
  for(const rtt of [0,50,100,150]) {
    const clients=[new HuntressReplica(),new HuntressReplica()];
    const epoch='room';
    for(const c of clients) { c.reset(epoch);c.clock.synchronize({epoch,sentMono:1000+rtt/2,simMono:1000+rtt/2},0,rtt); }
    const p=model.createVolley({x:100,y:100,width:150,height:150},model.resolveShot({angle:-0.5}),'shot',1200)[1];
    for(const c of clients) c.launch(p);
    for(let local=300;local<1200;local+=100) {
      clients.forEach((c,i)=>c.clock.observe({epoch,sentMono:local+1000-rtt/2-i*10,simMono:local+1000-rtt/2-i*10},local));
      const positions=clients.map(c=>c.position(p.id,local));
      assert.ok(Math.hypot(positions[0].x-positions[1].x,positions[0].y-positions[1].y)<1);
      const truth=model.sample(p,local+1000-p.launchMono);
      assert.ok(Math.hypot(positions[0].x-truth.x,positions[0].y-truth.y)<1);
    }
    const clock=clients[0].clock, before=clock.now(1200), stalled=clock.now(5000);
    assert.ok(stalled-before<=250);
    assert.equal(clock.observe({epoch:'old',sentMono:9999,simMono:9999},5000),false);
  }
});

test('arrows still damage a player after their socket disconnects', t => {
  const { room, players: [p, target], step } = fixture(t);
  room.handlePlayerAction(p.participantId, { type: 'huntress-arrow', id: 'offline-target', angle: 0 });
  step(6);
  const arrow = [...room._huntress.active.values()][1];
  for (const [id, a] of room._huntress.active) if (a !== arrow) room._huntress.active.delete(id);
  target.x = arrow.x + 100; target.y = arrow.y;
  target.connected = false; target.socketId = null;
  const hp = target.health;
  step(20);
  assert.equal(target.health, hp - 1000);
});
