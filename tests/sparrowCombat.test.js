const test = require('node:test');
const { launchPoint } = require('../src/shared/characters/characterRig');
const assert = require('node:assert/strict');
const { makeRoom } = require('./helpers/botRoom');
const combat = require('../src/shared/combat/runtime/sparrowCombat.js');
const model = require('../src/shared/characters/sparrowProjectile');
const { characterBody } = require('../src/shared/physics/characterBody');
const { getDuelGeometry } = require('../src/shared/physics/duelGeometry');
const { SparrowReplica, CombatClock } = require('../src/shared/characters/sparrowReplication');

function fixture(t, map = 1) {
  const f = makeRoom({ characters: ['sparrow', 'ninja'], map });

  f.room.simulationMono = 10000;
  f.room.tickId = 0;
  f.room.geometry = { ...f.room.geometry, colliders: [] };
  for (const [i, p] of f.players.entries()) {
    Object.assign(p, { x: 100 + 500 * i, y: 200, _bodyHalfWidth: 30, _bodyHalfHeight: 60,
      _bodyCenterOffsetX: 0, _bodyCenterOffsetY: 0, connected: true });
    p.isBot = false; // Exercise the previously browser-authoritative path.
  }
  f.step = (n = 1) => { for (let i = 0; i < n; i++) {
    f.room.tickId++; f.room.simulationMono += model.STEP_MS; combat.tick(f.room);
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
    const data = { type: 'sparrow-arrow', id: 'shot', angle: 0, power: 0.5,
      start: { x: -999, y: -999 }, speed: 99999, gravity: 0, count: 99, damage: 99999 };
    assert.equal(room.handlePlayerAction(p.participantId, data), true);
    room.handlePlayerAction(p.participantId, data);
    assert.equal(p.ammoState.charges, initial - 1);
    step(5); assert.equal(room.sparrowCombatState.active.size, 0);
    step(); assert.equal(room.sparrowCombatState.active.size, 3);
    assert.equal(actions('sparrow-projectiles').length, 1);
    const center = actions('sparrow-projectiles')[0].projectiles[1], body = characterBody('sparrow');
    const muzzle = launchPoint('sparrow', model.attackConfig().muzzle, { x: p.x, y: p.y }, 0);
    assert.equal(center.x, muzzle.x);
    assert.equal(center.y, muzzle.y);
    assert.equal(center.vx, model.resolveShot({angle:0,power:0.5}).speed);
    assert.equal(center.gravity, model.attackConfig().gravity);
    const replica = new SparrowReplica(); replica.launch(center);
    assert.deepEqual(replica.active.get(center.id).projectile, center);
  }
});

test('forged client hits/releases, invalid power, cooldown and uncharged specials are rejected', t => {
  const { room, players: [p, target], actions } = fixture(t);
  const hp = target.health;
  room.handleHit(p.participantId, { attacker: p.name, target: target.name, attackType: 'sparrow-arrow', instanceId: 'forged' });
  room.handlePlayerAction(p.participantId, { type: 'sparrow-arrow-release', id: 'forged' });
  assert.equal(target.health, hp); assert.equal(room.sparrowCombatState.active.size, 0);
  assert.equal(room.handlePlayerAction(p.participantId, { type: 'sparrow-arrow', id: 'bad', angle: 0, power: 1.1 }), false);
  assert.equal(room.requestSpecial(p.participantId, { id: 'special', aim: { angle: 0 } }), false);
  assert.equal(room.handlePlayerAction(p.participantId, { type: 'sparrow-arrow', id: 'ok', angle: 0 }), true);
  assert.equal(room.handlePlayerAction(p.participantId, { type: 'sparrow-arrow', id: 'fast', angle: 0 }), false);
  assert.equal(actions('sparrow-result').at(-1).reason, 'not-ready');
});

