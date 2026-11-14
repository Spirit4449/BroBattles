const { loadClientModule } = require('./helpers/clientModule');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');



describe("Document editing and persistence", () => {
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
  test('both duel formations use all four maps and preserve the map when switching team size',()=>{
   const {createSelectionCatalog,getPlayersPerTeamForSelection}=require('../src/shared/gameSelection');
   const catalog=createSelectionCatalog(()=>defaults.map(require('../src/shared/maps/mapDocument').mapSummary));
   const duels=defaults.filter(d=>mapArena(d).modeId==='duels');assert.equal(duels.length,4);
   for(const modeVariantId of ['duels-1v1','duels-2v2']){
    assert.deepEqual(catalog.getCompatibleMapsForSelection({modeId:'duels',modeVariantId}).map(m=>m.id),duels.map(m=>m.id));
    for(const doc of duels){const selected=catalog.normalizeSelection({modeId:'duels',modeVariantId,mapId:doc.id});assert.equal(selected.mapId,doc.id);assert.equal(selected.modeVariantId,modeVariantId);assert.equal(getPlayersPerTeamForSelection(selected),modeVariantId==='duels-1v1'?1:2);}
   }
   assert.ok(catalog.getCompatibleMapsForSelection({modeId:'bank-bust',modeVariantId:'bank-bust-3v3'}).every(m=>m.modeId==='bank-bust'));
  });
  test('legacy saved duel maps upgrade without losing edits, arena bounds or revision protection',t=>{
   const {arenaFor}=require('../src/shared/maps/arenas');const repo=repository(t);
   for(const [id,variant]of [[1,'duels-1v1'],[5,'duels-2v2']]){
    const old=clone(defaults.find(d=>d.id===id));old.modeVariantId=variant;delete old.arenaId;old.label='Saved custom '+id;
    if(variant==='duels-1v1')for(const team of ['team1','team2'])old.spawns.players[team].length=1;
    fs.writeFileSync(path.join(repo.directory,`${id}.json`),JSON.stringify(old));
    const loaded=repo.get(id);assert.equal(loaded.document.label,old.label);assert.equal(loaded.document.modeVariantId,'duels');assert.deepEqual(loaded.document.layout,old.layout);assert.deepEqual(mapArena(loaded.document).world,arenaFor(variant).world);assert.deepEqual(mapArena(loaded.document).camera,arenaFor(variant).camera);assert.deepEqual(validateDocument(loaded.document),[]);
    for(const team of ['team1','team2'])assert.equal(loaded.document.spawns.players[team].length,2);
    const saved=repo.save(loaded.document,loaded.revision);assert.deepEqual(repo.get(id),saved);assert.throws(()=>repo.save(loaded.document,'stale'),e=>e.status===409);
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
   const duel=defaults.find(d=>mapArena(d).modeId==='duels'),bank=defaults.find(d=>mapArena(d).modeId==='bank-bust');
   const team=retargetMap(duel,'duels-2v2');assert.equal(team.modeVariantId,'duels');
   for(const side of ['team1','team2'])assert.equal(team.spawns.players[side].length,2);
   assert.deepEqual(validateDocument(team),[]);assert.equal(duel.modeVariantId,'duels','the original is unchanged');
   assert.throws(()=>retargetMap(duel,'bank-bust-3v3'),/vaults/);
   const fromBank=retargetMap(bank,'duels-1v1');assert.equal(fromBank.objectiveLayout,undefined);assert.equal(fromBank.spawns.players.team1.length,2);
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

  test('Mangrove Meadow grass catches descending players while undersides allow passage',()=>{
   const {sweepMovement}=require('../src/shared/physics/sweptCollision');
   for(const file of ['../src/shared/maps/2.json','../data/maps/2.json']){
    const geometry=geometryFromMap(require(file));
    for(const surface of geometry.colliders){
     const x=(surface.left+surface.right)/2-10;
     const below={x,y:surface.bottom+10,width:20,height:20};
     assert.equal(sweepMovement(below,0,-100,[surface]).y,below.y-100,`${surface.id} underside`);
     const above={x,y:surface.top-50,width:20,height:20};
     const landed=sweepMovement(above,0,100,[surface]);
     assert.equal(landed.y,surface.top-above.height,`${surface.id} landing`);
     const beside={x:surface.left-30,y:surface.top+2,width:20,height:10};
     const lateral=sweepMovement(beside,60,0,[surface]);
     assert.equal(lateral.x,surface.collision.left ? surface.left-beside.width : beside.x+60,`${surface.id} side`);
    }
   }
  });
});

describe("Asset uploads and revisions", () => {
  const {randomUUID}=require('node:crypto');
  const {clone,validateDocument}=require('../src/shared/maps/mapDocument');
  const defaults=require('../src/shared/maps').mapDefaults;
  const {replaceAssetReferences,exportDocument,resizeCollision,snapMove,allRows}=require('../src/client/editor/editorModel');
  const {geometryFromMap}=require('../src/shared/maps/mapDocument');
  const {MapRepository}=require('../src/server/services/maps/mapRepository');
  const files=require('../src/server/services/maps/mapAssetFiles');

  test('asset replacement follows matching URLs, preserves dimensions and leaves independent artwork alone',()=>{
   const doc=clone(defaults[0]),map=doc,key=map.layout.platforms[1].textureKey,original=map.assets[key];
   map.assets.alias=clone(original);map.textureSizes.alias=clone(map.textureSizes[key]);
   map.assets.independent={...clone(original),url:'/assets/independent.webp'};map.textureSizes.independent=clone(map.textureSizes[key]);
   const before=geometryFromMap(map).anchors.p1;
   replaceAssetReferences(doc,original,{url:'/assets/map-editor-staged/replacement.webp',targetUrl:original.url,width:1400,height:244});
   assert.equal(map.assets.alias.url,map.assets[key].url);
   assert.equal(map.assets.independent.url,'/assets/independent.webp');
   assert.deepEqual(geometryFromMap(map).anchors.p1,before);
   const exported=exportDocument(doc);assert.ok(exported.files.has(map.assets[key].replaceTarget));assert.ok(!JSON.stringify(exported.document).includes('map-editor-staged'));
   assert.equal(map.assets[key].url,'/assets/map-editor-staged/replacement.webp','export must not mutate the draft');
  });

  test('collision handles resize independently of artwork and Shift-style free resize can change the ratio',()=>{
   const map=clone(defaults[0]),row=allRows(map).find(r=>r.id==='p1'),before=clone(row.value),box=geometryFromMap(map).anchors.p1;
   const proportional=resizeCollision(map,row,'e',box.right+100,box.top);
   const free=resizeCollision(map,row,'e',box.right+100,box.top,false);
   assert.equal(free.body.height,before.body.height);assert.equal(free.body.width,before.body.width+100);
   assert.ok(proportional.body.height>before.body.height);
   for(const key of ['x','y','scaleX','scaleY'])assert.equal(free[key],before[key]);
  });

  test('a legacy powerup becomes a free point when moved and retains integer coordinates',()=>{
   const map=clone(defaults[0]),row=allRows(map).find(r=>r.kind==='powerup');
   Object.assign(row.value,snapMove(map,row,1111.4,-100.7,16,true).value);
   assert.equal(row.value.anchorId,undefined);assert.equal(row.value.x,1111);assert.equal(row.value.y,-101);
   assert.deepEqual(validateDocument(map),[]);
  });

  test('upload, backend save, immutable match assets, export after save and failed-save rollback',t=>{
   const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bb-map-assets-')),previous=process.env.BB_MAP_DIR;
   process.env.BB_MAP_DIR=dir;
   const target=`/assets/editor-qa-${randomUUID()}.webp`,root=path.resolve(__dirname,'..'),publicFile=path.join(root,'public',target),distFile=path.join(root,'dist',target);
   t.after(()=>{if(previous===undefined)delete process.env.BB_MAP_DIR;else process.env.BB_MAP_DIR=previous;for(const file of [publicFile,distFile])if(fs.existsSync(file))fs.unlinkSync(file);fs.rmSync(dir,{recursive:true,force:true});});
   const repo=new MapRepository(dir),initial=repo.get(1),doc=clone(initial.document),key=doc.layout.platforms[1].textureKey;
   const original=fs.readFileSync(files.resolveAssetFile(doc.assets[key].url));fs.writeFileSync(publicFile,original);
   doc.assets[key].url=target;
   const saved=repo.save(doc,initial.revision),live=repo.forMatch(8001,1);
   const edited=clone(saved.document),replacement=Buffer.concat([original,Buffer.from([0])]);
   const upload=files.stageUpload({targetUrl:target,fileName:'replacement.webp',base64:replacement.toString('base64')});
   replaceAssetReferences(edited,edited.assets[key],upload);edited.layout.platforms[1].x+=16;
   const result=repo.save(edited,saved.revision);
   assert.deepEqual(new MapRepository(dir).get(1),result);
   assert.deepEqual(fs.readFileSync(publicFile),replacement);
   assert.deepEqual(fs.readFileSync(files.resolveAssetFile(live.map.assets[key].url)),original);
   assert.equal(result.document.assets[key].sourceUrl,target);
   assert.equal(exportDocument(result.document).document.assets[key].url,target);
   assert.ok(exportDocument(result.document).files.has(target),'saved uploads still need portable export instructions');
   assert.throws(()=>repo.save(edited,saved.revision),e=>e.status===409);
   const failed=clone(result.document),nextUpload=files.stageUpload({targetUrl:target,fileName:'replacement.webp',base64:original.toString('base64')});
   replaceAssetReferences(failed,failed.assets[key],nextUpload);
   const badDirectory=path.join(dir,'not-a-directory');fs.writeFileSync(badDirectory,'blocked');const brokenRepo=new MapRepository(badDirectory);
   assert.throws(()=>brokenRepo.save(failed,brokenRepo.get(1).revision));
   assert.deepEqual(fs.readFileSync(publicFile),replacement,'failed map save restores public artwork');
   assert.deepEqual(fs.readFileSync(distFile),replacement,'failed map save restores served artwork');
   assert.throws(()=>files.stageUpload({targetUrl:target,fileName:'bad.png',base64:'aGVsbG8='}),e=>e.status===400);
   assert.throws(()=>files.stageUpload({targetUrl:'/assets/map-revisions/test.webp',fileName:'test.webp',base64:original.toString('base64')}),e=>e.status===400);
  });
});

describe("Isolated playtest lifecycle", () => {
  const {MapPlaytestService}=require('../src/server/services/maps/mapPlaytestService');
  const defaults=require('../src/shared/maps').mapDefaults;
  const {clone}=require('../src/shared/maps/mapDocument');
  const {mapArena}=require('../src/shared/maps/arenas');

  test('playtests use a chosen catalog skin without equipping the account and reject other characters skins', t => {
    t.mock.method(console, 'log', () => {});
    const service = new MapPlaytestService();
    service.namespace = { sockets: new Map(), to() { return { emit() {}, compress() { return this; } }; }, in() { return { disconnectSockets() {} }; } };
    t.after(() => { for (const token of service.sessions.keys()) service.remove(token); });
    const { getCharacterSkins, getDefaultSkinId } = require('../src/server/services/cosmetics/skinsCatalog');
    const skin = getCharacterSkins('ninja').find(s => s.id !== getDefaultSkinId('ninja'));
    const user = { user_id: 99, name: 'SkinTester', selected_skin_id_by_char: { ninja: getDefaultSkinId('ninja') } };
    const created = service.create(user, { document: defaults[0], character: 'ninja', skinId: skin.id });
    const { room, gameData } = service.get(created.session, user);
    const player = gameData.players.find(p => !p.isBot);
    assert.equal(player.selected_skin_id, skin.id);
    assert.equal(player.selected_skin_asset_url, skin.assetUrl);
    assert.equal(player.selected_skin_game_assets.spritesheetUrl, skin.gameAssets.spritesheetUrl);
    assert.equal(room.matchData.players[0].selected_skin_id, skin.id);
    assert.equal(user.selected_skin_id_by_char.ninja, getDefaultSkinId('ninja'));
    for (const skinId of ['missing-skin', getDefaultSkinId('thorg')]) {
      assert.throws(() => service.create(user, { document: defaults[0], character: 'ninja', skinId }), e => e.status === 400);
    }
  });
  test('every duel map playtests as either formation using the same geometry and camera',t=>{
   t.mock.method(console,'log',()=>{});
   const service=new MapPlaytestService();service.namespace={sockets:new Map(),to(){return{emit(){},compress(){return this;}};},in(){return{disconnectSockets(){}};}};
   t.after(()=>{for(const token of service.sessions.keys())service.remove(token);});
   const user={user_id:99,name:'MapTester',char_class:'ninja',char_levels:{ninja:1}};
   for(const document of defaults.filter(d=>mapArena(d).modeId==='duels')){
    for(const modeVariantId of ['duels-1v1','duels-2v2']){
     const created=service.create(user,{document,bots:true,modeVariantId});const {room,gameData}=service.get(created.session,user);
     const size=modeVariantId==='duels-1v1'?1:2;assert.equal(gameData.players.length,size*2);assert.equal(gameData.modeVariantId,modeVariantId);assert.equal(room.matchData.mode,size);assert.deepEqual(room.geometry.world,mapArena(document).world);assert.deepEqual(gameData.mapSnapshot.map.layout,document.layout);assert.deepEqual(mapArena(gameData.mapSnapshot.map).camera,mapArena(document).camera);
     service.remove(created.session);
    }
   }
   assert.throws(()=>service.create(user,{document:defaults[0],modeVariantId:'duels-3v3'}),e=>e.status===400);
  });
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
});

describe("Unsaved changes", () => {
  const {diffUnsaved,discardChanges}=require('../src/client/editor/unsavedChanges');
  const clone=v=>JSON.parse(JSON.stringify(v));
  const live={label:'Arena',layout:{platforms:[{id:'a',x:10},{id:'b',x:20}]},spawns:{team1:[{x:1,y:2}]},scenery:{scroll:0.1}};
  test('shows net differences across sections, no reverted edits',()=>{
   const draft=clone(live);draft.label='Other';draft.label=live.label;draft.layout.platforms[0].x=40;draft.scenery.scroll=0.2;
   const changes=diffUnsaved(live,draft);assert.equal(changes.length,2);assert.deepEqual(discardChanges(draft,changes),live);
   assert.equal(draft.layout.platforms[0].x,40);
  });
  test('selective discard restores removed object order and preserves unrelated changes',()=>{
   const draft=clone(live);draft.layout.platforms.shift();draft.label='Renamed';
   const changes=diffUnsaved(live,draft);const restored=discardChanges(draft,changes.filter(c=>c.path.at(-1)?.id==='a'));
   assert.deepEqual(restored.layout,live.layout);assert.equal(restored.label,'Renamed');
  });
  test('added objects and optional settings can be discarded',()=>{
   const draft=clone(live);draft.layout.platforms.push({id:'c',x:30});draft.setting=true;
   assert.deepEqual(discardChanges(draft,diffUnsaved(live,draft)),live);
  });
  test('array reordering stays explicit without swallowing other changes',()=>{
   const draft=clone(live);draft.label='Renamed';draft.layout.platforms.reverse();
   const changes=diffUnsaved(live,draft);assert.equal(changes.length,2);assert.deepEqual(discardChanges(draft,changes),live);
  });
  test('positional spawn lists restore as a unit without index shifts',()=>{
   const draft=clone(live);draft.spawns.team1.unshift({x:3,y:4});
   assert.deepEqual(discardChanges(draft,diffUnsaved(live,draft)),live);
  });
});

describe("Editor access link", () => {
  const exportsForTest={};
  loadClientModule(require.resolve('../src/client/lib/mapEditorLink.js'), {exports:exportsForTest});
  test('non-admin users have no editor element; admins get the chosen map and team variant',()=>{
   let created=0;const dom={createElement(){created++;return{setAttribute(k,v){this[k]=v;}};}};
   for(const user of [null,{}, {isAdmin:false},{isAdmin:'false'}])assert.equal(exportsForTest.createMapEditorLink({user,mapId:3,teamSize:2,document:dom}),null);
   assert.equal(created,0);
   const link=exportsForTest.createMapEditorLink({user:{isAdmin:true},mapId:3,mapLabel:'Serenity',teamSize:2,document:dom});
   assert.equal(link.href,'/map-editor?map=3&variant=2v2');assert.equal(link['aria-label'],'Edit Serenity');assert.equal(created,1);
  });
});

describe('Map Studio nested dropdowns', () => {
  test('maps are grouped by mode and only choosing a nested map changes the selection', () => {
    const { parseHTML } = require('linkedom');
    const { createClientModuleGraph } = require('./helpers/clientModule');
    const { document, window } = parseHTML('<html><body></body></html>');
    window.innerWidth = 1200;
    window.innerHeight = 800;
    window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 100, right: 300, top: 120, bottom: 160 });
    const graph = createClientModuleGraph({ globals: { document, window, MutationObserver: window.MutationObserver } });
    const { createMapModeSelect } = graph.load('src/client/editor/mapModeSelect.js');
    const options = require('../src/shared/maps').mapDefaults.map(map => ({ value: String(map.id), label: map.label, modeVariantId: map.modeVariantId }));
    const changes = [];
    const picker = createMapModeSelect({ options, value: options[0].value, onChange: mapId => changes.push(mapId), className: '' });
    document.body.append(picker.element);
    const trigger = picker.element.querySelector('button');
    trigger.dispatchEvent(Object.assign(new window.Event('click'), { detail: 0 }));
    const list = picker.element.querySelector('[role=listbox]');
    assert.deepEqual([...list.children].map(row => row.textContent), ['Duels', 'Bank Bust']);
    const bank = list.querySelector('[data-value="bank-bust"]');
    bank.click();
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(changes, []);
    const panel = picker.element.querySelector('.studio-nested-menu');
    const bankMaps = options.filter(map => map.modeVariantId === 'bank-bust-3v3');
    assert.deepEqual([...panel.querySelectorAll('[role=option]')].map(row => row.textContent), bankMaps.map(map => map.label));
    panel.querySelector('[role=option]').click();
    assert.equal(picker.value, bankMaps[0].value);
    assert.deepEqual(changes, [bankMaps[0].value]);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(picker.element.querySelector('.bb-pixel-select-value').textContent, bankMaps[0].label);
    picker.setValue(options[0].value);
    assert.equal(picker.value, options[0].value);
    assert.equal(list.querySelector('[aria-selected=true]').dataset.value, 'duels');
  });

  test('hovering each character lists all its skins and picking one updates the character and closes the menu', () => {
    const { parseHTML } = require('linkedom');
    const { createClientModuleGraph } = require('./helpers/clientModule');
    const catalog = require('../src/shared/catalogs/skinsCatalog.json');
    const { document, window } = parseHTML('<html><body></body></html>');
    window.innerWidth = 1200;
    window.innerHeight = 800;
    window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 500, right: 600, top: 120, bottom: 160 });
    const graph = createClientModuleGraph({ globals: { document, window, MutationObserver: window.MutationObserver } });
    const { createCharacterSkinSelect } = graph.load('src/client/editor/characterSkinSelect.js');
    const options = Object.keys(catalog.characters).map(value => ({ value, label: value }));
    const changes = [];
    const picker = createCharacterSkinSelect({ options, value: 'ninja', skinId: catalog.characters.ninja.defaultSkinId,
      onChange: (character, skin) => changes.push([character, skin]), className: '' });
    document.body.append(picker.element);
    const trigger = picker.element.querySelector('button');
    trigger.dispatchEvent(Object.assign(new window.Event('click'), { detail: 0 }));
    const panel = picker.element.querySelector('.studio-nested-menu');
    for (const row of picker.element.querySelector('[role=listbox]').children) {
      row.dispatchEvent(new window.Event('pointerenter'));
      assert.equal(panel.hidden, false);
      const skins = catalog.characters[row.dataset.value].skins;
      assert.deepEqual([...panel.querySelectorAll('[role=option]')].map(option => option.textContent), skins.map(skin => skin.name));
    }
    const row = picker.element.querySelector('[data-value=thorg]');
    row.dispatchEvent(new window.Event('pointerenter'));
    const skin = catalog.characters.thorg.skins.at(-1);
    panel.querySelector('[role=option]:last-child').click();
    assert.equal(picker.value, 'thorg');
    assert.deepEqual(changes, [['thorg', skin.id]]);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(picker.element.querySelector('[role=listbox]').hidden, true);
  });
});
