const test = require('node:test');
const assert = require('node:assert/strict');
const { advanceSlimeball, sweep } = require('../src/shared/gloopProjectile');
const state = (extra = {}) => ({ x: 0, y: 0, vx: 220, vy: 0, collisionRadius: 10,
  gravity: 340, airDrag: 0.2, floorY: 100, maxBounces: 2,
  bounceDampingY: 0.68, bounceDampingX: 0.84, minBounceSpeed: 0,
  range: 5000, maxLifetimeMs: 10000, ...extra });

test('two rebounds lose energy, then the third contact splats', () => {
  const s = state(); const impacts = [];
  for (let i = 0; i < 1200 && !s.done; i++) impacts.push(...advanceSlimeball(s, 1000 / 120));
  assert.equal(s.bounceCount, 2); assert.equal(impacts.length, 3);
  assert.deepEqual(impacts.map(h => h.terminal), [false, false, true]);
  assert.ok(impacts[1].speed < impacts[0].speed);
  assert.ok(impacts[2].speed < impacts[1].speed);
  assert.ok(Math.abs(s.y - 90) < 0.1);
});
test('walls reflect at the surface and count against the same bounce budget', () => {
  const s = state({ vx: 1000, gravity: 0, floorY: 1000 });
  const hits = advanceSlimeball(s, 100, [{ left: 50, right: 52, top: -100, bottom: 100 }]);
  assert.equal(hits.length, 1); assert.equal(hits[0].nx, -1);
  assert.ok(s.contactHold, 'slime stays pressed against the wall before peeling away');
  const contactX = s.x;
  advanceSlimeball(s, 20, [{ left: 50, right: 52, top: -100, bottom: 100 }]);
  assert.equal(s.x, contactX);
  advanceSlimeball(s, 200, [{ left: 50, right: 52, top: -100, bottom: 100 }]);
  assert.ok(s.vx < 0); assert.ok(s.x < 40); assert.equal(s.bounceCount, 1);
});
test('ceilings and world edges also rebound', () => {
  const ceiling = state({ vx: 0, vy: -300, gravity: 0 });
  const hit = advanceSlimeball(ceiling, 100, [{ left: -100, right: 100, top: -30, bottom: -20 }])[0];
  assert.equal(hit.ny, 1); assert.ok(ceiling.contactHold);
  advanceSlimeball(ceiling, 150); assert.ok(ceiling.vy > 0);
  const edge = state({ worldMaxX: 30, gravity: 0 });
  advanceSlimeball(edge, 350); assert.ok(edge.vx < 0);
});
test('fixed steps agree across 30, 60, 144 fps and delayed frames', () => {
  function run(deltas) { const s = state(); for (const dt of deltas) advanceSlimeball(s, dt); return s; }
  const a = run(Array(60).fill(1000 / 60));
  for (const deltas of [Array(30).fill(1000 / 30), Array(144).fill(1000 / 144), [200, 300, 500]]) {
    const b = run(deltas);
    for (const key of ['x', 'y', 'vx', 'vy', 'elapsed', 'traveled', 'bounceCount']) assert.ok(Math.abs(a[key] - b[key]) < 1e-7, key);
  }
});
test('swept collision avoids thin-wall tunneling and false square-corner hits', () => {
  const rect = { left: 50, right: 51, top: 50, bottom: 100 };
  assert.equal(sweep(0, 60, 1000, 0, 10, rect).nx, -1);
  assert.equal(sweep(39, 39, 2, 2, 10, rect), null);
  const hit = sweep(30, 30, 30, 30, 10, rect);
  assert.ok(hit.nx < -0.7 && hit.ny < -0.7);
});
test('zero bounces and low-energy impacts stop immediately', () => {
  for (const extra of [{ maxBounces: 0 }, { minBounceSpeed: 1000 }]) {
    const s = state(extra); const hits = advanceSlimeball(s, 1000);
    assert.ok(s.done); assert.equal(s.bounceCount || 0, 0); assert.ok(hits[0].terminal);
  }
});
test('contact order follows distance rather than collider array order', () => {
  const near = { left: 40, right: 42, top: -100, bottom: 100 };
  const far = { left: 70, right: 72, top: -100, bottom: 100 };
  const a = state({ vx: 10000, gravity: 0 }), b = state({ vx: 10000, gravity: 0 });
  advanceSlimeball(a, 10, [far, near]); advanceSlimeball(b, 10, [near, far]);
  assert.equal(a.x, b.x); assert.equal(a.vx, b.vx); assert.ok(a.x < 30);
});

