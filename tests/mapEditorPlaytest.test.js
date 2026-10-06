const test=require('node:test');
const assert=require('node:assert/strict');
const {MapPlaytestService}=require('../src/server/services/maps/mapPlaytestService');
const defaults=require('../src/shared/maps').mapDefaults;
const {clone}=require('../src/shared/maps/mapDocument');
const {mapArena}=require('../src/shared/maps/arenas');

test('real playtest rooms isolate owners, fill the map mode with bots, respawn and clean up without matchmaking persistence',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000000});t.mock.method(console,'log',()=>{});
 const service=new MapPlaytestService(),emitted=[];
 service.namespace={sockets:new Map(),to(){return{emit(type,payload){emitted.push({type,payload});},compress(){return this;}};},in(){return{disconnectSockets(){}};}};
 t.after(()=>{for(const token of service.sessions.keys())service.remove(token);});
 const user={user_id:99,name:'MapTester',password_hash:'not-public',char_class:'ninja',char_levels:{ninja:1},trophies:100};
 const map=defaults.find(d=>mapArena(d).playersPerTeam===3);
 const created=service.create(user,{document:clone(map),bots:true,debugHitboxes:true});
 const session=service.get(created.session,user),room=session.room;
 assert.equal(session.gameData.editorDebugHitboxes,true);assert.equal(room.matchData.editorDebugHitboxes,true);
 assert.equal(session.gameData.players.length,6);assert.equal(session.gameData.players.filter(p=>p.isBot).length,5);
 assert.ok(!JSON.stringify(session.gameData).includes('not-public'));
 assert.throws(()=>service.get(created.session,{user_id:100}),e=>e.status===404);
 assert.equal(room.geometry.world.width,mapArena(map).world.width);assert.equal(room.matchData.modeVariantId,map.modeVariantId);
 let writes=0;room.db={runQuery(){writes++;throw Error('Playtest persistence attempted');}};
 await room._finishGame();await room._distributeMatchRewards();assert.equal(writes,0);
 const bot=[...room.players.values()][0];assert.ok(bot,'real GameRoom initializes its bot roster');
 bot.isAlive=false;bot.health=0;const plan=room.gameMode.getRespawnPlan(bot);room._scheduleRespawn(bot,plan);
 t.mock.timers.tick(plan.delayMs+1);assert.equal(bot.isAlive,true);assert.ok(bot.health>0);assert.ok(emitted.some(e=>e.type==='player:respawn'));
 service.remove(created.session);assert.equal(service.sessions.size,0);assert.equal(room._disposed,true);
});
