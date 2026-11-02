#!/usr/bin/env node
// Pixel-art sources -> substantial logical canvases -> integer 4x NN masters.
// Exports candidates only; never overwrites installed game assets.
const path=require('node:path');
const fs=require('node:fs');
const sharp=require('../../spritesheet-generator/node_modules/sharp');
const dir=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'../../output/lushy-pixel-final');
(async()=>{
  const pieces=[['thin',1024,256],['pillar',512,1024],['small',1024,512]];
  if(fs.existsSync(path.join(dir,'main-source.png')))pieces.unshift(['main',1024,512]);
  for(const[name,w,h]of pieces){
    const {data,info}=await sharp(path.join(dir,`${name}-source.png`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let a=3;a<data.length;a+=4)data[a]=data[a]>200?255:0;
    const logical=await sharp(data,{raw:info}).resize(w,h,{fit:'contain',background:'#00000000',kernel:'nearest'}).png().toBuffer();
    await sharp(logical).toFile(path.join(dir,`${name}-logical.png`));
    await sharp(logical).resize(w*4,h*4,{fit:'fill',kernel:'nearest'}).png().toFile(path.join(dir,`${name}-4k.png`));
    const {data:big,info:bi}=await sharp(path.join(dir,`${name}-4k.png`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const {data:small}=await sharp(logical).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let y=0;y<bi.height;y++)for(let x=0;x<bi.width;x++)for(let c=0;c<4;c++)if(big[(y*bi.width+x)*4+c]!==small[(Math.floor(y/4)*w+Math.floor(x/4))*4+c])throw Error(name+' nearest-neighbor block mismatch');
    console.log(`${name}: verified ${bi.width}x${bi.height}, exact 4x nearest neighbor RGBA`);
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