test('server runtime follows the shared model through a wall rebound', () => {
  const { createRuntimeAttack, tickRuntimeAttack } = require('../src/server/core/gameRoom/characterAttackRegistry');
  const player = { participantId: 'gloop-test', name: 'Gloop', team: 'team1', isAlive: true, x: 0, y: 0, char_class: 'gloop' };
  const rects = [{ left: 80, right: 85, top: -100, bottom: 200 }];
  const attack = createRuntimeAttack(player, { type: 'gloop-slimeball-release', id: 'slime-test',
    start: { x: 0, y: 0 }, direction: 1, mapCollisionRects: rects, floorY: 500 }, 0);
  const predicted = { ...attack };
  const room = { players: new Map([[player.participantId, player]]), FIXED_DT_MS: 1000 / 60,
    geometry: { colliders: rects } };
  for (let frame = 0; frame < 30; frame++) {
    tickRuntimeAttack(room, attack, frame * room.FIXED_DT_MS);
    advanceSlimeball(predicted, room.FIXED_DT_MS, rects);
    for (const key of ['x', 'y', 'vx', 'vy', 'bounceCount']) assert.equal(attack[key], predicted[key], key);
  }
  assert.ok(attack.vx < 0); assert.equal(attack.bounceCount, 1);
});

test('reachable aimed throws reach the requested point with the configured discrete integrator', () => {
  const { slimeLaunch, getSlimeLaunchStepCount } = require('../src/shared/gloopProjectile');
  const cfg = require("../src/shared/characterTuning.js").getResolvedCharacterAttackConfig('gloop', 'slimeball');
  const pose = { x: 500, y: 300, width: 150, height: 150 };
  for (const target of [{ x: 650, y: 350 }, { x: 350, y: 300 }, { x: 500, y: 260 }, { x: 570, y: 400 }]) {
    const shot = slimeLaunch(pose, target, cfg);
    const distance = Math.hypot(target.x - shot.start.x, target.y - shot.start.y);
    const steps = getSlimeLaunchStepCount(distance, cfg);
    const s = { ...cfg, x: shot.start.x, y: shot.start.y, vx: Math.cos(shot.angle) * shot.speed, vy: shot.initialVy };
    advanceSlimeball(s, steps * 1000 / 120);
    assert.ok(Math.hypot(s.x - target.x, s.y - target.y) < 1e-7);
  }
});

test('aimed Gloop projectiles use the requested thirty percent speed reduction', () => {
  const cfg = require('../src/shared/characterTuning.js').getResolvedCharacterAttackConfig('gloop', 'slimeball');
  assert.ok(Math.abs(cfg.launchSpeedMultiplier - 1.4 * 0.7) < 1e-12);
  assert.ok(Math.abs(cfg.maxLaunchSpeed - 462 * 0.7) < 1e-12);
  assert.ok(Math.abs(cfg.speed - 546 * 0.7) < 1e-12);
});

test('the successive Gloop rebound reaches higher than the old damped bounce', () => {
  function secondBounceHeight(successiveBounceMultiplier) {
    const s = state({ x: 0, y: 0, vx: 0, successiveBounceMultiplier });
    let secondBounceStarted = false;
    let apexY = Infinity;
    for (let i = 0; i < 1200 && !s.done; i += 1) {
      advanceSlimeball(s, 1000 / 120);
      if (s.bounceCount >= 2) {
        secondBounceStarted = true;
        apexY = Math.min(apexY, s.y);
      }
    }
    assert.equal(secondBounceStarted, true);
    return 90 - apexY;
  }
  assert.ok(secondBounceHeight(0.85) > secondBounceHeight(0.62) * 1.5);
});

