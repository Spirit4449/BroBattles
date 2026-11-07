const { loadClientModule } = require('./helpers/clientModule');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const os = require('node:os');
const path = require('node:path');

describe("Document runtime", () => {
  const {clone,MapHistory}=require('../src/shared/maps/mapDocument');
  const { EventEmitter } = require('node:events');
  function load(file,dependencies){
   const exports={};
   loadClientModule(require.resolve(file), {exports,require:id=>dependencies[id]});return exports;
  }
  test('two scenes can own the same map and shutting down one cannot clear the other', () => {
   const api = load('../src/client/game/maps/documentRuntime.js', {'./mapUtils': {
    appendLayoutObjectsFromConfig() {}, applyMapBounds() {},
   }, '../../../shared/maps/arenas': require('../src/shared/maps/arenas')});
   const document = { modeVariantId: 'duels-1v1', layout: { platforms: [], hitboxes: [] }, assets: {}, anchors: {} };
   const first = { events: new EventEmitter() }, second = { events: new EventEmitter() };
   const a = api.buildMapDocument(first, 1, document);
   const b = api.buildMapDocument(second, 1, document);
   assert.equal(api.getDocumentRuntime(1, first), a);
   assert.equal(api.getDocumentRuntime(1, second), b);
   first.events.emit('shutdown');
   assert.equal(api.getDocumentRuntime(1, first), undefined);
   assert.equal(api.getDocumentRuntime(1), b);
   second.events.emit('shutdown');
   assert.equal(api.getDocumentRuntime(1), undefined);
   api.buildMapDocument(first, 1, document);
   first.events.emit('shutdown');
   assert.equal(api.getDocumentRuntime(1), undefined, 'a restarted scene registers cleanup again');
  });
  test('history reconciliation retains scene, camera and surviving objects through resize, deletion and undo',()=>{
   let created=0;const camera={zoom:1.75,scrollX:120,scrollY:99};const canvas={};
   const configure=(object,row)=>{Object.assign(object,{x:row.x,y:row.y,scaleX:row.scaleX,scaleY:row.scaleY,texture:{key:row.textureKey}});};
   const runtime=load('../src/client/game/maps/documentRuntime.js',{'./mapUtils':{
    appendLayoutObjectsFromConfig(scene,objects,layout){for(const row of layout.platforms){const object={_mapObjectId:row.id,type:'Sprite',anims:{stop(){}},destroy(){this.destroyed=true;}};configure(object,row);objects.push(object);created++;}},
    configureMapPlatform:configure,applyMapBounds(){},
   },'../../../shared/maps/arenas':require('../src/shared/maps/arenas')});
   const scene={cameras:{main:camera},game:{canvas},physics:{world:{setBounds(){}}}};
   const original={layout:{platforms:[{id:'one',textureKey:'platform',x:100,y:100,scaleX:1,scaleY:1},{id:'two',textureKey:'platform',x:200,y:100,scaleX:1,scaleY:1}],hitboxes:[]},assets:{platform:{type:'image'}},modeVariantId:'duels-1v1',anchors:{}};
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
   const {configureMapPlatform}=load('../src/client/game/maps/mapUtils.js',{'../../../shared/physics/spawnPlacement':require('../src/shared/physics/spawnPlacement')});
   const sprite={displayWidth:200,displayHeight:100,scaleX:2,scaleY:2,
    body:{checkCollision:{},friction:{set(){}},setSize(w,h){this.width=w;this.height=h;this.offset=[17,19];},setOffset(x,y){this.offset=[x,y];},updateFromGameObject(){}},
   };
   for(const method of ['setTexture','setPosition','setImmovable','setScale','setFlipX','setDepth','setAlpha','setFlipY'])sprite[method]=()=>sprite;
   const row={id:'one',textureKey:'art',x:50,y:100,scaleX:2,scaleY:2,body:{width:80,height:40,offsetX:12,offsetY:15}};
   configureMapPlatform(sprite,row);assert.deepEqual(sprite.body.offset,[12,15]);assert.equal(sprite.body.width,40);
   delete row.body.offsetX;delete row.body.offsetY;configureMapPlatform(sprite,row);assert.deepEqual(sprite.body.offset,[0,0]);
  });
});

