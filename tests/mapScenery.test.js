const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {clone,validateMap}=require('../src/shared/maps/mapDocument');
const {coverScale,sceneryTransform,layerZoom}=require('../src/shared/maps/scenery');
const defaults=require('../src/shared/maps').mapDefaults;
const {MapRepository}=require('../src/server/services/maps/mapRepository');

const withScenery=()=>defaults.find(d=>d.variants['1v1'].scenery);

test('scenery is optional and validated with the map',()=>{
 const doc=withScenery();assert.ok(doc,'a built-in map demonstrates scenery');
 assert.deepEqual(validateMap(doc.variants['1v1']),[]);
 const plain=clone(doc.variants['1v1']);delete plain.scenery;assert.deepEqual(validateMap(plain),[]);
 const mutations=[
  s=>s.layers[0].url='/assets/../.env',
  s=>s.layers[0].url='https://example.com/a.webp',
  s=>s.layers[1].id=s.layers[0].id,
  s=>s.layers[0].scroll=-1,
  s=>s.layers[0].fit='stretch',
  s=>s.atmosphere.fogColor='pink',
  s=>s.atmosphere.rays[0].after='missing-layer',
  s=>s.atmosphere.rays[0].alpha=[0.5,0.1],
  s=>s.atmosphere.dust[0].count=100000,
  s=>s.atmosphere.platforms.strength=2,
  s=>s.clouds[0].url='/assets/../cloud.webp',
  s=>s.clouds[1].id=s.layers[0].id,
  s=>s.clouds[0].after='nowhere',
  s=>s.clouds[0].speed=9999,
  s=>s.layers[1].frame={width:0,height:10,x:0,y:0},
 ];
 for(const mutate of mutations){const map=clone(doc.variants['1v1']);mutate(map.scenery);assert.ok(validateMap(map).some(e=>e.includes('scenery')),mutate.toString());}
});

test('scenery can stack items over the arena and drift clouds',()=>{
 const map=clone(withScenery().variants['1v1']);
 assert.ok(map.scenery.clouds.length,'the demonstration map drifts clouds');
 map.scenery.atmosphere.mist[0].after='arena';map.scenery.clouds[0].after='arena';map.scenery.clouds[1].front=true;delete map.scenery.clouds[1].after;
 assert.deepEqual(validateMap(map),[]);
});

test('matches pin scenery layer art like platform art',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bb-maps-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const doc=withScenery();const snapshot=new MapRepository(dir).forMatch(7001,doc.id,'1v1');
 assert.ok(snapshot.map.scenery.layers.length);
 for(const layer of snapshot.map.scenery.layers)assert.match(layer.url,/^\/assets\/map-revisions\/[0-9a-f]{64}\.webp$/);
});

// Screen-space edges of a cover layer, given where Phaser's camera sits.
function screenEdges({image,scale,scroll,offset,center,view,zoom,referenceZoom,cameraCenter}){
 const origin={x:view.width/2,y:view.height/2};
 const t=sceneryTransform({scroll,offset,center,origin,zoom,referenceZoom});
 const scrollX=cameraCenter.x-origin.x,scrollY=cameraCenter.y-origin.y;
 const sx=origin.x+zoom*(t.x-scroll*scrollX-origin.x),sy=origin.y+zoom*(t.y-scroll*scrollY-origin.y);
 const halfW=image.width*scale*t.scale*zoom/2,halfH=image.height*scale*t.scale*zoom/2;
 return {left:sx-halfW,right:sx+halfW,top:sy-halfH,bottom:sy+halfH};
}

test('cover layers never expose an edge anywhere the match camera can go',()=>{
 const doc=withScenery(),map=doc.variants['1v1'];const b=map.bounds.camera;
 const bounds={width:b.width,height:b.height},center={x:b.x+b.width/2,y:b.y+b.height/2};
 const view={width:2300,height:1100},referenceZoom=b.zoom,image={width:1672,height:941};
 const minZoom=Math.max(view.width/bounds.width,view.height/bounds.height),maxZoom=2.2;
 for(const scroll of [0,0.15,0.5,1])for(const offset of [{x:0,y:0},{x:-120,y:80}]){
  const scale=coverScale({image,scroll,offset,view,bounds,referenceZoom,zoomRange:[minZoom,maxZoom]});
  for(const zoom of [minZoom,referenceZoom,maxZoom]){
   const halfW=view.width/zoom/2,halfH=view.height/zoom/2;
   for(const fx of [0,0.5,1])for(const fy of [0,0.5,1]){
    const cameraCenter={x:b.x+halfW+fx*Math.max(0,b.width-2*halfW),y:b.y+halfH+fy*Math.max(0,b.height-2*halfH)};
    const e=screenEdges({image,scale,scroll,offset,center,view,zoom,referenceZoom,cameraCenter});
    const eps=1e-6;
    assert.ok(e.left<=eps&&e.right>=view.width-eps&&e.top<=eps&&e.bottom>=view.height-eps,JSON.stringify({scroll,offset,zoom,fx,fy,e}));
   }
  }
 }
});

test('horizontal cover spans the screen width without forcing full height',()=>{
 const doc=withScenery(),b=doc.variants['1v1'].bounds.camera;
 const args={image:{width:1672,height:400},scroll:0.3,view:{width:2300,height:1100},bounds:{width:b.width,height:b.height},referenceZoom:b.zoom,zoomRange:[1.2,2.2]};
 const full=coverScale(args),strip=coverScale({...args,horizontalOnly:true});
 assert.ok(strip<full,'a short strip needs less scale to span the width than to fill the screen');
 const center={x:b.x+b.width/2,y:b.y+b.height/2};
 for(const zoom of [1.2,b.zoom,2.2])for(const fx of [0,1]){
  const halfW=args.view.width/zoom/2,cameraCenter={x:b.x+halfW+fx*Math.max(0,b.width-2*halfW),y:center.y};
  const e=screenEdges({image:args.image,scale:strip,scroll:args.scroll,offset:{x:0,y:0},center,view:args.view,zoom,referenceZoom:b.zoom,cameraCenter});
  assert.ok(e.left<=1e-6&&e.right>=args.view.width-1e-6,JSON.stringify({zoom,fx,e}));
 }
});

test('parallax: far layers drift less than the arena, foreground more',()=>{
 const center={x:1150,y:460},origin={x:1150,y:550},referenceZoom=1.7,zoom=1.7;
 const shift=scroll=>{
  const t=sceneryTransform({scroll,offset:{x:0,y:0},center,origin,zoom,referenceZoom});
  const screenAt=cameraX=>origin.x+zoom*(t.x-scroll*(cameraX-origin.x)-origin.x);
  return screenAt(center.x)-screenAt(center.x+300);
 };
 assert.equal(shift(0),0);
 assert.ok(shift(0.2)>0&&shift(0.2)<shift(1));
 assert.ok(shift(1.35)>shift(1));
 // At the reference zoom a layer at its offset lands where the arena would.
 const t=sceneryTransform({scroll:0.3,offset:{x:200,y:-100},center,origin,zoom,referenceZoom});
 assert.ok(Math.abs(origin.x+zoom*(t.x-0.3*(center.x-origin.x)-origin.x)-(origin.x+zoom*200))<1e-9);
 // Far layers respond less to camera zoom than the arena does.
 assert.ok(layerZoom(referenceZoom,2,0.2)<2&&layerZoom(referenceZoom,2,0.2)>referenceZoom);
});
