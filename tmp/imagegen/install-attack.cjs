const sharp=require('/Users/nisch/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const fs=require('fs');
(async()=>{
const src='/Users/nisch/.codex/generated_images/01a0890d-7308-71f2-b492-0ca554683bad/exec-172c1950-f0c5-4316-932e-6d531202cf5d.png';
const {data,info}=await sharp(src).ensureAlpha().raw().toBuffer({resolveWithObject:true});
for(let p=0;p<data.length;p+=4){if(data[p+2]>data[p]*1.08 && data[p+2]>data[p+1])data[p+3]=0;}
let frames=JSON.parse(fs.readFileSync('public/assets/thorg/animations.json')).frames.filter(f=>f.filename.startsWith('throw'));
let layers=[], previews=[];
for(let i=0;i<5;i++){
const bounds=[0,490,880,1300,1750,info.width];const left=bounds[i],right=bounds[i+1];let minX=right,maxX=left,minY=info.height,maxY=0,hmin=right,hmax=left;
for(let y=0;y<info.height;y++)for(let x=left;x<right;x++)if(data[(y*info.width+x)*4+3]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
for(let y=minY;y<minY+95;y++)for(let x=left;x<right;x++)if(data[(y*info.width+x)*4+3]){hmin=Math.min(hmin,x);hmax=Math.max(hmax,x);}
const scale=106/(maxY-minY+1), w=Math.round((maxX-minX+1)*scale),xpos=Math.round(64-((hmin+hmax)/2-minX)*scale);
const cut=await sharp(data,{raw:info}).extract({left:minX,top:minY,width:maxX-minX+1,height:maxY-minY+1}).resize(w,106,{kernel:'nearest'}).png().toBuffer();
const normalized=await sharp({create:{width:128,height:128,channels:4,background:'#00000000'}}).composite([{input:cut,left:xpos,top:12}]).png().toBuffer();
// Replace only the arm band; retain original head and lower legs.
const f=frames[i].frame;
const original=await sharp('tmp/imagegen/thorg-before.webp').extract({left:f.x,top:f.y,width:128,height:128}).ensureAlpha().raw().toBuffer();
const pixels=await sharp(normalized).raw().toBuffer();
for(let y=46;y<94;y++)pixels.copy(original,y*128*4,y*128*4,(y+1)*128*4);
const cell=await sharp(original,{raw:{width:128,height:128,channels:4}}).png().toBuffer();
layers.push({input:cell,left:f.x,top:f.y,blend:'over'});previews.push({input:cell,left:i*128,top:0});
}
// Clear replaced cells before compositing, so old arm silhouettes disappear.
const base=await sharp('tmp/imagegen/thorg-before.webp').ensureAlpha().raw().toBuffer({resolveWithObject:true});
for(const {frame:f} of frames)for(let y=f.y;y<f.y+128;y++)base.data.fill(0,(y*base.info.width+f.x)*4,(y*base.info.width+f.x+128)*4);
await sharp(base.data,{raw:base.info}).composite(layers).webp({lossless:true}).toFile('public/assets/thorg/spritesheet.webp');
const strip=await sharp({create:{width:640,height:128,channels:4,background:'#273344'}}).composite(previews).png().toBuffer();
await sharp(strip).resize(1920,384,{kernel:'nearest'}).png().toFile('tmp/imagegen/attack-after.png');
})();
