import { appendLayoutObjectsFromConfig, configureMapPlatform, applyMapBounds, getSpawnPointForTeam, placeSpriteAtConfiguredSpawn } from './mapUtils';
const runtimes = new Map();
const boundScenes = new WeakSet();

export function disposeMapDocument(scene) {
  const runtime = scene?._mapRuntime;
  if (!runtime) return;
  if (runtimes.get(runtime.mapId) === runtime) runtimes.delete(runtime.mapId);
  scene._mapRuntime = null;
  scene._mapObjects = [];
  scene._mapDocument = null;
}
export function preloadMapDocument(scene, data) {
  scene._mapAssetKeys = new Set(Object.keys(data?.assets || {}));
  for (const [key, asset] of Object.entries(data?.assets || {})) {
    if (scene.textures.exists(key)) continue;
    if (asset.type === 'atlas') scene.load.atlas(key, asset.url, asset.atlasURL);
    else if (asset.type === 'spritesheet') scene.load.spritesheet(key, asset.url, asset.frameConfig);
    else scene.load.image(key, asset.url);
  }
}
export function buildMapDocument(scene, mapId, data) {
  const objects = [];
  appendLayoutObjectsFromConfig(scene, objects, data.layout);
  const anchors = Object.fromEntries(objects.map(o=>[o._mapObjectId,o]));
  for (const [key, ref] of Object.entries(data.anchors || {})) anchors[key] = anchors[ref.objectId];
  scene._mapObjects = objects;
  scene._mapDocument = data;
  applyMapBounds(scene, data.bounds);
  playMapAnimations(scene,objects,data);
  const previous = scene._mapRuntime;
  if (previous && runtimes.get(previous.mapId) === previous) runtimes.delete(previous.mapId);
  const runtime = {data,objects,anchors,scene,mapId:Number(mapId)};
  scene._mapRuntime = runtime;
  runtimes.set(Number(mapId),runtime);
  if (!boundScenes.has(scene) && scene.events?.once) {
    boundScenes.add(scene);
    scene.events.once('shutdown', () => {
      disposeMapDocument(scene);
      boundScenes.delete(scene);
    });
  }
  return runtime;
}
export function getDocumentRuntime(mapId, scene = null) {
  if (scene) return scene._mapRuntime?.mapId === Number(mapId) ? scene._mapRuntime : undefined;
  return runtimes.get(Number(mapId)); // Compatibility for non-scene presentation queries.
}
export function spawnOnMapDocument(scene,sprite,runtime,team,index,size) {
  const point = getSpawnPointForTeam(runtime.data.spawns,team,index,scene._mapVariantTeamSize || size);
  placeSpriteAtConfiguredSpawn(scene,sprite,point,runtime.anchors);
}

// Reconcile by stable ID. History and inspector edits keep the Phaser scene,
// canvas, camera and unchanged objects alive.
export function syncMapDocument(scene,mapId,data) {
  const runtime=getDocumentRuntime(mapId,scene);
  if(!runtime || runtime.scene !== scene) return buildMapDocument(scene,mapId,data);
  const rows=[...data.layout.platforms.map(row=>({row,kind:'platform'})),...data.layout.hitboxes.map(row=>({row,kind:'hitbox'}))];
  const previous=new Map(runtime.objects.map(object=>[object._mapObjectId,object]));
  const objects=[];
  for(const {row,kind} of rows){
    let object=previous.get(row.id);
    if(object && (object.type==='Zone') !== (kind==='hitbox')){object.destroy();object=null;}
    if(!object){
      const added=[];appendLayoutObjectsFromConfig(scene,added,{platforms:kind==='platform'?[row]:[],hitboxes:kind==='hitbox'?[row]:[]});object=added[0];
    }else if(object._mapRowJSON!==JSON.stringify(row)){
      if(kind==='platform')configureMapPlatform(object,row);
      else {
        object.setPosition(row.x,row.y).setSize(row.width,row.height);
        object.body.setSize(row.width,row.height);
        object.body.enable=row.collisionEnabled!==false;
        for(const side of ['up','down','left','right'])object.body.checkCollision[side]=row.collision?.[side]!==false;
        object.body.updateFromGameObject();
      }
    }
    previous.delete(row.id);
    if(object){object._mapRowJSON=JSON.stringify(row);objects.push(object);}
  }
  for(const object of previous.values())object.destroy();
  const anchors=Object.fromEntries(objects.map(object=>[object._mapObjectId,object]));
  for(const[key,ref]of Object.entries(data.anchors||{}))anchors[key]=anchors[ref.objectId];
  playMapAnimations(scene,objects,data);
  Object.assign(runtime,{data,objects,anchors});scene._mapObjects=objects;scene._mapDocument=data;
  scene.physics.world.setBounds(data.bounds.world.x,data.bounds.world.y,data.bounds.world.width,data.bounds.world.height);
  return runtime;
}

function playMapAnimations(scene,objects,data){
  for (const object of objects) {
    const asset = data.assets?.[object.texture?.key];
    if (!asset?.animation) { object.anims?.stop(); continue; }
    const key = `map-animation-${object.texture.key}`;
    if (!scene.anims.exists(key)) scene.anims.create({key, frames:asset.animation.frames.map(frame=>({key:object.texture.key,frame})), frameRate:asset.animation.frameRate, repeat:asset.animation.repeat});
    if(object.anims?.currentAnim?.key!==key)object.play(key);
  }
}
