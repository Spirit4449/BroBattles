const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const babel=require('@babel/core');
const {clone,MapHistory}=require('../src/shared/mapDocument');
function load(file,dependencies){
 const exports={};const {code}=babel.transformSync(fs.readFileSync(require.resolve(file),'utf8'),{babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]});
 vm.runInNewContext(code,{exports,require:id=>dependencies[id]});return exports;
}
test('history reconciliation retains scene, camera and surviving objects through resize, deletion and undo',()=>{
 let created=0;const camera={zoom:1.75,scrollX:120,scrollY:99};const canvas={};
 const configure=(object,row)=>{Object.assign(object,{x:row.x,y:row.y,scaleX:row.scaleX,scaleY:row.scaleY,texture:{key:row.textureKey}});};
 const runtime=load('../src/maps/documentRuntime.js',{'./mapUtils':{
  appendLayoutObjectsFromConfig(scene,objects,layout){for(const row of layout.platforms){const object={_mapObjectId:row.id,type:'Sprite',anims:{stop(){}},destroy(){this.destroyed=true;}};configure(object,row);objects.push(object);created++;}},
  configureMapPlatform:configure,applyMapBounds(){},
 }});
 const scene={cameras:{main:camera},game:{canvas},physics:{world:{setBounds(){}}}};
 const original={layout:{platforms:[{id:'one',textureKey:'platform',x:100,y:100,scaleX:1,scaleY:1},{id:'two',textureKey:'platform',x:200,y:100,scaleX:1,scaleY:1}],hitboxes:[]},assets:{platform:{type:'image'}},bounds:{world:{x:0,y:0,width:1000,height:1000}},anchors:{}};
 const history=new MapHistory(original),first=runtime.syncMapDocument(scene,1,original),one=first.objects[0],two=first.objects[1];
 const resized=clone(original);resized.layout.platforms[0].scaleX=2;history.commit(resized);runtime.syncMapDocument(scene,1,resized);
 assert.equal(runtime.getDocumentRuntime(1).objects[0],one);assert.equal(one.scaleX,2);assert.equal(created,2);
 runtime.syncMapDocument(scene,1,history.undo());assert.equal(one.scaleX,1);assert.equal(created,2);
 runtime.syncMapDocument(scene,1,history.redo());assert.equal(one.scaleX,2);
 const removed=clone(resized);removed.layout.platforms.pop();history.commit(removed);runtime.syncMapDocument(scene,1,removed);assert.equal(two.destroyed,true);
 runtime.syncMapDocument(scene,1,history.undo());assert.equal(runtime.getDocumentRuntime(1).objects[0],one);assert.equal(created,3);
 assert.equal(scene.cameras.main,camera);assert.deepEqual(camera,{zoom:1.75,scrollX:120,scrollY:99});assert.equal(scene.game.canvas,canvas);
});
test('client collision configuration uses top-left offsets, including undoing custom offsets',()=>{
 const {configureMapPlatform}=load('../src/maps/mapUtils.js',{'../shared/spawnPlacement':require('../src/shared/spawnPlacement')});
 const sprite={displayWidth:200,displayHeight:100,scaleX:2,scaleY:2,
  body:{checkCollision:{},setSize(w,h){this.width=w;this.height=h;this.offset=[17,19];},setOffset(x,y){this.offset=[x,y];},updateFromGameObject(){}},
 };
 for(const method of ['setTexture','setPosition','setImmovable','setScale','setFlipX','setDepth','setAlpha','setFlipY'])sprite[method]=()=>sprite;
 const row={id:'one',textureKey:'art',x:50,y:100,scaleX:2,scaleY:2,body:{width:80,height:40,offsetX:12,offsetY:15}};
 configureMapPlatform(sprite,row);assert.deepEqual(sprite.body.offset,[12,15]);assert.equal(sprite.body.width,40);
 delete row.body.offsetX;delete row.body.offsetY;configureMapPlatform(sprite,row);assert.deepEqual(sprite.body.offset,[0,0]);
});
