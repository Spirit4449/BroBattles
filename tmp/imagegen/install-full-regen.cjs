const sharp=require('/Users/nisch/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');const fs=require('fs');
(async()=>{
const src='/Users/nisch/.codex/generated_images/01a0890d-7308-71f2-b492-0ca554683bad/exec-8dc11c86-635a-4bc6-85c9-fde35ea66d69.png';
const {data,info}=await sharp(src).ensureAlpha().raw().toBuffer({resolveWithObject:true});
for(let p=0;p<data.length;p+=4)if(data[p]>data[p+1]*1.3&&data[p+2]>data[p+1]*1.3)data[p+3]=0;
const base=await sharp('tmp/imagegen/thorg-before-full-regen.webp').ensureAlpha().raw().toBuffer({resolveWithObject:true});const frames=require('../../public/assets/thorg/animations.json').frames.filter(f=>f.filename.startsWith('throw'));let previews=[];
const idle=await sharp('tmp/imagegen/thorg-before-full-regen.webp').extract({left:0,top:0,width:128,height:128}).png().toBuffer();previews.push({input:idle,left:0,top:0});
for(let i=0;i<5;i++){
const n=[0,1,3,4,5][i];const l=[0,550,1030][n%3],r=[550,1030,1536][n%3],t=n<3?0:512,b=n<3?512:1024;
let minX=r,maxX=l,minY=b,maxY=t,hmin=r,hmax=l;
for(let y=t;y<b;y++)for(let x=l;x<r;x++)if(data[(y*info.width+x)*4+3]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
for(let y=minY;y<minY+110;y++)for(let x=l;x<r;x++)if(data[(y*info.width+x)*4+3]){hmin=Math.min(hmin,x);hmax=Math.max(hmax,x);}
const scale=106/(maxY-minY+1),width=Math.round((maxX-minX+1)*scale),left=Math.round(64-((hmin+hmax)/2-minX)*scale);
const sprite=await sharp(data,{raw:info}).extract({left:minX,top:minY,width:maxX-minX+1,height:maxY-minY+1}).resize(width,106,{kernel:'nearest'}).png().toBuffer();
const cell=await sharp({create:{width:128,height:128,channels:4,background:'#00000000'}}).composite([{input:sprite,left,top:12}]).raw().toBuffer();
const f=frames[i].frame;for(let y=0;y<128;y++)cell.copy(base.data,((f.y+y)*base.info.width+f.x)*4,y*128*4,(y+1)*128*4);
previews.push({input:await sharp(cell,{raw:{width:128,height:128,channels:4}}).png().toBuffer(),left:(i+1)*128,top:0});
}
await sharp(base.data,{raw:base.info}).webp({lossless:true}).toFile('public/assets/thorg/spritesheet.webp');
const strip=await sharp({create:{width:768,height:128,channels:4,background:'#273344'}}).composite(previews).png().toBuffer();await sharp(strip).resize(2304,384,{kernel:'nearest'}).toFile('tmp/imagegen/thorg-full-regen-comparison.png');
})();
