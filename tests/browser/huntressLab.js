import socket from '../../src/socket';
import { configureHuntressNetwork, attachHuntressScene, handleHuntressPacket,
  observeHuntressSnapshot, predictHuntressShot } from '../../src/characters/huntress/network';
import { spawnHuntressArrowVisual, stopHuntressArrowOnConfirmedHit } from '../../src/characters/huntress/attack';
import { attackConfig } from '../../src/shared/huntressProjectile';
const query=new URLSearchParams(location.search);
socket.io.opts.query=Object.fromEntries(query);
let scene,init,ctx,sequence=0,automatic=false,nextShot=0,frameTimes=[],actions=[];
function fire(){
  if(!ctx)return;
  const cfg=attackConfig(),angle=init.username==='Lab0'?-0.32:Math.PI+0.32;
  const speed=cfg.speed*(1-Math.max(0,-Math.sin(angle))*.32);
  let payload={type:'huntress-arrow',id:`lab:${++sequence}`,angle,speed};
  if(query.get('version')!=='1')payload=predictHuntressShot(scene,ctx.localPlayer,init.username,payload);
  socket.emit('game:action',payload);
}
document.getElementById('fire').onclick=fire;
document.getElementById('auto').onclick=()=>{automatic=!automatic;};
socket.on('lab:init',data=>{
  init=data;configureHuntressNetwork(data.combat);
  ctx={localUsername:data.username,opponentPlayersRef:{},teamPlayersRef:{}};
  for(const p of data.players){
    const s=scene.physics.add.sprite(p.x,p.y,'actor');s.body.allowGravity=false;
    s.setDisplaySize(p.body.displayWidth,p.body.displayHeight);
    s.body.setSize(p.body.width,p.body.height);
    s.body.setOffset((s.width-p.body.width)/2+p.body.offsetX,(s.height-p.body.height)/2+p.body.offsetY);
    // Render the authoritative contact body directly, with sprite center marked.
    scene.add.rectangle(p.x+p.body.offsetX,p.y+p.body.offsetY,p.body.width,p.body.height,p.name===data.username?0x55bbff:0xff8855,.7);
    scene.add.circle(p.x,p.y,3,0xffffff);
    scene.add.text(p.x-40,p.y-90,p.name);
    s.setAlpha(0.1);s._username=p.name;
    if(p.name===data.username)ctx.localPlayer=s;else ctx.opponentPlayersRef[p.name]={opponent:s};
  }
  attachHuntressScene(scene,ctx);
  document.getElementById('status').textContent=`${data.username} · protocol ${data.combat.huntressCombatVersion}`;
  automatic=query.get('client')==='0';
});
socket.on('game:snapshot',snapshot=>observeHuntressSnapshot(snapshot));
socket.on('game:action',packet=>{
  actions.push(packet.action.type);if(actions.length>30)actions.shift();
  if(handleHuntressPacket(scene,packet,ctx))return;
  const a=packet.action,owner=packet.playerName===ctx.localUsername?ctx.localPlayer:ctx.opponentPlayersRef[packet.playerName]?.opponent;
  if(a.type==='character-hit-confirm')stopHuntressArrowOnConfirmedHit(a.instanceId,a.target===ctx.localUsername?ctx.localPlayer:ctx.opponentPlayersRef[a.target]?.opponent,a.target);
  if(!['huntress-arrow-release','huntress-burning-arrow'].includes(a.type))return;
  const own=packet.playerName===ctx.localUsername;
  spawnHuntressArrowVisual(scene,{...a,origin:packet.origin,...(!own?{start:{x:owner.x,y:owner.y}}:{})},owner,{
    ...ctx,isOwner:own,username:init.username,attackerUsername:packet.playerName,
    targetSprites:[{sprite:own?Object.values(ctx.opponentPlayersRef)[0].opponent:ctx.localPlayer,username:own?'Lab1':'Lab0'}],
  });
});
new Phaser.Game({type:Phaser.CANVAS,width:900,height:500,parent:'game',backgroundColor:'#152238',physics:{default:'arcade',arcade:{gravity:{y:0}}},audio:{noAudio:true},scene:{
  preload(){this.load.image('huntress-arrow','/assets/huntress/arrow.webp');},
  create(){scene=this;const g=this.make.graphics({x:0,y:0,add:false});g.fillStyle(0xffffff);g.fillRect(0,0,150,150);g.generateTexture('actor',150,150);g.destroy();
    const floor=this.add.rectangle(450,460,900,80,0x365041);this.physics.add.existing(floor,true);this._mapObjects=[floor];socket.connect();},
  update(time,delta){frameTimes.push(delta);if(frameTimes.length>600)frameTimes.shift();
    if(automatic&&time>=nextShot){nextShot=time+1400;fire();}
    if(Math.floor(time/2000)!==this.lastReport){this.lastReport=Math.floor(time/2000);const sorted=frameTimes.slice().sort((a,b)=>a-b);
      const metrics={frameP95Ms:sorted[Math.floor(sorted.length*.95)],frames:frameTimes.length,actions,combat:window.__BB_HUNTRESS_DIAGNOSTICS__?.()};
      document.getElementById('metrics').textContent=JSON.stringify({frameP95Ms:metrics.frameP95Ms,events:metrics.combat?.events.slice(-3)},null,2);socket.emit('lab:metrics',metrics);}
  },
}});
