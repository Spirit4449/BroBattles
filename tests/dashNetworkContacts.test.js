const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe("Dash contact authority", () => {
  const physics = require('../src/shared/physics/movementPhysics.json');

  const {mapDefaults} = require('../src/shared/maps');
  const {getDuelGeometry,characterBody} = require('../src/shared/physics/duelGeometry');
  const input = require('../src/server/core/gameRoom/inputManager');
  const {quantizeMovementPosition} = require('../src/shared/physics/movementPrecision');
  const {applyMovementCorrection} = require('../src/client/game/players/movementCorrection');
  const Body = require('phaser/src/physics/arcade/Body');

  function fixture(rect, face) {
   const shape=characterBody('ninja');const now=Date.now();
   const x=face==='right'?rect.right-shape.offsetX+shape.halfWidth:face==='left'?rect.left-shape.offsetX-shape.halfWidth:(rect.left+rect.right)/2-shape.offsetX;
   const y=face==='up'?rect.top-shape.offsetY-shape.halfHeight:face==='down'?rect.bottom-shape.offsetY+shape.halfHeight:(rect.top+rect.bottom)/2-shape.offsetY;
   const player={socketId:'p',name:'p',char_class:'ninja',isAlive:true,connected:true,x,y,lastInput:now,_dashUntil:now+160};
   // Isolate each face from world bounds, including offscreen boundary colliders.
   const events=[];const room={players:new Map([['p',player]]),geometry:{colliders:[rect],world:{x:rect.left-200,y:rect.top-200,width:rect.right-rect.left+400,height:rect.bottom-rect.top+400}},io:{to:()=>({emit:(name,data)=>events.push(data)})}};
   input.resetMovementBudget(player,now);
   return {player,events,room,x,y};
  }

  for(const map of mapDefaults) {
   test(`map ${map.id}: every enabled platform face tolerates packet rounding without stopping the player`,()=>{
    for(const rect of getDuelGeometry(map.id).colliders) {
     // Moving platforms are excluded from input correction (inputManager.js).
     if(rect.enabled===false||rect.motion)continue;
     for(const face of ['up','down','left','right']) {
      if(rect.collision?.[face]===false)continue;
      for(const round of [quantizeMovementPosition,v=>Math.round(v*2)/2]) {
       const f=fixture(rect,face);
       for(let sequence=0;sequence<4;sequence++) {
        input.handlePlayerInput(f.room,'p',{x:round(f.x + (face==='up'||face==='down' ? sequence * 2 : 0)),y:round(f.y + (face==='left'||face==='right' ? sequence * 2 : 0)),sequence,vx:0,vy:0});
       }
       assert.equal(f.events.length,0,`${rect.id} ${face} must not repeatedly reset movement`);
       const horizontal = face==='up'||face==='down';
       const tangent = horizontal ? f.player.x-f.x : f.player.y-f.y;
       assert.ok(Math.abs(tangent-6)<=0.26, `${rect.id} ${face} must allow movement along the face`);
       const shape = characterBody('ninja');
       if(face==='up') assert.ok(f.player.y+shape.offsetY+shape.halfHeight<=rect.top+1e-7);
       if(face==='down') assert.ok(f.player.y+shape.offsetY-shape.halfHeight>=rect.bottom-1e-7);
       if(face==='left') assert.ok(f.player.x+shape.offsetX+shape.halfWidth<=rect.left+1e-7);
       if(face==='right') assert.ok(f.player.x+shape.offsetX-shape.halfWidth>=rect.right-1e-7);
      }
     }
    }
   });
  }

  test('genuine wall penetration still corrects and carries the contacted face',()=>{
   const rect=getDuelGeometry(1).colliders.find(r=>r.id==='p2');const f=fixture(rect,'right');
   input.handlePlayerInput(f.room,'p',{x:f.x-10,y:f.y,sequence:1,vx:-700,vy:100});
   assert.equal(f.events.length,1);assert.equal(f.events[0].reason,'collision');assert.equal(f.events[0].contacts.left,true);
  });

  test('real Phaser reset stops both axes; collision correction preserves tangential motion and steering',()=>{
   const body=new Body({defaults:{},gravity:{x:0,y:physics.gravity}});
   body.setVelocity(600,150);body.setAcceleration(3000,10);body.reset(10,20);
   assert.equal(body.velocity.x,0);assert.equal(body.velocity.y,0);
   body.setVelocity(600,150);body.setAcceleration(3000,10);
   applyMovementCorrection({body},{x:10,y:20,reason:'collision',contacts:{down:true}});
   assert.equal(body.velocity.x,600);assert.equal(body.velocity.y,0);assert.equal(body.acceleration.x,3000);
   body.setVelocity(-600,-200);body.setAcceleration(-3000,-10);
   applyMovementCorrection({body},{x:10,y:20,reason:'collision',contacts:{left:true}});
   assert.equal(body.velocity.x,0);assert.equal(body.velocity.y,-200);assert.equal(body.acceleration.y,-10);
   // Moving away must not be cancelled by an older correction.
   body.setVelocity(200,100);
   applyMovementCorrection({body},{x:10,y:20,reason:'collision',contacts:{left:true}});
   assert.equal(body.velocity.x,200);
  });
});