test('normal reticle stops at the server first impact while the projectile keeps bouncing', () => {
  const { resolveAttackAimContext } = require('../src/characters/shared/attackAim');
  const { createRuntimeAttack, tickRuntimeAttack } = require('../src/server/core/gameRoom/characterAttackRegistry');
  const cfg = require("../src/shared/characterTuning.js").getResolvedCharacterAttackConfig('gloop', 'slimeball');
  const rects = [{ left: 600, right: 620, top: 0, bottom: 500 }];
  const player = { x: 100, y: 250, displayWidth: 150, displayHeight: 150, scene: {
    physics: { world: { bounds: { x: 0, y: 0, width: 1100, height: 500 } } }, _mapObjects: rects } };
  for (const target of [{ x: 750, y: 300 }, { x: 380, y: 450 }]) {
    const aim = resolveAttackAimContext({ character: 'gloop', player, pointerWorldX: target.x, pointerWorldY: target.y });
    assert.equal(aim.kind, 'throw');
    const owner = { ...player, name: 'Gloop', participantId: 'gloop-test', isAlive: true, team: 'team1' };
    const attack = createRuntimeAttack(owner, { ...cfg, start: aim.start, angle: aim.angle, speed: aim.speed, initialVy: aim.initialVy, direction: aim.direction, type: 'gloop-slimeball-release', floorY: 500, worldMinX: 0, worldMaxX: 1100 }, 0);
    const room = { players: new Map([[owner.participantId, owner]]), FIXED_DT_MS: 1000 / 120, geometry: { colliders: rects } };
    for (let i = 0; i < 720 && !attack.done && !attack.bounceCount; i++) tickRuntimeAttack(room, attack, i * room.FIXED_DT_MS);
    assert.equal(aim.throwPreview.impacts.length, 1);
    assert.ok(Math.hypot(aim.target.x - player.x, aim.target.y - player.y) <= 400.00001);
    assert.equal(attack.x, aim.throwPreview.endX);
    assert.equal(attack.y, aim.throwPreview.endY);
    for (let i = 0; i < 720 && !attack.done; i++) tickRuntimeAttack(room, attack, i * room.FIXED_DT_MS);
    assert.equal(attack.bounceCount, 2);
  }
});

test('a very short Gloop reticle continues through its bounce', () => {
  const { resolveAttackAimContext } = require('../src/characters/shared/attackAim');
  const { createRuntimeAttack, tickRuntimeAttack } = require('../src/server/core/gameRoom/characterAttackRegistry');
  const cfg = require("../src/shared/characterTuning.js").getResolvedCharacterAttackConfig('gloop', 'slimeball');
  const rects = [{ left: 400, right: 600, top: 340, bottom: 370 }];
  const player = { x: 500, y: 250, displayWidth: 150, displayHeight: 150, scene: {
    physics: { world: { bounds: { x: 0, y: 0, width: 1100, height: 500 } } }, _mapObjects: rects } };
  const aim = resolveAttackAimContext({ character: 'gloop', player,
    pointerWorldX: player.x, pointerWorldY: player.y + 320 });
  assert.equal(aim.throwPreview.impacts.length, 3);
  assert.equal(aim.throwPreview.impacts.at(-1).terminal, true);
  const owner = { ...player, name: 'Gloop', participantId: 'short-preview', isAlive: true, team: 'team1' };
  const attack = createRuntimeAttack(owner, { ...cfg, start: aim.start, angle: aim.angle,
    speed: aim.speed, initialVy: aim.initialVy, direction: aim.direction,
    type: 'gloop-slimeball-release', floorY: 500, worldMinX: 0, worldMaxX: 1100 }, 0);
  const room = { players: new Map([[owner.participantId, owner]]), FIXED_DT_MS: 1000 / 120,
    geometry: { colliders: rects } };
  for (let i = 0; i < 720 && !attack.done; i++) tickRuntimeAttack(room, attack, i * room.FIXED_DT_MS);
  assert.equal(attack.x, aim.throwPreview.endX);
  assert.equal(attack.y, aim.throwPreview.endY);
});

