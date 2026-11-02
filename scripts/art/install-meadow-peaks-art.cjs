#!/usr/bin/env node
// Install the approved Lushy pixel set with grass surfaces aligned to the map.
// Retain a 4x nearest-neighbor runtime texture and unchanged world geometry.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const sharp=require('../../spritesheet-generator/node_modules/sharp');
const {replaceAssetReferences}=require('../../src/client/editor/editorModel');
const {geometryFromMap}=require('../../src/shared/maps/mapDocument');
const {mapRepository}=require('../../src/server/services/maps/mapRepository');
const root=path.resolve(__dirname,'../..');
const dir=path.join(root,'output/lushy-pixel-final');
const specs=[
  ['main','base.webp',1000,426,94,50],
  ['thin','largePlatform.webp',700,121,114,40],
  ['pillar','sidePlatform.webp',523,878,247,140],
  ['small','smallPlatform.webp',1000,426,142,30],
  ['small','lobbyPlatform.webp',638,300,142,32],
];
async function install([source,name,width,height,surface,targetSurface]){
  const {data,info}=await sharp(path.join(dir,`${source}-logical.png`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let x0=info.width,y0=info.height,x1=0,y1=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
  assert(surface>y0&&surface<y1,'Surface must lie inside sprite');
  const top=await sharp(data,{raw:info}).extract({left:x0,top:y0,width:x1-x0+1,height:surface-y0}).resize(width,targetSurface,{fit:'fill',kernel:'nearest'}).png().toBuffer();
  const bottom=await sharp(data,{raw:info}).extract({left:x0,top:surface,width:x1-x0+1,height:y1-surface+1}).resize(width,height-targetSurface,{fit:'fill',kernel:'nearest'}).png().toBuffer();
  const logical=await sharp({create:{width,height,channels:4,background:'#00000000'}}).composite([{input:top,left:0,top:0},{input:bottom,left:0,top:targetSurface}]).png().toBuffer();
  const dest=path.join(root,'public/assets/lushy',name);
  await sharp(logical).resize(width*4,height*4,{kernel:'nearest'}).webp({lossless:true}).toFile(dest);
  return {url:`/assets/lushy/${name}`,width:width*4,height:height*4};
}
(async()=>{
  // Snapshot both documents before touching files; preserve independent editor edits.
  const saved=mapRepository.get(1);
  const file=path.join(root,'src/shared/maps/1.json');
  const builtin=JSON.parse(fs.readFileSync(file));
  const docs=[builtin,saved.document],before=docs.map(d=>geometryFromMap(d,1));
  const uploads=[];
  for(const spec of specs)uploads.push(await install(spec));
  for(const doc of docs)for(const upload of uploads){
    const asset=Object.values(doc.assets).find(a=>a.url===upload.url);
    if(asset){
      replaceAssetReferences(doc,asset,{...upload,targetUrl:upload.url});
      // Direct file installation has no staged upload awaiting publication.
      delete asset.replaceTarget;
    }
  }
  for(let i=0;i<docs.length;i++)assert.deepEqual(geometryFromMap(docs[i],1),before[i],'Artwork replacement changed world geometry');
  mapRepository.save(saved.document,saved.revision);
  fs.writeFileSync(file,JSON.stringify(builtin,null,2)+'\n');
  console.log('Installed five 4x Lushy textures; built-in and saved map geometry unchanged.');
})().catch(e=>{console.error(e);if(e.errors)console.error(e.errors);process.exitCode=1;});