describe("Replicated knockback", () => {
  const { resolveShockwaveImpulse } = require('../src/shared/physics/shockwaveImpulse');
  const { applyImpulse, stepBody } = require('../src/server/core/bots/physics');

  test('floor, wall, ceiling and corner contacts redirect blocked blast force', () => {
    const ground = resolveShockwaveImpulse(1500, 800, { down: true });
    assert.ok(ground.x === 1500 && ground.y <= -900);
    const wall = resolveShockwaveImpulse(1500, -600, { right: true });
    assert.equal(wall.x, 0);
    assert.ok(wall.y < -1500);
    const ceiling = resolveShockwaveImpulse(200, -1500, { up: true });
    assert.ok(ceiling.x > 1500 && ceiling.y === 0);
    const corner = resolveShockwaveImpulse(1500, 600, { right: true, down: true });
    assert.ok(corner.x === 0 && corner.y < -1500);
    assert.deepEqual(resolveShockwaveImpulse(700, 900), { x: 700, y: 900 });
  });

  test('grounded bot leaves the floor and preserves blast through opposing movement and jump input', () => {
    const player = { x: 500, y: 200, char_class: 'ninja', grounded: true, _jumpLaunch: { vy: -10 } };
    applyImpulse(player, { cause: 'shockwave', radial: true, amountX: 1800, amountY: 600 }, 1000);
    assert.equal(player._jumpLaunch, null);
    assert.ok(player.vy < -1000);
    stepBody(player, { direction: -1, jumpPressed: true }, {
      colliders: [], world: { x: 0, y: 0, width: 5000, height: 5000 },
    }, 16, 1016);
    assert.equal(player.vx, 1800);
    assert.ok(player.y < 200);
  });

  test('local shockwave handler lifts grounded players and removes speed caps immediately', () => {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const babel = require('@babel/core');
    const exports = {};
    const code = babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/players/localSocketEvents'), 'utf8'), {
      babelrc: false, configFile: false,
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    }).code;
    vm.runInNewContext(code, { exports, require: name => name.includes('movementPhysics')
      ? require('../src/shared/physics/movementPhysics.json') : name.includes('shockwaveImpulse')
      ? require('../src/shared/physics/shockwaveImpulse') : {}, window: {} });
    const handlers = {};
    const player = {
      body: { blocked: { down: true }, touching: {} }, _jumpLaunch: {},
      setVelocityX(x) { this.vx = x; }, setVelocityY(y) { this.vy = y; },
      setMaxVelocity(x, y) { this.cap = { x, y }; },
      setAccelerationX(x) { this.accel = x; }, setDragX(x) { this.drag = x; },
    };
    exports.bindLocalSocketEvents({
      socket: { on: (event, fn) => { handlers[event] = fn; } },
      getPlayer: () => player, getDead: () => false,
    });
    handlers['player:knockback']({ cause: 'shockwave', radial: true, amountX: 2400, amountY: 700 });
    assert.equal(player.vx, 2400);
    assert.ok(player.vy < -1400);
    assert.ok(player.cap.x >= player.vx && player.cap.y >= Math.abs(player.vy));
    assert.equal(player._jumpLaunch, null);
    assert.equal(player.accel, 0);
    assert.equal(player.drag, 0);
    assert.ok(player._shockwaveUntil > Date.now());
  });

  test('every participant knockback source advances the replicated trail sequence', () => {
    const { applyParticipantKnockback } = require('../src/server/core/gameRoom/participants');
    const events = [];
    const room = { io: { to: () => ({emit: (event, data) => events.push({event, data})}) } };
    for (const isBot of [false, true]) {
      const player = {isBot, socketId: 'fighter'};
      for (const cause of [undefined, 'stomp', 'shockwave']) {
        const before = player.knockbackSeq || 0;
        applyParticipantKnockback(room, player, {cause, amountX: 300, amountY: -180});
        assert.equal(player.knockbackSeq, before + 1);
      }
      applyParticipantKnockback(room, player, {amountX: 0, amountY: 0});
      assert.equal(player.knockbackSeq, 3, 'zero force creates no trail');
    }
    assert.equal(events.length, 4, 'human impulses retain their delivery');
  });
});