test('a registered arrow can damage after its shooter moves beyond legacy range; once only', t => {
  const { room, players: [p, target], step, actions } = fixture(t);
  room.handlePlayerAction(p.participantId, { type: 'sparrow-arrow', id: 'range', angle: 0 });
  step(6);
  const arrow = [...room.sparrowCombatState.active.values()][1];
  for (const [id, a] of room.sparrowCombatState.active) if (a !== arrow) room.sparrowCombatState.active.delete(id);
  p.x = 1900;
  target.x = arrow.x + 100; target.y = arrow.y;
  const before = target.health;
  step(20);
  assert.equal(target.health, before - model.attackConfig().damagePerArrow);
  assert.equal(room.sparrowCombatState.active.size, 0);
  assert.equal(actions('sparrow-terminal').length, 1);
  assert.equal(actions('sparrow-terminal')[0].accepted, true);
  step(20); assert.equal(target.health, before - model.attackConfig().damagePerArrow);
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

const seraph = require('../src/shared/combat/runtime/abilities/sparrowSeraphAbility.js');
const { SERAPH, BOLT } = require('../src/shared/characters/sparrowLightBolt');
const effectManager = require('../src/shared/combat/runtime/effects/effectManager.js');
const abilities = require('../src/shared/combat/runtime/abilityRuntimeManager.js');

test('Seraph spends the super on the tap and holds her, shielded and unable to shoot arrows, until she releases', t => {
  const { room, players: [p], actions } = fixture(t);
  p.superCharge = p.maxSuperCharge;
  assert.equal(room.requestSpecial(p.participantId, { aim: {} }), true);
  const now = Date.now();
  assert.equal(p.superCharge, 0);
  assert.equal(seraph.isAiming(p, now), true);
  assert.equal(effectManager.getModifiers(p, now).damageTakenMult, SERAPH.damageTakenMult);
  assert.equal(room.handlePlayerAction(p.participantId, { type: 'sparrow-arrow', id: 'held', angle: 0 }), false);
  assert.equal(actions('sparrow-bolt').length, 0, 'activation alone fires nothing');
  assert.equal(room.handlePlayerAction(p.participantId, { type: 'sparrow-light-bolt', id: 'bolt', angle: -0.4 }), true);
  assert.equal(room.handlePlayerAction(p.participantId, { type: 'sparrow-light-bolt', id: 'again', angle: 0 }), false);
  assert.equal(seraph.isAiming(p, Date.now()), false);
  assert.equal(effectManager.getModifiers(p, Date.now()).damageTakenMult, 1);
  const [fired] = actions('sparrow-bolt');
  assert.equal(fired.bolt.angle, -0.4);
  assert.equal(fired.auto, false);
});

test('the light bolt pierces terrain and strikes every enemy on its path once for her special damage', t => {
  const { room, players: [p, target], step, actions } = fixture(t);
  const vault = { x: 1400, y: 0, width: 100, height: 100, coins: 10000 };
  room.gameMode = { getVaultState: team => team === target.team ? vault : null,
    damageVault(_team, damage) { vault.coins -= damage; return vault; } };
  p.superCharge = p.maxSuperCharge;
  room.requestSpecial(p.participantId, { aim: {} });
  room.handlePlayerAction(p.participantId, { type: 'sparrow-light-bolt', id: 'pierce', angle: 0 });
  const bolt = actions('sparrow-bolt')[0].bolt;
  // A wall between them, and the target and vault on the bolt's line.
  room.geometry = { ...room.geometry, colliders: [{ id: 'wall', left: 300, right: 340, top: -400, bottom: 800 }] };
  Object.assign(target, { x: 700, y: bolt.y }); vault.y = bolt.y;
  const hp = target.health;
  step(Math.ceil(bolt.durationMs / model.STEP_MS) + 2);
  assert.equal(target.health, hp - p.specialDamage);
  assert.equal(vault.coins, 10000 - p.specialDamage);
  assert.deepEqual(actions('sparrow-bolt-hit').map(hit => hit.target).sort(), [target.name, `vault:${target.team}`].sort());
  assert.equal(room.sparrowCombatState.bolts.size, 0);
});

test('Seraph stops before players beyond the light bolt range', t => {
  const { room, players: [caster, target], step, actions } = fixture(t, 4);
  caster.superCharge = caster.maxSuperCharge;
  assert.equal(room.requestSpecial(caster.participantId, {}), true);
  assert.equal(room.handlePlayerAction(caster.participantId, { type: 'sparrow-light-bolt', id: 'max-range', angle: 0 }), true);
  const [{ bolt }] = actions('sparrow-bolt');
  assert.equal(bolt.range, BOLT.range);
  Object.assign(target, { x: bolt.x + bolt.range + bolt.radius + target._bodyHalfWidth + 1, y: bolt.y });
  const health = target.health;
  step(Math.ceil(bolt.durationMs / model.STEP_MS) + 2);
  assert.equal(target.health, health);
  assert.ok(!actions('sparrow-bolt-hit').some(hit => hit.target === target.name));
  assert.equal(room.sparrowCombatState.bolts.size, 0);
});

test('an unreleased Seraph looses the bolt the way she faces when the aim phase runs out', t => {
  const { room, players: [p], actions } = fixture(t);
  p.superCharge = p.maxSuperCharge; p.flip = true;
  room.requestSpecial(p.participantId, { aim: {} });
  const start = p.effects.sparrowSeraphStartedAt;
  abilities.tickActiveAbilities(room, start + SERAPH.aimMs);
  assert.equal(actions('sparrow-bolt').length, 0, 'the grace window still takes a late release');
  abilities.tickActiveAbilities(room, start + SERAPH.aimMs + SERAPH.releaseGraceMs);
  const [fired] = actions('sparrow-bolt');
  assert.equal(fired.auto, true);
  assert.equal(fired.bolt.angle, Math.PI);
});

test('Seraph uses the last reported aim pose when a held shot times out', t => {
  const { room, players: [p], actions } = fixture(t);
  p.superCharge = p.maxSuperCharge;
  room.requestSpecial(p.participantId, {});
  p.animation = 'seraph-aim-03';
  p.flip = true;
  const deadline = p.effects.sparrowSeraphUntil + SERAPH.releaseGraceMs;
  abilities.tickActiveAbilities(room, deadline);
  assert.equal(seraph.requestFire(room, p, { id: 'late', angle: 0 }, deadline), false);
  const [shot] = actions('sparrow-bolt');
  assert.equal(shot.auto, true);
  assert.ok(shot.bolt.vx < 0 && shot.bolt.vy < 0);
  assert.ok(Math.abs(shot.bolt.vx - shot.bolt.vy) < 1e-9);
  assert.equal(actions('sparrow-bolt').length, 1);
});

test('a bot Seraph sweeps its drawn bow toward the target and releases near it, not dead on', t => {
  const misses = [];
  for (let run = 0; run < 12; run++) {
    const { room, players: [p, target], actions } = fixture(t);
    p.isBot = true; p.flip = false;
    p.superCharge = p.maxSuperCharge;
    assert.equal(room.requestSpecial(p.participantId, {}), true);
    const start = p.effects.sparrowSeraphStartedAt;
    Object.assign(target, { x: p.x + 150, y: p.y - 700 });
    const poses = [];
    for (let at = start; !actions('sparrow-bolt').length && at <= start + SERAPH.aimMs; at += 50) {
      abilities.tickActiveAbilities(room, at);
      if (!actions('sparrow-bolt').length && poses.at(-1) !== p.animation) poses.push(p.animation);
    }
    const [shot] = actions('sparrow-bolt');
    assert.equal(shot.auto, false);
    assert.ok(poses.length >= 4, `the pose turns through the directions between: ${poses}`);
    const want = Math.atan2(target.y - p.y, target.x - p.x);
    misses.push(Math.abs(Math.atan2(Math.sin(shot.bolt.angle - want), Math.cos(shot.bolt.angle - want))));
  }
  const limit = (SERAPH.botMissDeg + SERAPH.botSwayDeg) * Math.PI / 180 + 0.03;
  assert.ok(misses.every(miss => miss < limit), `every release is near the target: ${misses}`);
  assert.ok(misses.some(miss => miss > 0.01), 'and not pinned exactly on it');
});

test('death during Seraph ends the aim phase without a bolt', t => {
  const { room, players: [p], actions } = fixture(t);
  p.superCharge = p.maxSuperCharge;
  room.requestSpecial(p.participantId, { aim: {} });
  room.handlePlayerDeath(p);
  abilities.tickActiveAbilities(room, Date.now() + SERAPH.aimMs * 2);
  assert.equal(room.handlePlayerAction(p.participantId, { type: 'sparrow-light-bolt', id: 'late', angle: 0 }), false);
  assert.equal(actions('sparrow-bolt').length, 0);
});

test('death during sparrow windup cancels unreleased arrows', t => {
  const {room,players:[p],step,actions}=fixture(t);
  room.handlePlayerAction(p.participantId,{type:'sparrow-arrow',id:'windup',angle:0});
  room.handlePlayerDeath(p);step(10);
  assert.equal(room.sparrowCombatState.active.size,0);
  assert.equal(actions('sparrow-projectiles').length,0);
  assert.equal(actions('sparrow-result').at(-1).reason,'cancelled');
});

test('shielded contact consumes the arrow without damage or super charge', t => {
  const {room,players:[p,target],step,actions}=fixture(t);
  require('../src/shared/combat/runtime/effects/effectManager.js').apply(target,'respawnShield',Date.now(),{durationMs:3000},room);
  room.handlePlayerAction(p.participantId,{type:'sparrow-arrow',id:'shield',angle:0});step(6);
  const arrow=[...room.sparrowCombatState.active.values()][1];
  for(const [id,a]of room.sparrowCombatState.active)if(a!==arrow)room.sparrowCombatState.active.delete(id);
  target.x=arrow.x+40;target.y=arrow.y;const hp=target.health;
  step(10);
  assert.equal(target.health,hp);assert.equal(p.superCharge,0);
  assert.equal(actions('sparrow-terminal').length,1);
  assert.equal(actions('sparrow-terminal')[0].accepted,true);
  assert.equal(actions('sparrow-terminal')[0].appliedDamage,0);
});

test('vault contacts use authoritative flight even when the shooter has moved away', t => {
  const {room,players:[p,target],step,actions}=fixture(t,4);
  target.isAlive=false;
  const vault={x:500,y:300,width:100,height:100,coins:10000};
  room.gameMode={getVaultState:()=>vault,damageVault(_team,damage){vault.coins-=damage;return vault;}};
  room.handlePlayerAction(p.participantId,{type:'sparrow-arrow',id:'vault',angle:0});step(6);
  const arrow=[...room.sparrowCombatState.active.values()][1];
  for(const [id,a]of room.sparrowCombatState.active)if(a!==arrow)room.sparrowCombatState.active.delete(id);
  vault.x=arrow.x+50;vault.y=arrow.y;p.x=2200;step(10);
  assert.equal(vault.coins,10000-model.attackConfig().damagePerArrow);
  assert.equal(actions('sparrow-terminal')[0].target,'vault:team2');
});

test('authoritative combat is the default and incompatible clients must reload', async t => {
  const {room}=fixture(t);
  const {registerGameEvents}=require('../src/server/core/socketEvents/gameEvents');
  const handlers=new Map(),emitted=[];let joined=0;
  const socket={data:{user:{user_id:1,name:'human'}},on:(name,fn)=>handlers.set(name,fn),emit:(...args)=>emitted.push(args)};
  registerGameEvents(socket,{db:{},gameHub:{getGameRoom:()=>room,handlePlayerJoin:async()=>{joined++;return true;}}});
  let ack;
  await handlers.get('game:join')({matchId:1},a=>{ack=a;});
  assert.equal(ack.error,'client_update_required');assert.equal(joined,0);
  await handlers.get('game:join')({matchId:1,sparrowCombatVersion:model.VERSION,ninjaCombatVersion:require("../src/shared/characters/ninjaProjectile").VERSION,networkWireVersion:1},a=>{ack=a;});
  assert.equal(ack.ok,true);assert.equal(joined,1);
  assert.equal(room.sparrowCombatVersion, model.VERSION);
});

test('prediction is reconciled by ID; terminal-before-launch, duplicates and epochs cannot resurrect arrows', () => {
  const replica=new SparrowReplica();replica.reset('room');
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
    const clients=[new SparrowReplica(),new SparrowReplica()];
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
  room.handlePlayerAction(p.participantId, { type: 'sparrow-arrow', id: 'offline-target', angle: 0 });
  step(6);
  const arrow = [...room.sparrowCombatState.active.values()][1];
  for (const [id, a] of room.sparrowCombatState.active) if (a !== arrow) room.sparrowCombatState.active.delete(id);
  target.x = arrow.x + 100; target.y = arrow.y;
  target.connected = false; target.socketId = null;
  const hp = target.health;
  step(20);
  assert.equal(target.health, hp - model.attackConfig().damagePerArrow);
});
