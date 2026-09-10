import { createShurikenEffects } from './effects';
import { playSpriteAnimation } from '../shared/animationState';
import socket from '../../socket';
import { CombatClock } from '../../shared/huntressReplication';
import { VERSION, STEP_MS, launch, step, swarmConfig } from '../../shared/ninjaProjectile';
import { createRuntimeId } from '../shared/runtimeId';
import { RENDER_LAYERS } from '../../gameScene/renderLayers';
const clock=new CombatClock();
const active=new Map(),terminals=new Set(),requests=new Map(),effects=new Set();
let enabled=false,sceneRef=null,listener=null,shutdown=null,syncTimer=null,ctx={},colliders=[],revision=0,generation=0;
const copy=value=>JSON.parse(JSON.stringify(value));
export function ninjaEnabled(){return enabled;}
export function resetNinjaNetwork(){
  generation++;clearInterval(syncTimer);syncTimer=null;
  if(sceneRef&&listener)sceneRef.events.off('update',listener);
  if(sceneRef&&shutdown)sceneRef.events.off('shutdown',shutdown);
  for(const e of active.values()){e.fx?.destroy();e.sprite?.destroy();}
  for(const e of effects)e.destroy();effects.clear();
  active.clear();terminals.clear();requests.clear();clock.reset();
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
      const o=owner(e.p.ownerName)||e.p.returnTarget;
      if(e.pending){
        // Rebuild staggered releases from the current shooter pose, retaining tuning.
        const i=Number(id.slice(id.lastIndexOf(':')+1));
        e.p={...launch(o,e.p.angle,id,e.p.special?i:null),ownerName:e.p.ownerName};e.pending=false;
      }
      // Bound catch-up work after stalls; authoritative state is refreshed on return.
      let count=0;while(e.at+STEP_MS<=sim&&count++<360&&!e.p.done){step(e.p,o,colliders);e.at+=STEP_MS;}
      if(!e.sprite){e.sprite=scene.add.image(e.p.x,e.p.y,'shuriken');e.sprite.setScale(e.p.cfg.scale);e.sprite.setDepth(RENDER_LAYERS.ATTACKS);if(e.p.special)e.sprite.setTint?.(0xc7efff);
        e.fx=createShurikenEffects(scene,e.sprite,{x:e.p.startX,y:e.p.startY,angle:e.p.angle,special:e.p.special,launch:e.p.elapsed<180});}
      const next=copy(e.p);if(!next.done)step(next,o,colliders);
      const f=Math.max(0,Math.min(1,(sim-e.at)/STEP_MS));
      if(e.correction&&e.correction.x===undefined){e.correction.x=e.correction.visualX-(e.p.x+(next.x-e.p.x)*f);e.correction.y=e.correction.visualY-(e.p.y+(next.y-e.p.y)*f);}
      const blend=e.correction?Math.max(0,1-(now-e.correction.at)/60):0;
      e.sprite.setPosition(e.p.x+(next.x-e.p.x)*f+(e.correction?.x||0)*blend,e.p.y+(next.y-e.p.y)*f+(e.correction?.y||0)*blend);
      e.sprite.setRotation(e.p.elapsed*e.p.cfg.rotationSpeed*Math.PI/180000*e.p.direction);
      e.fx?.update(now,!e.p.done);
      if(e.p.done){e.sprite.setVisible?.(false);if(sim-e.at>2000)tombstone(id);continue;}e.sprite.setVisible?.(true);
      if(now-(e.trailAt||0)>45&&effects.size<180){e.trailAt=now;const trail=scene.add.image(e.sprite.x,e.sprite.y,'shuriken');trail.setScale(e.p.cfg.scale*.48);trail.setDepth(RENDER_LAYERS.ATTACKS-1);trail.alpha=.3;effects.add(trail);scene.tweens.add({targets:trail,alpha:0,duration:220,onComplete:()=>{effects.delete(trail);trail.destroy();}});}
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
      playSpriteAnimation({scene,sprite:owner(packet.playerName),character:'ninja',logical:'throw',fallback:'idle'});
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
