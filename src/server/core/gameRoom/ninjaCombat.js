const model=require('../../../shared/ninjaProjectile');
const {sweep}=require('../../../shared/huntressProjectile');
const {characterBody}=require('../../../shared/duelGeometry');
const {participantId,getParticipant}=require('./participants');
const {timing}=require('./huntressCombat');
function initialize(room){room.ninjaCombatVersion=model.VERSION;room._ninja={active:new Map(),pending:[],requests:new Map(),terminals:[]};}
function emit(room,p,action){room.io.to(`game:${room.matchId}`).emit('game:action',{playerName:p.name,character:'ninja',action:{...action,ninjaCombatVersion:model.VERSION,ownerEcho:true,...timing(room)}});}
function ammo(p){return {ammoState:{...p.ammoState},revision:p._ninjaRevision=(p._ninjaRevision||0)+1};}
function request(room,p,data={},special=false){
  const state=room._ninja,now=Date.now(),id=typeof data.id==='string'?data.id.slice(0,128):'';
  const key=`${participantId(p)}:${id}`;
  if(state.requests.has(key)){emit(room,p,state.requests.get(key));return state.requests.get(key).accepted;}
  if(!p._ninjaWindow||now-p._ninjaWindow.at>=1000)p._ninjaWindow={at:now,count:0};
  if(++p._ninjaWindow.count>20)return false;
  const angle=Number(special?data.aim?.angle:data.angle);
  let reason=null;
  if(!id||!Number.isFinite(angle))reason='invalid-request';
  else if(room.status!=='active'||!p.isAlive||!p.loaded||p.connected===false)reason='inactive';
  else if(p._controlLockUntil>now)reason='locked';
  else if(special?p.superCharge<p.maxSuperCharge:!p.ammoState||p.ammoState.charges<=0||p.ammoState.nextFireInMs>0)reason='not-ready';
  if(!reason){
    if(special){p.superCharge=0;room.io.to(`game:${room.matchId}`).emit('super-update',{username:p.name,charge:0,maxCharge:p.maxSuperCharge});}
    else {p.ammoState.charges--;p.ammoState.nextFireInMs=p.ammoState.cooldownMs;}
    p.lastCombatAt=now;
    p._visibleAttack={at:now,startupMs:0,angle};
    if(special)room.io.to(`game:${room.matchId}`).emit('player:special',{username:p.name,character:'ninja',aim:{angle}});
    const count=special?model.swarmConfig().count:1;
    for(let i=0;i<count;i++)state.pending.push({owner:participantId(p),requestId:id,angle,index:special?i:null,
      due:room._tickId+Math.ceil((special?i*model.swarmConfig().releaseMs:0)/model.STEP_MS)});
  }
  const result={type:'ninja-result',requestId:id,accepted:!reason,reason:reason||'accepted',...ammo(p)};
  state.requests.set(key,result);while(state.requests.size>512)state.requests.delete(state.requests.keys().next().value);
  emit(room,p,result);return !reason;
}
function targets(room,p){
  const list=[];
  for(const t of room.players.values()){
    if(t===p||t.team===p.team||!t.isAlive||!t.loaded)continue;
    const body=characterBody(t.char_class,t.flip),x=t.x+(t._bodyCenterOffsetX??body.offsetX),y=t.y+(t._bodyCenterOffsetY??body.offsetY),w=t._bodyHalfWidth??body.halfWidth,h=t._bodyHalfHeight??body.halfHeight;
    list.push({name:t.name,movementReportAgeMs:!t.isBot&&t._lastPositionPacketAt>0?Math.max(0,Date.now()-t._lastPositionPacketAt):null,bounds:{left:x-w,right:x+w,top:y-h,bottom:y+h}});
  }
  const team=p.team==='team1'?'team2':'team1',v=room.gameMode?.getVaultState?.(team);
  if(v?.health>0)list.push({name:`vault:${team}`,bounds:{left:v.x-(v.width||150)/2,right:v.x+(v.width||150)/2,top:v.y-(v.height||180)/2,bottom:v.y+(v.height||180)/2}});
  return list;
}
function finish(room,entry,p,reason){
  const state=room._ninja,projectile=entry.projectile;
  state.active.delete(projectile.id);
  if(reason==='returned'&&!projectile.special&&p.isAlive){p.ammoState.charges=Math.min(p.ammoState.capacity,p.ammoState.charges+1);}
  const event={type:'ninja-terminal',id:projectile.id,requestId:entry.requestId,reason,x:projectile.x,y:projectile.y,...ammo(p),...timing(room)};
  state.terminals.push(event);if(state.terminals.length>512)state.terminals.shift();emit(room,p,event);
}
function tick(room){
  const state=room._ninja;if(!state)return;
  for(const p of room.players.values())if(!p.isBot&&p.char_class==='ninja'&&p.isAlive)require('../bots/combat').advanceAmmo(p,model.STEP_MS);
  const pending=state.pending;state.pending=[];
  for(const cast of pending){
    const p=getParticipant(room,cast.owner);if(!p)continue;
    if(!p.isAlive||p.connected===false||!p.loaded){
      const q=model.launch(p,cast.angle,`${p.name}:${cast.requestId}:${cast.index??0}`,cast.index);
      finish(room,{projectile:q,requestId:cast.requestId},p,'owner-unavailable');continue;
    }
    if(cast.due>room._tickId){state.pending.push(cast);continue;}
    const id=`${p.name}:${cast.requestId}:${cast.index??0}`,projectile=model.launch(p,cast.angle,id,cast.index);
    projectile.launchMono=room._simulationMono;projectile.ownerName=p.name;
    const entry={projectile,owner:cast.owner,requestId:cast.requestId,hits:new Set()};state.active.set(id,entry);
    emit(room,p,{type:'ninja-launch',requestId:cast.requestId,projectile});
  }
  for(const entry of state.active.values()){
    const p=getParticipant(room,entry.owner),q=entry.projectile;if(!p) {state.active.delete(q.id);continue;}
    if(!p.isAlive||!p.loaded||p.connected===false){finish(room,entry,p,'owner-unavailable');continue;}
    if(q.launchMono===room._simulationMono)continue;
    q.returnTarget={x:p.x,y:p.y};
    const oldPhase=q.phase,segments=model.step(q,p,room.geometry?.colliders||[]);
    for(const segment of segments){
      if(q.elapsed<60)continue;
      const contacts=targets(room,p).map(t=>({...t,t:sweep(segment.a,segment.b,t.bounds,q.cfg.collisionRadius)}))
        .filter(t=>t.t!==null&&!(segment.terrain&&t.t>=1)).sort((a,b)=>a.t-b.t||a.name.localeCompare(b.name));
      for(const hit of contacts){
        const key=`${segment.phase}:${hit.name}`;if(entry.hits.has(key))continue;entry.hits.add(key);
        const instanceId=`${q.id}:${segment.phase}`;
        entry.contact={instanceId,target:hit.name};
        const result=room.handleHit(entry.owner,{attacker:p.name,target:hit.name,attackType:q.special?'ninja-special-swarm':'basic',instanceId,attackTime:Date.now()}, {server:true,ninjaProjectile:entry});
        entry.contact=null;
        if(result?.accepted)emit(room,p,{type:'ninja-impact',id:q.id,phase:segment.phase,target:hit.name,movementReportAgeMs:hit.movementReportAgeMs??null,
          x:segment.a.x+(segment.b.x-segment.a.x)*hit.t,y:segment.a.y+(segment.b.y-segment.a.y)*hit.t,appliedDamage:result.appliedDamage});
      }
    }
    if(q.done){finish(room,entry,p,q.reason);continue;}
    // Return homing depends on reported owner movement: sparse corrections keep
    // clients aligned without sending every shuriken at the player snapshot rate.
    if(oldPhase!==q.phase||(q.phase==='return'&&room._tickId%6===0))emit(room,p,{type:'ninja-state',id:q.id,state:{x:q.x,y:q.y,elapsed:q.elapsed,phase:q.phase,currentReturnSpeed:q.currentReturnSpeed,returnTarget:q.returnTarget}});
  }
}
function trusted(room,entry,payload){return !!entry&&room._ninja?.active.get(entry.projectile.id)===entry&&entry.contact?.instanceId===payload.instanceId&&entry.contact.target===payload.target;}
function bootstrap(room){return {ninjaCombatVersion:room.ninjaCombatVersion,...timing(room),colliders:room.geometry?.colliders||[],
  active:[...room._ninja.active.values()].map(e=>({projectile:e.projectile,requestId:e.requestId})),terminals:room._ninja.terminals};}
function dispose(room) {
  const state = room._ninja;
  if (!state) return;
  state.active.clear();
  state.pending.length = 0;
  state.terminals.length = 0;
  state.requests.clear();
}
module.exports={dispose,initialize,request,tick,trusted,bootstrap};
