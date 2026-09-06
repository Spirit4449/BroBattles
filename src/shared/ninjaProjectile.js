const { getResolvedCharacterAttackConfig, getResolvedCharacterAimConfig, getResolvedCharacterSpecialConfig } = require('../lib/characterTuning');
const { sweep } = require('./huntressProjectile');
const STEP_MS = 1000 / 60;
const VERSION = 1;
function config() { return getResolvedCharacterAttackConfig('ninja', 'returningShuriken'); }
function swarmConfig() { return getResolvedCharacterSpecialConfig('ninja', 'swarm'); }
function launch(pose, angle, id, index = null) {
  const basic = config(), aim = getResolvedCharacterAimConfig('ninja'), swarm = swarmConfig();
  const special = index !== null, direction = Math.cos(angle) < 0 ? -1 : 1;
  if (special) angle = direction < 0 ? Math.PI : 0;
  const spread = special ? index - (swarm.count - 1) / 2 : 0;
  const yOffset = spread * swarm.yOffsetPerShard, fan = spread * swarm.fanStrengthPerShard;
  const cfg = special ? { ...basic, forwardDistance: swarm.forwardDistanceBase + Math.abs(spread) * swarm.forwardDistancePerShard,
    outwardDuration: swarm.outwardDurationBase + Math.abs(spread) * swarm.outwardDurationPerShard,
    returnSpeed: swarm.returnSpeed, endYOffset: fan,
    ctrl1YOffset: swarm.ctrl1YOffsetBase + yOffset * swarm.ctrl1YOffsetScale,
    ctrl2YOffset: -(swarm.ctrl2YOffsetBase + Math.abs(fan) * swarm.ctrl2YOffsetScale),
    maxLifetimeMs: swarm.maxLifetimeMs, scale: swarm.scale,
    rotationSpeed: swarm.rotationSpeedBase + Math.abs(spread) * swarm.rotationSpeedPerShard } : basic;
  const x = pose.x + (special ? direction * (swarm.spawnForwardBase + Math.abs(spread) * swarm.spawnForwardPerShard) : Math.cos(angle) * aim.anchorForwardOffset);
  const y = pose.y + (special ? swarm.spawnYBase + yOffset : aim.anchorOffsetY + Math.sin(angle) * aim.anchorForwardOffset);
  return { id, special, direction, angle, cfg, x, y, startX:x, startY:y, elapsed:0,
    phase:'outward', returnTarget:{x:pose.x,y:pose.y}, returnElapsed:0, currentReturnSpeed:cfg.returnSpeed * cfg.returnStartSpeedFactor, done:false };
}
function outward(p, elapsed) {
  const c=p.cfg, t=(1-Math.cos(Math.PI*Math.max(0,Math.min(1,elapsed/c.outwardDuration))))/2, u=1-t;
  const fx=Math.cos(p.angle),fy=Math.sin(p.angle),nx=-fy,ny=fx,d=c.forwardDistance;
  const cubic=(a,b,c,d)=>u*u*u*a+3*u*u*t*b+3*u*t*t*c+t*t*t*d;
  return { x:cubic(p.startX,p.startX+fx*d*.25+nx*c.ctrl1YOffset,p.startX+fx*d*.6-nx*Math.abs(c.ctrl2YOffset),p.startX+fx*d),
    y:cubic(p.startY,p.startY+fy*d*.25+ny*c.ctrl1YOffset,p.startY+fy*d*.6-ny*Math.abs(c.ctrl2YOffset)+c.endYOffset*.45,p.startY+fy*d+c.endYOffset) };
}
// One fixed step on both sides. Terrain turns outward shots back; returns pass
// through terrain, matching the original human boomerang behavior.
function step(p, owner, terrain = []) {
  if(p.done) return [];
  const segments=[]; p.elapsed+=STEP_MS;
  if(p.elapsed>p.cfg.maxLifetimeMs) {p.done=true;p.reason='expired';return segments;}
  if(p.phase==='outward') {
    const next=outward(p,p.elapsed), distance=Math.hypot(next.x-p.x,next.y-p.y);
    const count=Math.max(1,Math.ceil(distance/4));
    const from={x:p.x,y:p.y};
    for(let i=1;i<=count;i++) {
      const nextPoint={x:from.x+(next.x-from.x)*i/count,y:from.y+(next.y-from.y)*i/count};
      let contact=null;
      // Terrain contact uses the visible flight point, not the generous player-hit radius.
      for(const r of terrain) {const t=sweep(p,nextPoint,r,0);if(t!==null&&(!contact||t<contact.t))contact={t};}
      const end=contact?{x:p.x+(nextPoint.x-p.x)*contact.t,y:p.y+(nextPoint.y-p.y)*contact.t}:nextPoint;
      segments.push({a:{x:p.x,y:p.y},b:end,phase:'outward',terrain:!!contact});p.x=end.x;p.y=end.y;
      if(contact){p.phase='return';return segments;}
    }
    if(p.elapsed>=p.cfg.outwardDuration)p.phase='hover';
  } else if(p.phase==='hover') {
    if(p.elapsed>=p.cfg.outwardDuration+p.cfg.hoverDurationMs)p.phase='return';
  } else {
    const dx=owner.x-p.x,dy=owner.y-p.y,dist=Math.hypot(dx,dy);
    if(dist<30){p.done=true;p.reason='returned';return segments;}
    p.currentReturnSpeed=Math.min(p.cfg.returnSpeed,p.currentReturnSpeed+p.cfg.returnAcceleration*STEP_MS/1000);
    const length=Math.min(dist,p.currentReturnSpeed*STEP_MS/1000);
    const end={x:p.x+dx/dist*length,y:p.y+dy/dist*length};
    segments.push({a:{x:p.x,y:p.y},b:end,phase:'return'});p.x=end.x;p.y=end.y;
  }
  return segments;
}
module.exports={VERSION,STEP_MS,config,swarmConfig,launch,outward,step};
