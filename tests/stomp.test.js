const test = require('node:test');
const assert = require('node:assert/strict');
const { acceptDash } = require('../src/shared/physics/dash');
const { resolveStomp } = require('../src/server/core/gameRoom/stomp');
const { characterBody } = require('../src/shared/physics/duelGeometry');
const input = require('../src/server/core/gameRoom/inputManager');
function fixture() {
  const fighter = (name, x, extra = {}) => ({ name, socketId:name, char_class:'ninja',
    isAlive:true, loaded:true, connected:true, team:'red', x, y:100, grounded:false, ...extra });
  const source = fighter('source', 200, { team:'blue' });
  const left = fighter('left', 120), right = fighter('right', 280);
  const ally = fighter('ally', 220, {team:'blue'}), far = fighter('far', 800);
  const dead = fighter('dead', 230, {isAlive:false});
  const events=[];
  const room = {matchId:'test',status:'active',players:new Map([source,left,right,ally,far,dead].map(p=>[p.name,p])),
    io:{to:to=>({emit:(event,data)=>events.push({to,event,data})})}};
  return {room,source,left,right,ally,far,dead,events};
}
test('only an airborne straight-down accepted dash arms one stomp', () => {
  for (const [x,y,grounded,armed] of [[0,1,false,true],[0,1,true,false],[1,0,false,false],[0,-1,false,false],[Math.SQRT1_2,Math.SQRT1_2,false,false]]) {
    const p={isAlive:true,grounded};
    assert.ok(acceptDash(p,{dashSeq:1,dashX:x,dashY:y},1000));
    assert.equal(p._stompPendingUntil>1000,armed);
  }
});
test('landing pushes enemies outward, cancels swings and pending casts, keeps allies and released projectiles', () => {
  const f=fixture(), {room,source,left,right,ally,far,dead,events}=f;
  acceptDash(source,{dashSeq:1,dashX:0,dashY:1},1000);
  assert.equal(resolveStomp(room,source,1010),false);
  room._activeAttacks=[{attackerParticipantId:'left',runtimeKind:'attached-rect'},
    {attackerParticipantId:'left',runtimeKind:'projectile-linear'},
    {attackerParticipantId:'ally',runtimeKind:'attached-rect'}];
  room._huntress={pending:[{ownerId:'left'},{ownerId:'ally'}]};
  room._ninja={pending:[{owner:'right'},{owner:'ally'}]};
  source.grounded=true;
  assert.equal(resolveStomp(room,source,1100),true);
  assert.equal(resolveStomp(room,source,1110),false);
  const impulses=events.filter(e=>e.event==='player:knockback');
  assert.equal(impulses.length,2);
  assert.ok(impulses.find(e=>e.to==='left').data.amountX<0);
  assert.ok(impulses.find(e=>e.to==='right').data.amountX>0);
  assert.ok(impulses.every(e=>e.data.amountY<0));
  assert.equal(left._attackInterruptSeq,1); assert.equal(right._attackInterruptedUntil,1400);
  assert.equal(left._controlLockUntil,undefined,'interrupt must preserve knockback movement');
  for(const p of [ally,far,dead]) assert.equal(p._attackInterruptSeq,undefined);
  assert.equal(room._activeAttacks.length,2);
  assert.deepEqual(room._huntress.pending,[{ownerId:'ally'}]);
  assert.deepEqual(room._ninja.pending,[{owner:'ally'}]);
  assert.equal(events.filter(e=>e.event==='player:stomp').length,1);
});
test('expiration, death, knockback and jumping cancel the armed stomp', () => {
  for(const changes of [{isAlive:false},{_knockbackUntil:2000},{vy:-100},{_stompPendingUntil:1050}]) {
    const {room,source,events}=fixture();
    acceptDash(source,{dashSeq:1,dashX:0,dashY:1},1000);
    Object.assign(source,{grounded:true},changes);
    assert.equal(resolveStomp(room,source,1100),false);
    assert.equal(source._stompPendingUntil,0); assert.equal(events.length,0);
  }
});
test('position packets require map support and trigger only once on landing', () => {
  const {room,source,events}=fixture(); const body=characterBody('ninja');
  const floor=source.y+body.offsetY+body.halfHeight+40;
  room.geometry={world:{x:0,y:0,width:1000,height:1000},colliders:[{
    left:0,right:1000,top:floor,bottom:floor+30,collision:{up:true}}]};
  input.resetMovementBudget(source,Date.now()-100);
  const packet={x:source.x,y:source.y,grounded:true,loaded:true,vx:0,vy:560,dashSeq:1,dashX:0,dashY:1};
  input.handlePlayerInput(room,'source',packet);
  assert.equal(events.some(e=>e.event==='player:stomp'),false,'fake grounded flag cannot trigger impact');
  input.handlePlayerInput(room,'source',{...packet,y:source.y+40,vy:0});
  input.handlePlayerInput(room,'source',{...packet,y:source.y,vy:0});
  assert.equal(events.filter(e=>e.event==='player:stomp').length,1);
});
test('interrupted windups never release later, even after the stun has expired', () => {
  const { handleCharacterAction } = require('../src/shared/combat/runtime/characterActionRegistry.js');
  for (const character of ['wizard','gloop']) {
    const {room,source,left}=fixture(); const callbacks=[];
    room.scheduleAction=fn=>callbacks.push(fn);
    left.char_class=character;
    handleCharacterAction(room,left,{type:`${character}-${character==='wizard'?'fireball':'slimeball'}`,id:'cast',angle:0},1000);
    assert.equal(callbacks.length,1);
    source._stompPendingUntil=2000; source.grounded=true;
    resolveStomp(room,source,1100);
    left._attackInterruptedUntil=0;
    callbacks.forEach(fn=>fn());
    assert.equal(room._activeAttacks.length,0);
  }
});
test('bot receives real outward velocity while its attack and channel are cancelled', () => {
  const {room,source,left}=fixture();
  left.isBot=true; left.effects={dravenInfernoUntil:5000}; left._botActionUntil=5000;
  source._stompPendingUntil=2000; source.grounded=true; room._botNow=1100;
  resolveStomp(room,source,1100);
  assert.ok(left.vx<0 && left.vy<0);
  assert.equal(left._botActionUntil,0);
  assert.equal(left.effects.dravenInfernoUntil,0);
});
test('local stomp interruption restores dash gravity and preserves the outward impulse', () => {
  const fs=require('node:fs'), vm=require('node:vm'), babel=require('@babel/core');
  const exports={}, handlers={}; let interrupted=0, cleaned=0;
  const player={active:true,body:{allowGravity:false,velocity:{x:0,y:0},blocked:{down:true}},
    _dash:{allowGravity:true}, _thorgAttackCleanup:()=>cleaned++,
    setVelocityX(x){this.body.velocity.x=x;},setVelocityY(y){this.body.velocity.y=y;},
    setMaxVelocity(){},setAccelerationX(){},setDragX(){},emit(){}};
  const source=fs.readFileSync(require.resolve('../src/client/game/players/localSocketEvents'),'utf8');
  vm.runInNewContext(babel.transformSync(source,{babelrc:false,configFile:false,
    presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code,{exports,Date,window:{},require:path=>
      path.includes('movementPhysics')?require('../src/shared/physics/movementPhysics.json'):
      path.includes('shockwaveImpulse')?require('../src/shared/physics/shockwaveImpulse'):
      path.includes('scene/dash')?{endDash:p=>{p.body.allowGravity=p._dash.allowGravity;p._dash=null;}}:
      {playSpriteAnimation(){}}});
  const dispose=exports.bindLocalSocketEvents({socket:{on:(e,fn)=>handlers[e]=fn,off(){}},
    getPlayer:()=>player,getDead:()=>false,getScene:()=>({}),onAttackInterrupted:()=>interrupted++});
  handlers['player:knockback']({cause:'stomp',amountX:-460,amountY:-280,radial:true});
  assert.equal(player._dash,null); assert.equal(player.body.allowGravity,true);
  assert.equal(interrupted,1); assert.equal(cleaned,1);
  assert.equal(player.body.velocity.x,-460); assert.ok(player.body.velocity.y<0);
  assert.ok(player._attackInterruptedUntil>Date.now());
  assert.equal(player._externalControlLockUntil,undefined);
  dispose();
});

test('a local downward air dash shows its stomp on landing, and the server echo does not repeat it', () => {
  const { loadClientModule } = require('./helpers/clientModule');
  const shown = [], sounds = [];
  const effectsStub = { MOVEMENT_VFX_CONFIG: { landingMaxVelocity: 796, landingShockwaveMinFallPx: 163 },
    spawnLandingImpact: () => shown.push('landing'), spawnStompImpact: () => shown.push('stomp') };
  const fx = loadClientModule('src/client/game/players/localMovementFx.js', { Date, require: (path) =>
    path.includes('scene/effects') ? effectsStub :
    path.includes('movementAudio') ? { shouldPlayLandingSound: () => false, terrainLandingSound: () => ({}) } :
    path.includes('movementSounds') ? { movementSoundKey: (_s, key) => key } : {} });
  const movement = fx.createLocalMovementFx({ audio: {}, noteEvent() {} });
  const scene = { sound: { play: (key) => sounds.push(key) } };
  const player = { x: 100, y: 100, height: 60, body: { touching: { down: false }, velocity: { y: 900 },
    center: { x: 100 }, bottom: 130, width: 40 } };
  const land = () => {
    player.body.touching.down = false;
    movement.updateLanding(scene, player, { dead: false, hidden: false });
    player.body.touching.down = true;
    movement.updateLanding(scene, player, { dead: false, hidden: false });
  };

  player._stompArmedUntil = Date.now() + 500;
  land();
  assert.deepEqual(shown, ['stomp']);
  assert.deepEqual(sounds, ['sfx-stomp']);
  land();
  assert.deepEqual(shown, ['stomp', 'landing'], 'an ordinary landing afterwards is not a stomp');

  // The server's confirmation for that stomp must not draw or play it again.
  const fs = require('node:fs'), vm = require('node:vm'), babel = require('@babel/core');
  const exports = {}, handlers = {};
  const source = fs.readFileSync(require.resolve('../src/client/game/players/localSocketEvents'), 'utf8');
  vm.runInNewContext(babel.transformSync(source, { babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }).code, { exports, Date, window: {},
    require: (path) => path.includes('movementPhysics') ? require('../src/shared/physics/movementPhysics.json') :
      path.includes('scene/effects') ? effectsStub : { playSpriteAnimation() {}, playPlayerSound() {} } });
  const dispose = exports.bindLocalSocketEvents({ socket: { on: (e, fn) => handlers[e] = fn, off() {} },
    getPlayer: () => player, getDead: () => false, getScene: () => scene, getUsername: () => 'me',
    getOpponentPlayersRef: () => ({}) });
  handlers['player:stomp']({ username: 'me', x: 100, y: 130, interrupted: [] });
  assert.deepEqual(shown, ['stomp', 'landing']);
  assert.deepEqual(sounds, ['sfx-stomp']);
  handlers['player:stomp']({ username: 'me', x: 100, y: 130, interrupted: [] });
  assert.deepEqual(shown, ['stomp', 'landing', 'stomp'], 'an unpredicted server stomp is still shown');
  dispose();
});
