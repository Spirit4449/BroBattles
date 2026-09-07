const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {clone,validateDocument}=require('../src/shared/mapDocument');
const defaults=require('../src/shared/mapDefaults');
const {replaceAssetReferences,exportDocument,resizeCollision,snapMove,allRows}=require('../src/editor/editorModel');
const {geometryFromMap}=require('../src/shared/mapDocument');
const {MapRepository}=require('../src/server/services/mapRepository');
const files=require('../src/server/services/mapAssetFiles');

test('asset replacement follows matching URLs across variants, preserves dimensions and leaves independent artwork alone',()=>{
 const doc=clone(defaults[0]),map=doc.variants['1v1'],key=map.layout.platforms[1].textureKey,original=map.assets[key];
 map.assets.alias=clone(original);map.textureSizes.alias=clone(map.textureSizes[key]);
 doc.variants['3v3'].assets[key].url='/assets/independent.webp';
 const before=geometryFromMap(map).anchors.p1;
 replaceAssetReferences(doc,original,{url:'/assets/map-editor-staged/replacement.webp',targetUrl:original.url,width:1400,height:244});
 assert.equal(map.assets.alias.url,map.assets[key].url);
 assert.equal(doc.variants['2v2'].assets[key].url,map.assets[key].url);
 assert.equal(doc.variants['3v3'].assets[key].url,'/assets/independent.webp');
 assert.deepEqual(geometryFromMap(map).anchors.p1,before);
 const exported=exportDocument(doc);assert.ok(exported.files.has(map.assets[key].replaceTarget));assert.ok(!JSON.stringify(exported.document).includes('map-editor-staged'));
 assert.equal(map.assets[key].url,'/assets/map-editor-staged/replacement.webp','export must not mutate the draft');
});

test('collision handles resize independently of artwork and Shift-style free resize can change the ratio',()=>{
 const map=clone(defaults[0].variants['1v1']),row=allRows(map).find(r=>r.id==='p1'),before=clone(row.value),box=geometryFromMap(map).anchors.p1;
 const proportional=resizeCollision(map,row,'e',box.right+100,box.top);
 const free=resizeCollision(map,row,'e',box.right+100,box.top,false);
 assert.equal(free.body.height,before.body.height);assert.equal(free.body.width,before.body.width+100);
 assert.ok(proportional.body.height>before.body.height);
 for(const key of ['x','y','scaleX','scaleY'])assert.equal(free[key],before[key]);
});

test('a legacy powerup becomes a free point when moved and retains integer coordinates',()=>{
 const map=clone(defaults[0].variants['1v1']),row=allRows(map).find(r=>r.kind==='powerup');
 Object.assign(row.value,snapMove(map,row,1111.4,-100.7,16,true).value);
 assert.equal(row.value.anchorId,undefined);assert.equal(row.value.x,1111);assert.equal(row.value.y,-101);
 const doc=clone(defaults[0]);doc.variants['1v1']=map;assert.deepEqual(validateDocument(doc),[]);
});

test('upload, backend save, immutable match assets, export after save and failed-save rollback',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bb-map-assets-')),previous=process.env.BB_MAP_DIR;
 process.env.BB_MAP_DIR=dir;
 const target=`/assets/editor-qa-${randomUUID()}.webp`,root=path.resolve(__dirname,'..'),publicFile=path.join(root,'public',target),distFile=path.join(root,'dist',target);
 t.after(()=>{if(previous===undefined)delete process.env.BB_MAP_DIR;else process.env.BB_MAP_DIR=previous;for(const file of [publicFile,distFile])if(fs.existsSync(file))fs.unlinkSync(file);fs.rmSync(dir,{recursive:true,force:true});});
 const repo=new MapRepository(dir),initial=repo.get(1),doc=clone(initial.document),key=doc.variants['1v1'].layout.platforms[1].textureKey;
 const original=fs.readFileSync(files.resolveAssetFile(doc.variants['1v1'].assets[key].url));fs.writeFileSync(publicFile,original);
 for(const map of Object.values(doc.variants))map.assets[key].url=target;
 const saved=repo.save(doc,initial.revision),live=repo.forMatch(8001,1,'1v1');
 const edited=clone(saved.document),replacement=Buffer.concat([original,Buffer.from([0])]);
 const upload=files.stageUpload({targetUrl:target,fileName:'replacement.webp',base64:replacement.toString('base64')});
 replaceAssetReferences(edited,edited.variants['1v1'].assets[key],upload);edited.variants['1v1'].layout.platforms[1].x+=16;
 const result=repo.save(edited,saved.revision);
 assert.deepEqual(new MapRepository(dir).get(1),result);
 assert.deepEqual(fs.readFileSync(publicFile),replacement);
 assert.deepEqual(fs.readFileSync(files.resolveAssetFile(live.map.assets[key].url)),original);
 assert.equal(result.document.variants['1v1'].assets[key].sourceUrl,target);
 assert.equal(exportDocument(result.document).document.variants['1v1'].assets[key].url,target);
 assert.ok(exportDocument(result.document).files.has(target),'saved uploads still need portable export instructions');
 assert.throws(()=>repo.save(edited,saved.revision),e=>e.status===409);
 const failed=clone(result.document),nextUpload=files.stageUpload({targetUrl:target,fileName:'replacement.webp',base64:original.toString('base64')});
 replaceAssetReferences(failed,failed.variants['1v1'].assets[key],nextUpload);
 const badDirectory=path.join(dir,'not-a-directory');fs.writeFileSync(badDirectory,'blocked');const brokenRepo=new MapRepository(badDirectory);
 assert.throws(()=>brokenRepo.save(failed,brokenRepo.get(1).revision));
 assert.deepEqual(fs.readFileSync(publicFile),replacement,'failed map save restores public artwork');
 assert.deepEqual(fs.readFileSync(distFile),replacement,'failed map save restores served artwork');
 assert.throws(()=>files.stageUpload({targetUrl:target,fileName:'bad.png',base64:'aGVsbG8='}),e=>e.status===400);
 assert.throws(()=>files.stageUpload({targetUrl:'/assets/map-revisions/test.webp',fileName:'test.webp',base64:original.toString('base64')}),e=>e.status===400);
});
