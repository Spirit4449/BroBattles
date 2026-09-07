const { clone, geometryFromMap, constrainPoint } = require('../shared/mapDocument');
function allRows(map) {
  const rows = [...map.layout.platforms.map(value=>({kind:'platform',value})), ...map.layout.hitboxes.map(value=>({kind:'hitbox',value}))];
  for (const team of ['team1','team2']) for (const [size,points] of Object.entries(map.spawns.players[team])) points.forEach((value,index)=>rows.push({kind:'spawn',id:`spawn-${team}-${size}-${index}`,team,size,index,value}));
  rows.push(...map.spawns.powerups.map(value=>({kind:'powerup',value})));
  const bank = map.objectiveLayout?.bankBust;
  if(bank) {
    for(const [team,value] of Object.entries(bank.vaults)) rows.push({kind:'vault',id:`vault-${team}`,value});
    for(const [team,value] of Object.entries(bank.respawnPoints)) rows.push({kind:'respawn',id:`respawn-${team}`,value});
    rows.push(...bank.objects.map(value=>({kind:'objective',value})),...bank.randomGoldSpawnPoints.map(value=>({kind:'gold',value})));
  }
  return rows.map(row=>({...row,id:row.id || row.value.id}));
}
function snapMove(map, row, x, y, grid = 16, bypass = false, tolerance = 8) {
  let guides = [];
  if (!bypass) {
    if (grid) {x = Math.round(x/grid)*grid; y = Math.round(y/grid)*grid;}
    if (row.kind === 'platform' || row.kind === 'hitbox') {
      const g = geometryFromMap(map);
      const own = g.anchors[row.id];
      for (const axis of ['x','y']) {
        const start = axis === 'x' ? row.value.x : row.value.y;
        const offset = (axis === 'x' ? x : y) - start;
        const edges = axis === 'x' ? [own.left, (own.left+own.right)/2, own.right] : [own.top,(own.top+own.bottom)/2,own.bottom];
        const targets = g.colliders.filter(p=>p.id!==row.id).flatMap(p=>axis === 'x' ? [p.left,(p.left+p.right)/2,p.right] : [p.top,(p.top+p.bottom)/2,p.bottom]);
        const w = g.world;
        targets.push(...(axis === 'x' ? [w.x,w.x+w.width/2,w.x+w.width] : [w.y,w.y+w.height/2,w.y+w.height]));
        let delta = tolerance, target = null;
        for (const edge of edges) for (const t of targets) if(Math.abs(t-edge-offset)<Math.abs(delta)) { delta=t-edge-offset; target=t; }
        if(target !== null) { if(axis==='x') x+=delta; else y+=delta; guides.push({axis,value:target}); }
      }
    }
  }
  x=Math.round(x);y=Math.round(y);
  if (row.kind === 'powerup') return {value:{...row.value,x,y,anchorId:undefined,dx:undefined},guides};
  if (row.kind === 'spawn') return {value:constrainPoint(map,row.value,x,y,row.kind==='powerup'?{width:32,height:40}:undefined),guides};
  return {value:{...row.value,x,y},guides};
}
function resizeRow(row, handle, x, y, textureSize, uniform = true) {
  const p=clone(row); const width=textureSize ? textureSize.width*p.scaleX : p.width, height=textureSize ? textureSize.height*p.scaleY : p.height;
  const left=p.x-width/2,right=p.x+width/2,top=p.y-height/2,bottom=p.y+height/2;
  let w=width,h=height;
  if(handle.includes('e')) w=Math.max(8,x-left);
  if(handle.includes('w')) w=Math.max(8,right-x);
  if(handle.includes('s')) h=Math.max(8,y-top);
  if(handle.includes('n')) h=Math.max(8,bottom-y);
  if(uniform) {const ratio=handle==='n'||handle==='s'?h/height:w/width;w=width*ratio;h=height*ratio;}
  w=Math.round(w);h=Math.round(h);
  p.x=handle.includes('w')?right-w/2:handle.includes('e')?left+w/2:p.x;
  p.y=handle.includes('n')?bottom-h/2:handle.includes('s')?top+h/2:p.y;
  if(textureSize){p.scaleX=w/textureSize.width;p.scaleY=h/textureSize.height;if(p.body){if(p.body.width)p.body.width*=w/width;if(p.body.height)p.body.height*=h/height;}}
  else {p.width=w;p.height=h;}
  p.x=Math.round(p.x);p.y=Math.round(p.y);
  if(p.body)for(const key of Object.keys(p.body))p.body[key]=Math.round(p.body[key]);
  return p;
}
function removeRows(map, ids) {
  const protectedIds = new Set(allRows(map).filter(r=>r.kind==='spawn'||(r.kind==='powerup'&&r.value.anchorId)).map(r=>r.value.anchorId));
  for(const id of ids) if(protectedIds.has(id)) throw Error(`${id} supports a spawn. Move or remove its spawn markers before deleting it.`);
  for(const kind of ['platforms','hitboxes']) map.layout[kind] = map.layout[kind].filter(p=>!ids.includes(p.id));
  map.spawns.powerups=map.spawns.powerups.filter(p=>!ids.includes(p.id));
  const b=map.objectiveLayout?.bankBust;
  if(b) for(const kind of ['objects','randomGoldSpawnPoints']) b[kind]=b[kind].filter(p=>!ids.includes(p.id));
  for(const [key,ref] of Object.entries(map.anchors)) if(ids.includes(ref.objectId)) delete map.anchors[key];
}
function resizeCollision(map,row,handle,x,y,uniform=true){
  const g=geometryFromMap(map).anchors[row.id],p=clone(row.value);
  const box=resizeRow({x:(g.left+g.right)/2,y:(g.top+g.bottom)/2,width:g.right-g.left,height:g.bottom-g.top},handle,x,y,null,uniform);
  const size=map.textureSizes[p.textureKey];
  p.body={width:box.width,height:box.height,
    offsetX:Math.round((box.x-box.width/2-(p.x-size.width*p.scaleX/2))/p.scaleX),
    offsetY:Math.round((box.y-box.height/2-(p.y-size.height*p.scaleY/2))/p.scaleY)};
  return p;
}
module.exports={allRows,snapMove,resizeRow,resizeCollision,removeRows};

