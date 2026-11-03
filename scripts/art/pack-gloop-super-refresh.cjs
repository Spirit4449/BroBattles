// Pack the subtle body-style refresh onto the existing 4x2 hook-hand layout.
const fs=require('node:fs');
const path=require('node:path');
const sharp=require('../../spritesheet-generator/node_modules/sharp');
const root=path.resolve(__dirname,'../..'),work=path.join(root,'output/gloop-super-refresh'),dest=path.join(root,'public/assets/gloop');
(async()=>{
 const {data,info}=await sharp(path.join(work,'generated.png')).resize(128,64,{fit:'fill',kernel:'nearest'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const palette=['000000','103bb6','1553cc','219ca9','2cc4bf','67dcca','a9efd5','d0fae8'].map(h=>[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)));
 for(let i=0;i<data.length;i+=4){if(data[i+3]<180){data.fill(0,i,i+4);continue;}let best=palette[0],distance=Infinity;for(const color of palette){const d=color.reduce((s,c,k)=>s+(c-data[i+k])**2,0);if(d<distance){distance=d;best=color;}}for(let k=0;k<3;k++)data[i+k]=best[k];data[i+3]=255;}
 const packed=await sharp(data,{raw:info}).resize(512,256,{kernel:'nearest'}).png().toBuffer();
 await sharp(packed).webp({lossless:true}).toFile(path.join(dest,'hand-grip.webp'));
 // Matching static fallback hands retain their existing canvas dimensions.
 for(const [name,x,y,width,height] of [['openHand.webp',0,0,318,322],['closedHand.webp',384,128,387,298]])await sharp(packed).extract({left:x,top:y,width:128,height:128}).resize(width,height,{fit:'fill',kernel:'nearest'}).webp({lossless:true}).toFile(path.join(dest,name));
 await sharp(packed).flatten({background:'#686c78'}).png().toFile(path.join(work,'preview.png'));
 console.log('Packed eight transparent grip poses and matching static fallbacks.');
})().catch(e=>{console.error(e);process.exitCode=1;});
