// Eight authored keys, 500 ms each, matching the live 2 fps / four-second idle.
// Periodic tables keep the wrap an ordinary one-pixel step, with no duplicate
// endpoint. The heavy staff lags the shoulder; floating shards lead and trail.
const FPS=2,FRAME_COUNT=8;
const keys={body:[0,-1,-2,-2,-1,0,0,0],lean:[0,0,0,1,1,1,0,0],
 staffY:[0,0,-1,-1,-1,0,0,0],staffX:[0,0,0,0,1,1,1,0],
 handX:[0,-1,-1,0,1,1,1,0],handY:[0,0,-1,-2,-2,-1,0,0],
 cloth:[0,0,-1,-1,0,1,1,1],crystal:[0,-1,-1,0,1,1,0,0],
 leftShard:[0,0,-1,-2,-1,0,1,1],rightShard:[0,1,1,0,-1,-1,-1,0]};
const clamp=(v)=>Math.max(0,Math.min(1,v));
function idlePose(frame){
 const f=((frame%8)+8)%8, k=Object.fromEntries(Object.entries(keys).map(([n,v])=>[n,v[f]]));
 const move=(x,y)=>(u,v)=>[u-x,v-y];
 const pose={hood:move(k.lean,k.body),torso:move(k.lean,k.body),
 staff:move(k.staffX,k.staffY),grip:move(k.staffX,k.staffY),
 flame:move(k.staffX,k.staffY),crystal:move(k.staffX,k.staffY+k.crystal),
 shardLeft:move(k.staffX,k.staffY+k.leftShard),shardRight:move(k.staffX,k.staffY+k.rightShard),
 leftHand:move(k.lean+k.handX,k.handY)};
 // Each row stays whole. Shared endpoint offsets attach sleeve to wrist and
 // torso without arbitrary limb rotation or resampled fingers.
 pose.leftSleeve=(x,y)=>{let t=clamp((y-34)/11);return [x-k.lean-Math.round(k.handX*t),y-Math.round(k.body*(1-t)+k.handY*t)]};
 pose.rightSleeve=(x,y)=>{let t=clamp((x-32)/7);return [x-Math.round(k.lean*(1-t)+k.staffX*t),y-Math.round(k.body*(1-t)+k.staffY*t)]};
 pose.robe=(x,y)=>{let t=clamp((y-44)/19);return [x-Math.round(k.lean*(1-t)+k.cloth*Math.sin(Math.PI*t)),44+(y-44-k.body)*19/(19-k.body)]};
 return pose;
}
module.exports={FPS,FRAME_COUNT,keys,idlePose};