test('authoritative release publishes the same launch and terrain used for damage', () => {
  const { handleCharacterAction } = require('../src/server/core/gameRoom/characterActionRegistry');
  const { slimeLaunch } = require('../src/shared/gloopProjectile');
  const cfg = require("../src/shared/characterTuning.js").getResolvedCharacterAttackConfig('gloop','slimeball');
  const owner = { participantId:'gloop-release',name:'Gloop',char_class:'gloop',isAlive:true,loaded:true,
    x:100,y:200,_lastWidth:150,_lastHeight:150 };
  const emitted=[];let release;
  const room={status:'active',matchId:1,geometry:{colliders:[{left:600,right:610,top:100,bottom:500}]},
    io:{to:()=>({emit:(_event,data)=>emitted.push(data)})},scheduleAction:fn=>{release=fn;}};
  const target={x:450,y:300};
  handleCharacterAction(room,owner,{type:'gloop-slimeball',id:'release-test',target},0);
  owner.x=125; // Movement during windup must not re-solve the committed trajectory.
  release();
  const packet=emitted.at(-1).action, runtime=room._activeAttacks[0];
  const expected=slimeLaunch({x:100,y:200,width:150,height:150},target,cfg);
  expected.start.x += 25;
  assert.deepEqual(packet.start,expected.start);
  assert.equal(runtime.x,packet.start.x);assert.equal(runtime.y,packet.start.y);
  assert.equal(runtime.vx,Math.cos(packet.angle)*packet.speed);
  assert.equal(runtime.vy,packet.initialVy);
  assert.deepEqual(runtime.mapCollisionRects,packet.mapCollisionRects);
});

 test('launch clamps distant targets on both sides to the throw limit', () => {
  const { slimeLaunch } = require('../src/shared/gloopProjectile');
  const cfg = require("../src/shared/characterTuning.js").getResolvedCharacterAttackConfig('gloop', 'slimeball');
  for (const x of [-2000, 2000]) {
    const launch = slimeLaunch({ x: 100, y: 200 }, { x, y: 700 }, cfg);
    assert.ok(Math.abs(Math.hypot(launch.target.x - 100, launch.target.y - 200) - 400) < 1e-8);
  }
});

test('high throws spend horizontal speed and cannot exceed the height budget', () => {
  const { slimeLaunch } = require('../src/shared/gloopProjectile');
  const cfg = require("../src/shared/characterTuning.js").getResolvedCharacterAttackConfig('gloop', 'slimeball');
  const pose = { x: 0, y: 0, width: 150, height: 150 };
  const low = slimeLaunch(pose, { x: 400, y: 0 }, cfg);
  const high = slimeLaunch(pose, { x: 280, y: -280 }, cfg);
  assert.ok(Math.cos(high.angle) * high.speed < Math.cos(low.angle) * low.speed);
  for (const target of [{ x: 10000, y: -10000 }, { x: 0, y: -10000 }, { x: -10000, y: 0 }]) {
    const shot = slimeLaunch(pose, target, cfg);
    assert.ok(shot.speed <= cfg.maxLaunchSpeed + 0.000001);
    assert.ok(shot.initialVy >= -cfg.maxUpwardSpeed);
    const s = { ...cfg, x: shot.start.x, y: shot.start.y,
      vx: Math.cos(shot.angle) * shot.speed, vy: shot.initialVy };
    let minY = s.y;
    for (let i = 0; i < 180; i++) { advanceSlimeball(s, 1000 / 120); minY = Math.min(minY, s.y); }
    assert.ok(shot.start.y - minY < 108);
  }
});

