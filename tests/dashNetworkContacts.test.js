const test = require('node:test');
const assert = require('node:assert/strict');
const {mapDefaults} = require('../src/shared/maps');
const {getDuelGeometry,characterBody} = require('../src/shared/duelGeometry');
const input = require('../src/server/core/gameRoom/inputManager');
const {quantizeMovementPosition} = require('../src/shared/movementPrecision');
const {applyMovementCorrection} = require('../src/players/movementCorrection');
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

for(const map of mapDefaults) for(const variant of Object.keys(map.variants)) {
 test(`${map.id}/${variant}: every enabled platform face tolerates packet rounding without stopping the player`,()=>{
  for(const rect of getDuelGeometry(map.id,variant).colliders) {
   if(rect.enabled===false)continue;
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

test('reported Lushy upper-platform floor rounds inside with legacy precision, but not new precision',()=>{
 const rect=getDuelGeometry(1).colliders.find(r=>r.id==='p1');
 const f=fixture(rect,'up');
 assert.ok(Math.round(f.y*2)/2-f.y>0.2);
 assert.ok(Math.abs(quantizeMovementPosition(f.y)-f.y)<0.0001);
});

test('genuine wall penetration still corrects and carries the contacted face',()=>{
 const rect=getDuelGeometry(1).colliders.find(r=>r.id==='p2');const f=fixture(rect,'right');
 input.handlePlayerInput(f.room,'p',{x:f.x-10,y:f.y,sequence:1,vx:-700,vy:100});
 assert.equal(f.events.length,1);assert.equal(f.events[0].reason,'collision');assert.equal(f.events[0].contacts.left,true);
});

test('real Phaser reset stops both axes; collision correction preserves tangential motion and steering',()=>{
 const body=new Body({defaults:{},gravity:{x:0,y:825}});
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
