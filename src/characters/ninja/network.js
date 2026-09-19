import { applyTeamVisual } from "../../shared/projectilePresentation";
import { presentSwarmRelease } from './swarmPresentation';
import { ninjaProjectileTexture, animateNinjaProjectile } from './projectileTexture';
import { createShurikenEffects } from './effects';
import { playSpriteAnimation, markOneShotAnimation, getAnimationDurationMs } from '../shared/animationState';
import socket from '../../socket';
import { CombatClock } from '../../shared/huntressReplication';
import { remoteLaunchCorrection, reconcileFlight } from '../../shared/projectilePresentation';
import { VERSION, STEP_MS, launch, step, swarmConfig } from '../../shared/ninjaProjectile';
import { createRuntimeId } from '../shared/runtimeId';
import { RENDER_LAYERS } from '../../gameScene/renderLayers';
const clock=new CombatClock();
const active=new Map(),terminals=new Set(),requests=new Map(),effects=new Set();
const diagnostics=[];
function record(event){diagnostics.push(event);if(diagnostics.length>120)diagnostics.shift();}
let enabled=false,sceneRef=null,listener=null,shutdown=null,syncTimer=null,ctx={},colliders=[],revision=0,generation=0;
const copy=value=>JSON.parse(JSON.stringify(value));
export function ninjaEnabled(){return enabled;}
export function resetNinjaNetwork(){
  generation++;clearInterval(syncTimer);syncTimer=null;
  if(sceneRef&&listener)sceneRef.events.off('update',listener);
  if(sceneRef&&shutdown)sceneRef.events.off('shutdown',shutdown);
  for(const e of active.values()){e.fx?.destroy();e.sprite?.destroy();}
  for(const e of effects)e.destroy();effects.clear();
  active.clear();terminals.clear();requests.clear();diagnostics.length=0;clock.reset();
  enabled=false;sceneRef=null;listener=null;shutdown=null;ctx={};revision=0;
}
// Remove combat presentation that was on screen when the browser stopped
// rendering. Keep the network runtime configured so fresh packets can resume
// normally, but never replay projectiles that crossed the arena while hidden.
export function discardNinjaPresentation(){
  for(const e of active.values()){e.fx?.destroy();e.sprite?.destroy();}
  for(const e of effects)e.destroy();
  effects.clear();active.clear();requests.clear();
}
export function configureNinjaNetwork(state){
  resetNinjaNetwork();if(state?.ninjaCombatVersion!==VERSION)return;
  enabled=true;colliders=state.colliders||[];clock.reset(state.epoch);clock.observe(state,performance.now());
  if(typeof window!=='undefined')window.__BB_NINJA_DIAGNOSTICS__=()=>({
    epoch:clock.epoch,active:active.size,rttMs:clock.samples.map(p=>p.rtt),events:diagnostics.slice(),
  });
  for(const t of state.terminals||[])terminals.add(t.id);
  for(const e of state.active||[])accept(e.projectile,state.simMono);
  const gen=generation;
  const sync=()=>{if(!socket.connected)return;const sent=performance.now();socket.timeout(1500).emit('game:clock',{},(err,p)=>{
    if(!err&&gen===generation)clock.synchronize(p,sent,performance.now());
  });};sync();syncTimer=setInterval(sync,2000);
}
export function observeNinjaSnapshot(snapshot){if(enabled)clock.observe({epoch:snapshot.snapshotEpoch,sentMono:snapshot.sentMono,simMono:snapshot.tMono},performance.now());}
function owner(name){return name===ctx.localUsername?ctx.localPlayer:ctx.opponentPlayersRef?.[name]?.opponent||ctx.teamPlayersRef?.[name]?.opponent;}
function accept(projectile,simMono){
  if(terminals.has(projectile.id))return;
  const prior=active.get(projectile.id);
  if(prior?.authoritativeAt>=simMono)return;
  active.set(projectile.id,{...prior,p:copy(projectile),at:simMono,authoritativeAt:simMono,predicted:false,
    correctionReported:false,wasPredicted:!!prior?.predicted,
    correction:prior?.sprite?{visualX:prior.sprite.x,visualY:prior.sprite.y,at:performance.now()}:null});
}
function remove(id){const e=active.get(id);e?.fx?.destroy();e?.sprite?.destroy();active.delete(id);}
function tombstone(id){terminals.add(id);while(terminals.size>512)terminals.delete(terminals.values().next().value);remove(id);}
function applyAmmo(action){
  if(action.revision<=revision)return;revision=action.revision;
  const ammo={...action.ammoState};if(!ammo.reloadMs)return;
  const age=Math.max(0,clock.now(performance.now())-action.simMono);
  ammo.nextFireInMs=Math.max(0,ammo.nextFireInMs-age);
  if(ammo.charges<ammo.capacity){const elapsed=ammo.reloadTimerMs+age;ammo.charges=Math.min(ammo.capacity,ammo.charges+Math.floor(elapsed/ammo.reloadMs));ammo.reloadTimerMs=ammo.charges===ammo.capacity?0:elapsed%ammo.reloadMs;}
  ammo.charges=Math.max(0,ammo.charges-[...requests.values()].filter(r=>!r.special&&!r.accepted).length);
  ctx.onAmmo?.(ammo);
}
export function predictNinja(scene,player,username,payload,special=false){
  if(!enabled)return payload;
  attachNinjaScene(scene,{localPlayer:player,localUsername:username});
  const id=payload.id||createRuntimeId('ninja');
  const angle=Number(special?payload.aim?.angle:payload.angle);
  const resolved=Number.isFinite(angle)?angle:player.flipX?Math.PI:0;
  const now=performance.now();
  requests.set(id,{at:now,special,accepted:false,username});
  const count=special?swarmConfig().count:1;
  for(let i=0;i<count;i++){
    const p=launch(player,resolved,`${username}:${id}:${i}`,special?i:null);p.ownerName=username;
    active.set(p.id,{p,at:clock.now(now)+(special?i*swarmConfig().releaseMs:0),due:now+(special?i*swarmConfig().releaseMs:0),predicted:true,pending:true});
  }
  return special?{id,aim:{angle:resolved}}:{type:'ninja-shuriken',id,angle:resolved};
}
export function attachNinjaScene(scene,next={}){
  ctx={...ctx,...next};if(!enabled||!scene||sceneRef===scene)return;
  sceneRef=scene;
  listener=()=>{
    const now=performance.now(),sim=clock.now(now);
    for(const [id,r] of requests)if(now-r.at>2500){requests.delete(id);if(!r.accepted)for(const [key,e]of active)if(key.startsWith(`${r.username}:${id}:`)&&e.predicted)tombstone(key);}
    for(const [id,e]of active){
      if(e.due>now)continue;
      const displayedOwner=owner(e.p.ownerName);
      // Remote actors are buffered. Homing must use the authoritative target,
      // not their older on-screen position; owners retain immediate prediction.
      const o=e.p.ownerName===ctx.localUsername ? displayedOwner||e.p.returnTarget : e.p.returnTarget||displayedOwner;
      if(e.pending){
        // Rebuild staggered releases from the current shooter pose, retaining tuning.
        const i=Number(id.slice(id.lastIndexOf(':')+1));
        e.p={...launch(o,e.p.angle,id,e.p.special?i:null),ownerName:e.p.ownerName};e.pending=false;
      }
      // Bound catch-up work after stalls; authoritative state is refreshed on return.
      let count=0;while(e.at+STEP_MS<=sim&&count++<360&&!e.p.done){step(e.p,o,colliders);e.at+=STEP_MS;}
      if(!e.sprite){
        if(e.p.special && !e.p.done && !e.releasePresented){presentSwarmRelease(scene,displayedOwner,swarmConfig().releaseMs,e.p.ownerName!==ctx.localUsername);e.releasePresented=true;}
        e.texture=ninjaProjectileTexture(scene,displayedOwner);e.sprite=scene.add.image(e.p.x,e.p.y,e.texture);e.sprite.setScale(e.p.cfg.scale);e.sprite.setDepth(RENDER_LAYERS.ATTACKS);if(e.p.special && !e.texture.includes("-weapon"))e.sprite.setTint?.(0xc7efff);applyTeamVisual(e.sprite,o || {_bbTeamColor:ctx.opponentPlayersRef?.[e.p.ownerName]?0xff413f:0x50ce88},true,e.texture.includes("-weapon")?"crown":null);
        e.fx=createShurikenEffects(scene,e.sprite,{x:e.p.startX,y:e.p.startY,angle:e.p.angle,special:e.p.special,launch:e.p.elapsed<180});
        if(e.p.ownerName!==ctx.localUsername)e.correction=remoteLaunchCorrection(displayedOwner,e.p.returnTarget,e.p.elapsed,now);
      }
      const next=copy(e.p);if(!next.done)step(next,o,colliders);
      const f=Math.max(0,Math.min(1,(sim-e.at)/STEP_MS));
      if(e.correction&&e.correction.x===undefined){
        e.correction=reconcileFlight({x:e.correction.visualX,y:e.correction.visualY},
          {x:e.p.x+(next.x-e.p.x)*f,y:e.p.y+(next.y-e.p.y)*f},now,
          Math.hypot(next.x-e.p.x,next.y-e.p.y)*1000/STEP_MS);
      }
      if(e.correction&&!e.correctionReported){e.correctionReported=true;record({type:'correction',id,at:now,phase:e.p.phase,predicted:e.wasPredicted,errorPx:Math.hypot(e.correction.x,e.correction.y)});}
      const blend=e.correction?Math.max(0,1-(now-e.correction.at)/(e.correction.duration||60)):0;
      let x=e.p.x+(next.x-e.p.x)*f+(e.correction?.x||0)*blend;
      let y=e.p.y+(next.y-e.p.y)*f+(e.correction?.y||0)*blend;
      // Confirmation can describe a younger outbound projectile than prediction.
      // Let authority catch up without visually reversing its outbound travel.
      // Real terrain turns and returns bypass this constraint immediately.
      if(e.renderPhase==='outward'&&e.p.phase==='outward'&&next.phase==='outward'){
        const fx=Math.cos(e.p.angle),fy=Math.sin(e.p.angle);
        const forward=(x-e.sprite.x)*fx+(y-e.sprite.y)*fy;
        if(forward<0){x-=forward*fx;y-=forward*fy;record({type:'backtrack-prevented',id,at:now,distancePx:-forward});}
      }
      e.sprite.setPosition(x,y);e.renderPhase=e.p.phase;
      animateNinjaProjectile(e.sprite,e.texture,e.p.elapsed,e.p.cfg.rotationSpeed,e.p.direction);
      e.fx?.update(now,!e.p.done);
      if(e.p.done){e.sprite.setVisible?.(false);if(sim-e.at>2000)tombstone(id);continue;}e.sprite.setVisible?.(true);
      if(now-(e.trailAt||0)>45&&effects.size<180){e.trailAt=now;const trail=scene.add.image(e.sprite.x,e.sprite.y,e.texture,e.sprite.frame?.name);trail.setScale(e.p.cfg.scale*.48);trail.setDepth(RENDER_LAYERS.ATTACKS-1);trail.alpha=.3;effects.add(trail);scene.tweens.add({targets:trail,alpha:0,duration:220,onComplete:()=>{effects.delete(trail);trail.destroy();}});}
    }
  };
  scene.events.on('update',listener);shutdown=()=>resetNinjaNetwork();scene.events.once('shutdown',shutdown);
}
export function handleNinjaPacket(scene,packet,next){
  const a=packet?.action;if(!enabled||a?.ninjaCombatVersion!==VERSION)return false;
  if(a.epoch!==clock.epoch)return true;
  attachNinjaScene(scene,next);clock.observe(a,performance.now());
  if(a.type==='ninja-result'){
    if(packet.playerName===ctx.localUsername){
      const r=requests.get(a.requestId);if(r)r.accepted=a.accepted;
      if(!a.accepted){requests.delete(a.requestId);for(const [id]of active)if(id.startsWith(`${packet.playerName}:${a.requestId}:`))tombstone(id);}
      applyAmmo(a);
    }
  }else if(a.type==='ninja-launch'){
    if(!a.projectile.special&&packet.playerName!==ctx.localUsername&&!active.has(a.projectile.id)&&!terminals.has(a.projectile.id)){
      const sprite=owner(packet.playerName);
      const key=playSpriteAnimation({scene,sprite,character:'ninja',logical:'throw',fallback:'idle',force:false});
      if(key)markOneShotAnimation(sprite,'throw',getAnimationDurationMs(scene,key),{remote:true});
      scene.sound?.play('shurikenThrow',{volume:.5,rate:1.3});
    }
    accept(a.projectile,a.simMono);
  }
  else if(a.type==='ninja-state'){const e=active.get(a.id);if(e)accept({...e.p,...a.state,done:false},a.simMono);}
  else if(a.type==='ninja-terminal'){tombstone(a.id);if(packet.playerName===ctx.localUsername)applyAmmo(a);}
  else if(a.type==='ninja-impact'){
    const key=`hit:${a.id}:${a.phase}:${a.target}`;if(terminals.has(key))return true;
    terminals.add(key);while(terminals.size>512)terminals.delete(terminals.values().next().value);
    if(a.appliedDamage>0)scene.sound?.play('shurikenHit',{volume:.5});
  }
  return true;
}

// Lifecycle contract consumed by the generic match and scene controllers.
export const networkAdapter = {
  key: 'ninja',
  joinFields: { ninjaCombatVersion: 1 },
  bootstrapKey: 'ninjaCombat',
  configure: configureNinjaNetwork,
  reset: resetNinjaNetwork,
  discard: discardNinjaPresentation,
  attach: attachNinjaScene,
  observe: observeNinjaSnapshot,
  handlePacket: handleNinjaPacket,
  predictSpecial: (scene, player, username, request) => predictNinja(scene, player, username, request, true),
};