describe("Scenery", () => {

  const defaults=require('../src/shared/maps').mapDefaults;
  const {MapRepository}=require('../src/server/services/maps/mapRepository');

  // The demonstration map: layered scenery with clouds and atmosphere.
  const withScenery=()=>defaults.find(d=>d.scenery.atmosphere&&d.scenery.clouds?.items.length);

  test('matches pin scenery layer art like platform art',t=>{
   const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bb-maps-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
   const doc=withScenery();const snapshot=new MapRepository(dir).forMatch(7001,doc.id);
   assert.ok(snapshot.map.scenery.layers.length);
   for(const layer of snapshot.map.scenery.layers)assert.match(layer.url,/^\/assets\/map-revisions\/[0-9a-f]{64}\.webp$/);
  });

  // Screen-space edges of a cover layer, given where Phaser's camera sits.

  test('animated layer parts validate and load each sheet once',()=>{
   const {sceneryParts,validateScenery}=require('../src/shared/maps/scenery');
   const part={url:'/assets/x.webp',x:1,y:2,frameWidth:8,frameHeight:8,frameRate:4,frames:[0,1,1]};
   const scenery={layers:[{id:'a',url:'/assets/a.webp',scroll:0.5,parts:[part]},{id:'b',url:'/assets/a.webp',scroll:0.5,parts:[part]}]};
   const errors=[];
   validateScenery(scenery,(path,message)=>errors.push(`${path}: ${message}`),(v,path)=>{if(typeof v!=='number')errors.push(path);},()=>{});
   assert.deepEqual(errors,[]);
   assert.equal(sceneryParts(scenery).length,1);
  });
});

describe("Spawn support and clearance", () => {
  const { getDuelGeometry, spawnForParticipant, characterBody } = require('../src/shared/physics/duelGeometry');
  const { resolveLanding } = require('../src/shared/physics/spawnPlacement');
  const frames = require("../src/shared/characters/index.js").characterFrames;

  test('every map, character, facing, team and slot has solid support and clearance', () => {
    for (let map = 1; map <= 4; map++) for (const char of Object.keys(frames)) {
      for (const flip of [false, true]) for (const team of ['team1', 'team2']) {
        for (let size = 1; size <= 3; size++) for (let i = 0; i < size; i++) {
          const g = getDuelGeometry(map);
          const b = characterBody(char, flip);
          const p = spawnForParticipant(g, { char_class: char, flip, team }, i, size);
          const cx = p.x + b.offsetX, bottom = p.y + b.offsetY + b.halfHeight;
          const label = `${map}/${char}/${flip}/${team}/${size}/${i}`;
          assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), label);
          assert.ok(g.colliders.some(c => c.collision.up && Math.abs(c.top - bottom - 2) < 0.001 && cx - b.halfWidth >= c.left && cx + b.halfWidth <= c.right), label);
          assert.ok(!g.colliders.some(c => cx + b.halfWidth > c.left && cx - b.halfWidth < c.right && bottom > c.top && bottom - b.height < c.bottom), label + ' intersects geometry');
        }
      }
    }
  });

  test('disabled decorative anchors and embedded coordinates resolve to a clear surface', () => {
    const surface = { left: 100, right: 250, top: 200, bottom: 400, collision: { up: true } };
    const decoration = { left: 0, right: 400, top: 0, bottom: 500, enabled: false };
    const p = resolveLanding({ x: 249, y: 260 }, decoration, [decoration, surface], { width: 40, height: 60 });
    assert.equal(p.surface, surface);
    assert.equal(p.x, 228);
    assert.equal(p.y, 198);
  });

  test('invalid maps fail explicitly instead of spawning in the void', () => {
    assert.throws(() => resolveLanding({}, null, [], { width: 40, height: 60 }), /walkable/);
  });
});
