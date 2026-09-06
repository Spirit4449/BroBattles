// Isolated local lab: no account, production database, or production server required.
// node scripts/huntress-network-lab.cjs
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');
const webpack = require('webpack');
const { Server } = require('socket.io');
const { GameRoom } = require('../src/server/core/gameRoom');
const combat = require('../src/server/core/gameRoom/huntressCombat');
const attacks = require('../src/server/core/gameRoom/attackRuntimeManager');
const { characterBody } = require('../src/shared/duelGeometry');
const { STEP_MS } = require('../src/shared/huntressProjectile');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'huntress-lab-'));
const app = express(), server = http.createServer(app), io = new Server(server);
const labs = new Map();
const stats = { frames: {}, rooms: {} };
function lab(version, rtt, jitter) {
  const key = `${version}-${rtt}-${jitter}`;
  if (labs.has(key)) return labs.get(key);
  const matchId = labs.size + 1000;
  let bytes = 0;
  const delayedIo = { sockets: io.sockets, to(channel) { return { compress() { return this; }, emit(type, data) {
    bytes += Buffer.byteLength(JSON.stringify(data));
    const delay = Math.max(0, rtt / 2 + (jitter ? Math.sin(bytes) * 12 : 0));
    setTimeout(() => io.to(channel).emit(type, data), delay);
  } }; } };
  const roster = [0,1].map(i => ({ participantId:`bot:lab:${i}`, name:`Lab${i}`, char_class:'huntress',
    isBot:true, team:i ? 'team2':'team1', level:1, trophies:1000, seed:i+1 }));
  const room = new GameRoom(matchId,{ mode:1, modeId:'duels', modeVariantId:'duels-1v1',map:1,players:roster },{
    io:delayedIo,db:{runQuery:async()=>[]},
  });
  room.huntressCombatVersion=version;room.status='active';room._netTestEnabled=true;
  room.botControllers.clear();room._checkVictoryCondition=()=>{};
  room.geometry={world:{x:0,y:0,width:900,height:500},colliders:[{id:'floor',left:0,right:900,top:420,bottom:500}]};
  const players=[...room.players.values()];
  players.forEach((p,i)=>{
    const body=characterBody('huntress');
    Object.assign(p,{isBot:false,x:i?650:150,y:300,loaded:true,health:100000000,maxHealth:100000000,
      _bodyHalfWidth:body.halfWidth,_bodyHalfHeight:body.halfHeight,_bodyCenterOffsetX:body.offsetX,
      _bodyCenterOffsetY:body.offsetY,_lastWidth:body.displayWidth,_lastHeight:body.displayHeight});
  });
  room._simulationMono=performance.now();
  const value={room,players,rtt,jitter,times:[],bytes:()=>bytes};labs.set(key,value);return value;
}
io.on('connection',socket=>{
  const q=socket.handshake.query, version=q.version==='1'?1:2;
  const rtt=[0,50,100,150].includes(Number(q.rtt))?Number(q.rtt):0;
  const l=lab(version,rtt,q.jitter==='1'), {room,players}=l;
  const p=players[q.client==='1'?1:0];p.socketId=socket.id;p.connected=true;
  socket.join(`game:${room.matchId}`);
  const later=fn=>setTimeout(fn,Math.max(0,rtt/2+(l.jitter?Math.sin(performance.now())*12:0)));
  later(()=>socket.emit('lab:init',{combat:combat.bootstrap(room),players:players.map(p=>({...p,body:characterBody('huntress')})),username:p.name}));
  socket.on('game:action',data=>later(()=>room.handlePlayerAction(p.participantId,data)));
  socket.on('game:special',data=>later(()=>room.requestSpecial(p.participantId,data)));
  socket.on('hit',data=>later(()=>room.handleHit(p.participantId,data)));
  socket.on('game:clock',(_data,ack)=>later(()=>{const response=combat.timing(room);later(()=>ack(response));}));
  socket.on('lab:metrics',data=>{stats.frames[`${version}-${rtt}-${p.name}`]=data;});
  socket.on('disconnect',()=>{p.connected=false;});
});
let previous=performance.now(),acc=0;
const timer=setInterval(()=>{
  const now=performance.now();acc+=Math.min(250,now-previous);previous=now;
  while(acc>=STEP_MS){
    acc-=STEP_MS;
    for(const [key,l] of labs){
      const {room}=l;room._simulationMono+=STEP_MS;room._tickId++;
      const start=performance.now();
      room.processTick();attacks.tickActiveAttacks(room);combat.tick(room);
      l.times.push(performance.now()-start);if(l.times.length>600)l.times.shift();
      if(room._tickId%2===0)room.broadcastSnapshot();
      if(room._tickId%120===0){
        const sorted=l.times.slice().sort((a,b)=>a-b);
        stats.rooms[key]={tickP95Ms:sorted[Math.floor(sorted.length*.95)],bytes:l.bytes(),samples:l.times.length};
      }
    }
  }
},4);
app.use('/assets',express.static(path.join(root,'public/assets')));
app.get('/phaser.js',(_req,res)=>res.sendFile(require.resolve('phaser/dist/phaser.js')));
app.get('/lab.js',(_req,res)=>res.sendFile(path.join(output,'lab.js')));
app.get('/stats',(_req,res)=>res.json(stats));
app.get('/client',(_req,res)=>res.type('html').send('<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#101725;color:white;font:14px sans-serif}button{margin:8px}pre{white-space:pre-wrap}</style><button id="fire">Fire</button><button id="auto">Auto fire</button><span id="status">Connecting</span><div id="game"></div><pre id="metrics"></pre><script src="/phaser.js"></script><script src="/lab.js"></script>'));
app.get('/',(req,res)=>{
  const params=new URLSearchParams({version:req.query.version==='1'?'1':'2',rtt:String(req.query.rtt||0),jitter:String(req.query.jitter||0)});
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Huntress network lab</title><style>body{background:#101725;color:white;font:16px sans-serif}iframe{border:1px solid #667;width:920px;height:670px}</style><h1>Huntress network lab</h1><p>Two isolated clients · ${params.toString()} · <a href="/stats">Metrics</a></p><iframe src="/client?${params}&client=0"></iframe><iframe src="/client?${params}&client=1"></iframe>`);
});
webpack({mode:'development',devtool:false,entry:path.join(root,'tests/browser/huntressLab.js'),
  output:{path:output,filename:'lab.js'},module:{rules:[{test:/\.js$/,exclude:/node_modules/,use:{loader:require.resolve('babel-loader')}}]},
},(error,result)=>{
  if(error||result.hasErrors()){console.error(error||result.toString({all:false,errors:true}));process.exitCode=1;clearInterval(timer);return;}
  server.listen(3017,'127.0.0.1',()=>console.log('Huntress lab: http://127.0.0.1:3017/?rtt=100&jitter=1'));
});
function close(){clearInterval(timer);for(const l of labs.values())l.room.cleanup();io.close();server.close();fs.rmSync(output,{recursive:true,force:true});}
process.once('SIGINT',()=>{close();process.exit(0);});process.once('SIGTERM',()=>{close();process.exit(0);});
