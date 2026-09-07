const {randomUUID}=require('node:crypto');
const {GameRoom}=require('../core/gameRoom');
const {createBotParticipants}=require('../core/bots/identity');
const {decorateParticipant}=require('./matchRosterService');
const {getAllCharacters,getHealth,getDamage,getSpecialDamage}=require('../../lib/characterStats');
const {clone,variantKey,validateDocument}=require('../../shared/mapDocument');
const {spawnForParticipant}=require('../../shared/duelGeometry');
const {validateAssets}=require('./mapAssetValidation');

// Real game room, with only matchmaking, rewards, timer expiry and persistence disabled.
// Character combat, bots, effects, collision, objectives and replication use GameRoom.
class EditorGameRoom extends GameRoom {
  potentialStartGame() {}
  _checkVictoryCondition() {}
  _tickTimerAndSuddenDeath() {}
  async _finishGame() {}
  async _distributeMatchRewards() {return [];}
  async _cancelMatchAsAbandoned() {this.cleanup();}
  initializeSpawnPositions() {
    const size=Number(this.mapSnapshot.variant[0]);
    for(const p of this.players.values()){
      const team=this.matchData.players.filter(m=>m.team===p.team);
      const index=Math.max(0,team.findIndex(m=>m.name===p.name));
      Object.assign(p,spawnForParticipant(this.geometry,p,index,size),{vx:0,vy:0,grounded:true,spawnIndex:index});
    }
  }
}
class MapPlaytestService {
  constructor(){this.sessions=new Map();this.namespace=null;}
  attach(io,authenticate,isAdminUser){
    const ns=io.of('/map-playtest');this.namespace=ns;
    ns.use(async(socket,next)=>{try{
      const session=this.sessions.get(socket.handshake.auth?.session);
      const user=await authenticate(socket);
      if(!session||Date.now()>session.expiresAt||!user||!isAdminUser(user)||Number(user.user_id)!==session.ownerId)return next(Error('Admin playtest session required'));
      socket.data.user=user;socket.data.editorSession=session;next();
    }catch(e){next(Error('Unable to authenticate playtest'));}});
    ns.on('connection',socket=>{
      const session=socket.data.editorSession,room=session.room;
      socket.on('game:join',async(data,cb)=>{try{
        if(Number(data?.matchId)!==room.matchId)throw Error('Wrong playtest room');
        if((room.ninjaCombatVersion===1&&data.ninjaCombatVersion!==1)||(room.huntressCombatVersion===2&&data.huntressCombatVersion!==2))throw Error('Reload the game client');
        await room.addPlayer(socket,socket.data.user);
        room.initializeSpawnPositions();
        room.sendGameStateToPlayer(socket);
        cb?.({ok:true,matchId:room.matchId});socket.emit('game:joined',{ok:true,matchId:room.matchId});
        room.onSocket(socket,'game:ready',()=>{if(!room._loopRunning){room.gameMode?.onStart?.();room.startGameLoop();}});
      }catch(e){cb?.({ok:false,error:e.message});socket.emit('game:error',{message:e.message});}});
      socket.on('disconnect',()=>{if(!room._disposed)room.removePlayer(socket,socket.data.user).catch(()=>{});});
    });
  }
  create(user,{document,variant,bots=false,character='ninja',spawn=null}){
    const errors=validateDocument(document);if(!errors.length)errors.push(...validateAssets(document));
    if(errors.length)throw Object.assign(Error('Map validation failed'),{status:422,errors});
    if(!this.namespace)throw Object.assign(Error('Playtest server is not initialized'),{status:503});
    if(!getAllCharacters().includes(character))throw Object.assign(Error('Unknown character'),{status:400});
    for(const[token,session]of this.sessions)if(session.ownerId===Number(user.user_id)||Date.now()>session.expiresAt)this.remove(token);
    const key=variantKey(variant),size=Number(key[0]),map=clone(document.variants[key]);
    // Play from a selected marker uses the same constrained spawn config as a normal match.
    if(spawn?.point){const choices=Object.values(map.spawns.players).flatMap(team=>Object.values(team).flat());if(!choices.some(p=>JSON.stringify(p)===JSON.stringify(spawn.point)))throw Object.assign(Error('Unknown spawn marker'),{status:400});const point=clone(spawn.point);for(const n of [1,2,3])map.spawns.players.team1[n][0]=point;}
    const human=decorateParticipant({...user,team:'team1',char_class:character,level:1,participantId:`user:${user.user_id}`});
    const players=[human,...(bots?createBotParticipants([human],size,{seed:42}).map(decorateParticipant):[])];
    const modeId=map.objectiveLayout?.bankBust?'bank-bust':'duels';
    const matchId=Date.now();
    const snapshot={mapId:document.id,variant:key,revision:'editor-draft',metadata:{...document.metadata,id:document.id,label:document.label},map};
    // Deliberately has no database capability: a playtest cannot award or persist anything.
    const database={runQuery:async()=>[],setUserStatus:async()=>{},setPartiesStatus:async()=>{}};
    const room=new EditorGameRoom(matchId,{mode:size,modeId,modeVariantId:`${modeId}-${key}`,map:document.id,players,editorMapSnapshot:snapshot},{io:{to:(...args)=>this.namespace.to(...args),sockets:{sockets:this.namespace.sockets}},db:database});
    room.status='active';room.DEV_TIMING_DIAG=false;
    const normalPlan=room.gameMode.getRespawnPlan.bind(room.gameMode);
    room.gameMode.getRespawnPlan=(p,meta)=>normalPlan(p,meta)||{enabled:true,delayMs:1200,shieldMs:1000,position:spawnForParticipant(room.geometry,p,p.spawnIndex||0,size)};
    const token=randomUUID();const session={token,ownerId:Number(user.user_id),room,expiresAt:Date.now()+60*60*1000,
      gameData:{matchId,mode:size,modeId,modeVariantId:`${modeId}-${key}`,map:document.id,mapSnapshot:snapshot,editorPlaytest:true,yourName:user.name,yourTeam:'team1',yourCharacter:character,isAdmin:true,isGuest:false,
        players:[]}};
    // Never expose the account row (password hashes, auth state) in a game roster.
    session.gameData.players=players.map(p=>({name:p.name,user_id:p.user_id,participantId:p.participantId,isBot:p.isBot,team:p.team,char_class:p.char_class,level:p.level,
      selected_skin_id:p.selected_skin_id,selected_skin_asset_url:p.selected_skin_asset_url,selected_skin_game_assets:p.selected_skin_game_assets,
      stats:{health:getHealth(p.char_class,p.level),damage:getDamage(p.char_class,p.level),specialDamage:getSpecialDamage(p.char_class,p.level)}}));
    session.timer=setTimeout(()=>this.remove(token),60*60*1000);session.timer.unref?.();this.sessions.set(token,session);return {session:token,matchId};
  }
  get(token,user){const s=this.sessions.get(token);if(!s||s.ownerId!==Number(user.user_id)||Date.now()>s.expiresAt)throw Object.assign(Error('Playtest not found'),{status:404});return s;}
  remove(token){const s=this.sessions.get(token);if(!s)return;clearTimeout(s.timer);s.room.cleanup();this.namespace?.in(`game:${s.room.matchId}`).disconnectSockets(true);this.sessions.delete(token);}
}
const mapPlaytests=new MapPlaytestService();
module.exports={MapPlaytestService,mapPlaytests,EditorGameRoom};