test('release translates the preview with windup movement without changing its impulse', () => {
  const { resolveAttackAimContext } = require('../src/characters/shared/attackAim');
  const { handleCharacterAction } = require('../src/server/core/gameRoom/characterActionRegistry');
  const { tickRuntimeAttack } = require('../src/server/core/gameRoom/characterAttackRegistry');
  const rects = [{ left: -500, right: 1000, top: 400, bottom: 450 }];
  for (const target of [{x: 500,y: 200}, {x: 250,y: -100}, {x: -200,y: 250}]) {
    const player = { x: 100, y: 300, displayWidth: 150, displayHeight: 150,
      scene: { _mapObjects: rects, physics: { world: { bounds: { x: -500, y: 0, width: 1500, height: 1000 } } } } };
    const aim = resolveAttackAimContext({character: 'gloop', player, pointerWorldX: target.x, pointerWorldY: target.y});
    const owner = { ...player, participantId:'gloop',name:'Gloop',char_class:'gloop',isAlive:true,loaded:true,
      _lastWidth:80,_lastHeight:100 };
    let release;
    const room = {status:'active',matchId:1,geometry:{colliders:rects},players:new Map([['gloop',owner]]),
      FIXED_DT_MS:1000/120,io:{to:()=>({emit:()=>{}})},scheduleAction:fn=>{release=fn;}};
    handleCharacterAction(room,owner,{type:'gloop-slimeball',id:'cast',start:aim.start,
      angle:aim.angle,speed:aim.speed,initialVy:aim.initialVy,target:aim.target,
      floorY:1000,worldMinX:-500,worldMaxX:1000},0);
    owner.x += 40;
    release();
    const attack=room._activeAttacks[0];
    const showsBounce = aim.throwPreview.impacts.length > 1;
    for (let i = 0; i < 720 && !attack.done && (showsBounce || !attack.bounceCount); i++)
      tickRuntimeAttack(room, attack, i * room.FIXED_DT_MS);
    assert.ok(Math.abs(attack.x - aim.endX - 40) < 1e-8);
    assert.equal(attack.y,aim.endY);
  }
});

test('slime hits only one overlapping enemy and broadcasts the terminal splat', () => {
  const { createRuntimeAttack, tickRuntimeAttack } = require('../src/server/core/gameRoom/characterAttackRegistry');
  const owner={participantId:'owner',name:'Gloop',char_class:'gloop',team:'a',isAlive:true,loaded:true,x:0,y:100};
  const enemies=['one','two'].map(name=>({participantId:name,name,char_class:'gloop',team:'b',isAlive:true,loaded:true,x:80,y:100,_lastWidth:150,_lastHeight:150}));
  const hits=[],events=[];
  const room={players:new Map([owner,...enemies].map(p=>[p.participantId,p])),FIXED_DT_MS:1000/120,
    geometry:{colliders:[]},handleHit:(_,hit)=>hits.push(hit),io:{to:()=>({emit:(event,data)=>events.push(data)})}};
  const attack=createRuntimeAttack(owner,{type:'gloop-slimeball-release',id:'single',start:{x:20,y:100},angle:0,speed:250,initialVy:0,floorY:1000},0);
  for(let i=0;i<120&&!attack.done;i++) tickRuntimeAttack(room,attack,i*room.FIXED_DT_MS);
  assert.equal(hits.length,1);
  assert.ok(attack.done);
  assert.equal(events.filter(e=>e.action?.type==='gloop-slimeball-splat').length,1);
  assert.equal(events.find(e=>e.action?.type==='gloop-slimeball-splat').action.id,'single');
});

test('configured bounce budgets above two are respected', () => {
  const s = state({ x: 0, y: 89, vx: 0, vy: 300, bounceCount: 2, maxBounces: 3 });
  const impacts = advanceSlimeball(s, 1000 / 120);
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].terminal, false);
  assert.equal(s.bounceCount, 3);
});