// Keep replacement/export rules independent of the UI so AI tools and tests can
// apply the same operations to complete documents.
function replaceAssetReferences(document, original, upload) {
  const originalUrl=original.url;
  const source=original.sourceUrl||original.replaceTarget||originalUrl;
  for(const data of Object.values(document.variants))for(const [key,asset]of Object.entries(data.assets)){
    if(asset.url!==originalUrl&&(asset.sourceUrl||asset.replaceTarget||asset.url)!==source)continue;
    const old=data.textureSizes[key];
    if(asset.type==='image'){
      for(const p of data.layout.platforms.filter(p=>p.textureKey===key)){
        p.scaleX*=old.width/upload.width;p.scaleY*=old.height/upload.height;
        if(p.body){p.body.offsetX=(p.body.offsetX||0)*upload.width/old.width;p.body.offsetY=(p.body.offsetY||0)*upload.height/old.height;}
      }
      data.textureSizes[key]={width:upload.width,height:upload.height};
    }
    asset.url=upload.url;asset.replaceTarget=upload.targetUrl;delete asset.sourceUrl;
  }
}
function exportDocument(document) {
  const exported=clone(document),files=new Set();
  for(const data of Object.values(exported.variants))for(const asset of Object.values(data.assets)){
    const target=asset.replaceTarget||asset.sourceUrl;
    if(target){files.add(target);asset.url=target;delete asset.replaceTarget;delete asset.sourceUrl;}
  }
  return {document:exported,files};
}
module.exports.replaceAssetReferences=replaceAssetReferences;
module.exports.exportDocument=exportDocument;
