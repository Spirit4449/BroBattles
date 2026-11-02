#!/usr/bin/env node
// User-requested workflow: detailed generated art -> 1024x512 logical pixels
// -> exact 4x nearest-neighbor 4096x2048 master. Does not install game assets.
const path=require('node:path');
const sharp=require('../../spritesheet-generator/node_modules/sharp');
const dir=path.resolve(__dirname,'../../output/meadow-peaks-art/high-resolution-candidate');
(async()=>{
  const {data,info}=await sharp(path.join(dir,'lushy-pixel-generated.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let a=3;a<data.length;a+=4)data[a]=data[a]>200?255:0;
  const logical=await sharp(data,{raw:info}).resize(1024,512,{fit:'fill',kernel:'nearest'}).png().toBuffer();
  await sharp(logical).toFile(path.join(dir,'lushy-pixel-1024.png'));
  await sharp(logical).resize(4096,2048,{fit:'fill',kernel:'nearest'}).png().toFile(path.join(dir,'lushy-pixel-4k.png'));
  const {data:big,info:bi}=await sharp(path.join(dir,'lushy-pixel-4k.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {data:small}=await sharp(logical).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let y=0;y<bi.height;y++)for(let x=0;x<bi.width;x++)for(let c=0;c<4;c++){
    if(big[(y*bi.width+x)*4+c]!==small[(Math.floor(y/4)*1024+Math.floor(x/4))*4+c])throw Error('Nearest-neighbor block mismatch');
  }
  console.log('Verified 4096x2048 RGBA; every logical pixel is an identical 4x4 block.');
})().catch(e=>{console.error(e);process.exitCode=1;});
