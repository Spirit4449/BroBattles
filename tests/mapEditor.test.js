const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {clone,MapHistory,validateDocument,validateMap,geometryFromMap,constrainPoint,resolvePowerupPoints}=require('../src/shared/maps/mapDocument');
const defaults=require('../src/shared/maps').mapDefaults;
const {MapRepository}=require('../src/server/services/maps/mapRepository');
const {validateAssets}=require('../src/server/services/maps/mapAssetValidation');
const {mapArena}=require('../src/shared/maps/arenas');
const {allRows,snapMove,resizeRow,removeRows,retargetMap}=require('../src/client/editor/editorModel');
const {spawnForParticipant,characterBody}=require('../src/shared/physics/duelGeometry');
const powerups=require('../src/server/core/gameRoom/powerupManager');
const frameNames=Object.keys(require("../src/shared/characters/index.js").characterFrames);
function repository(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bb-maps-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new MapRepository(dir);}

test('every map is made for a mode with an arena, has valid assets and safe spawns for every character',()=>{
 for(const doc of defaults){assert.deepEqual(validateDocument(doc),[]);assert.deepEqual(validateAssets(doc),[]);
  const arena=mapArena(doc);assert.ok(arena,`${doc.id} names a mode with an arena`);
  const g=geometryFromMap(doc);for(const char of frameNames)for(const team of ['team1','team2'])for(let slot=0;slot<arena.playersPerTeam;slot++){
   const body=characterBody(char);const p=spawnForParticipant(g,{char_class:char,team},slot);const bottom=p.y+body.offsetY+body.halfHeight;
   assert.ok(g.colliders.some(c=>c.collision.up&&Math.abs(c.top-bottom-2)<.001),`${doc.id}/${char}/${team}/${slot}`);
  }
 }
});
test('save/reopen is lossless, rejects stale revisions, and snapshots preserve live map geometry',t=>{
 const repo=repository(t);const original=repo.get(1);const doc=clone(original.document);doc.layout.platforms.push({...clone(doc.layout.platforms[1]),id:'new-platform',x:1900,y:-200});
 const live=repo.forMatch(77,1);const saved=repo.save(doc,original.revision);assert.deepEqual(repo.get(1),saved);assert.notEqual(saved.revision,original.revision);
 assert.throws(()=>repo.save(doc,original.revision),e=>e.status===409);
 assert.equal(repo.forMatch(77,1).map.layout.platforms.length,live.map.layout.platforms.length);
 assert.equal(repo.forMatch(78,1).map.layout.platforms.length,live.map.layout.platforms.length+1);
 assert.deepEqual(new MapRepository(repo.directory).get(1),saved);
 assert.ok(fs.existsSync(path.join(repo.directory,'history','1',original.revision+'.json')));
});
test('new maps can be created and listed without changing source modules',t=>{
 const repo=repository(t),doc=clone(defaults[0]),id=Math.max(...defaults.map(d=>d.id))+1;doc.id=id;doc.label='Bigger Peaks';doc.metadata={...doc.metadata,key:'bigger-peaks'};
 repo.save(doc,null);assert.equal(repo.list().length,defaults.length+1);assert.equal(repo.forMatch(91,id).mapId,id);assert.throws(()=>repo.save(doc,null),e=>e.status===409);
});
test('invalid maps never replace the last good saved map',t=>{
 const repo=repository(t),{document,revision}=repo.get(1);const mutations=[d=>d.bounds={world:{x:0,y:0,width:5000,height:1000}},d=>d.modeVariantId='duels-9v9',d=>d.spawns.players.team1.push(clone(d.spawns.players.team1[0])),d=>d.layout.platforms[1].id='p0',d=>d.textureSizes['lushy-base'].width=999,d=>d.spawns.players.team1[0].anchorId='deleted',d=>d.powerups.types=['bogus'],d=>d.assets['lushy-base'].url='/assets/../.env',d=>d.scenery.layers=[]];
 for(const mutate of mutations){const doc=clone(document);mutate(doc);assert.throws(()=>repo.save(doc,revision),e=>e.status===422,mutate.toString());assert.equal(repo.get(1).revision,revision);}
 for(const bad of [null,{},[],{layout:{platforms:null}}, {...clone(document),layout:{platforms:[null],hitboxes:[]}}])assert.ok(validateMap(bad).length);
});
test('moving anchored platforms moves spawns and powerups on both runtime paths',()=>{
 const m=clone(defaults[0]);const point=m.spawns.players.team1[0];const id=point.anchorId;const g=geometryFromMap(m);const p0=spawnForParticipant(g,{team:'team1',char_class:'ninja'},0);
 const platform=m.layout.platforms.find(p=>p.id===id);platform.x+=48;
 const next=spawnForParticipant(geometryFromMap(m),{team:'team1',char_class:'ninja'},0);assert.equal(next.x-p0.x,48);
 assert.deepEqual(powerups.getPlatformSpawnPoints({geometry:geometryFromMap(m)}),resolvePowerupPoints(geometryFromMap(m)));
 assert.throws(()=>removeRows(m,[id]),/supports a spawn/);
});
test('free dragging bypasses alignment but never creates a floating spawn',()=>{
 const m=clone(defaults[0]);const row=allRows(m).find(r=>r.id==='p1');const moved=snapMove(m,row,1234.5,201.25,16,true);assert.equal(moved.value.x,1235);assert.equal(moved.value.y,201);
 const spawn=allRows(m).find(r=>r.kind==='spawn');const anchored=snapMove(m,spawn,10000,-5000,16,true);assert.ok(geometryFromMap(m).anchors[anchored.value.anchorId]);assert.equal(anchored.value.y,undefined);
});
test('a map copied into another mode takes that mode\'s spawn slots and objectives',()=>{
 const duel=defaults.find(d=>mapArena(d).modeId==='duels'&&mapArena(d).playersPerTeam===1),bank=defaults.find(d=>mapArena(d).modeId==='bank-bust');
 const team=retargetMap(duel,'duels-2v2');assert.equal(team.modeVariantId,'duels-2v2');
 for(const side of ['team1','team2'])assert.equal(team.spawns.players[side].length,2);
 assert.deepEqual(validateDocument(team),[]);assert.equal(duel.modeVariantId,'duels-1v1','the original is unchanged');
 assert.throws(()=>retargetMap(duel,'bank-bust-3v3'),/vaults/);
 const fromBank=retargetMap(bank,'duels-1v1');assert.equal(fromBank.objectiveLayout,undefined);assert.equal(fromBank.spawns.players.team1.length,1);
 assert.deepEqual(validateDocument(fromBank),[]);
});
test('resize keeps opposite edge fixed, scales collider, and supports proportional resize',()=>{
 const p={x:100,y:100,scaleX:1,scaleY:1,body:{width:80,height:20,offsetX:10,offsetY:30}};
 const next=resizeRow(p,'e',250,100,{width:100,height:100},false);assert.equal(next.x,150);assert.equal(next.scaleX,2);assert.equal(next.scaleY,1);assert.equal(next.body.width,160);assert.equal(next.x-100,50);
 const uniform=resizeRow(p,'se',250,250,{width:100,height:100},true);assert.equal(uniform.scaleX,uniform.scaleY);
});
test('history restores additions, deletions and settings with bounded undo and redo branching',()=>{
 const doc=clone(defaults[0]);const history=new MapHistory(doc,250);const before=clone(doc);doc.layout.hitboxes.push({id:'extra',x:1,y:2,width:50,height:10});doc.powerups.maxActive=7;history.commit(doc);
 assert.deepEqual(history.undo(),before);assert.deepEqual(history.redo(),doc);history.undo();doc.label='Branch';history.commit(doc);assert.equal(history.index,history.stack.length-1);assert.equal(history.redo().label,'Branch');
 for(let i=0;i<300;i++){doc.label=`change-${i}`;history.commit(doc);}assert.equal(history.stack.length,250);assert.equal(history.undo().label,'change-298');
});
test('empty powerup list disables spawning and per-map rules are applied',()=>{
 const m=clone(defaults[0]);m.spawns.powerups=[];assert.deepEqual(powerups.getPlatformSpawnPoints({geometry:geometryFromMap(m)}),[]);
 m.spawns.powerups=[constrainPoint(m,{id:'fixed',type:'freeze'},1150,650,{width:32,height:40})];m.powerups={...m.powerups,maxActive:1,omenMs:123,spawnLift:11,despawnMs:456};
 const room={status:'active',geometry:geometryFromMap(m),_powerups:new Map(),_nextPowerupId:1};powerups.spawnPowerup(room);powerups.spawnPowerup(room);assert.equal(room._powerups.size,1);const p=[...room._powerups.values()][0];assert.equal(p.type,'freeze');assert.equal(p.activeAt-p.spawnedAt,123);assert.equal(p.expiresAt-p.activeAt,456);assert.equal(p.y,resolvePowerupPoints(room.geometry)[0].y-11);
});
test('admin routes reject non-admin reads and writes and enforce revision protocol',async()=>{
 const handlers={};const app={get:(url,fn)=>handlers[`GET ${url}`]=fn,put:(url,fn)=>handlers[`PUT ${url}`]=fn,post:(url,fn)=>handlers[`POST ${url}`]=fn,delete:(url,fn)=>handlers[`DELETE ${url}`]=fn};
 require('../src/server/routes/modules/mapEditorRoutes').registerMapEditorRoutes({app,requireCurrentUser:async()=>({}),isAdminUser:()=>false,pageRoot:'/tmp'});
 for(const[key,handler]of Object.entries(handlers).filter(([key])=>!key.startsWith('GET /assets/map-revisions/'))){const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({method:key.split(' ')[0]},res);assert.equal(res.code,403,key);}
});
