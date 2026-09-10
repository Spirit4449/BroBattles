const sharp=require('/Users/nisch/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const fs=require('fs');
(async()=>{
const src='/Users/nisch/.codex/generated_images/01a0890d-7308-71f2-b492-0ca554683bad/exec-bcccb58a-1b94-42b3-a66b-d6885b764cc5.png';
const {data,info}=await sharp(src).ensureAlpha().raw().toBuffer({resolveWithObject:true});
for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const p=(y*info.width+x)*4;if(y<145||y>578||(data[p+2]>data[p]*1.08&&data[p+2]>data[p+1]))data[p+3]=0;}
const base=await sharp('tmp/imagegen/thorg-before-head-fix.webp').ensureAlpha().raw().toBuffer({resolveWithObject:true});
const frames=JSON.parse(fs.readFileSync('public/assets/thorg/animations.json')).frames.filter(f=>f.filename.startsWith('throw'));
const bounds=[0,490,880,1300,1750,info.width];let previews=[];
for(let i=0;i<5;i++){
let minX=bounds[i+1],maxX=0,minY=info.height,maxY=0,hmin=info.width,hmax=0;
for(let y=0;y<info.height;y++)for(let x=bounds[i];x<bounds[i+1];x++)if(data[(y*info.width+x)*4+3]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
for(let y=minY;y<minY+95;y++)for(let x=bounds[i];x<bounds[i+1];x++)if(data[(y*info.width+x)*4+3]){hmin=Math.min(hmin,x);hmax=Math.max(hmax,x);}
const scale=106/(maxY-minY+1),w=Math.round((maxX-minX+1)*scale),left=Math.round(64-((hmin+hmax)/2-minX)*scale);
const cut=await sharp(data,{raw:info}).extract({left:minX,top:minY,width:maxX-minX+1,height:maxY-minY+1}).resize(w,106,{kernel:'nearest'}).png().toBuffer();
const norm=await sharp({create:{width:128,height:128,channels:4,background:'#00000000'}}).composite([{input:cut,left,top:12}]).raw().toBuffer();
const f=frames[i].frame;
for(let y=0;y<70;y++)for(let x=0;x<128;x++){
const head=y<46||(x>=38&&x<=90&&y<51)||(i!==2&&x>=38&&x<=90&&y<70)||(i===2&&x>=47&&x<64&&y<56);
if(head){const p=((f.y+y)*base.info.width+f.x+x)*4;norm.copy(base.data,p,(y*128+x)*4,(y*128+x)*4+4);}
}
}
await sharp(base.data,{raw:base.info}).webp({lossless:true}).toFile('public/assets/thorg/spritesheet.webp');
for(let i=0;i<5;i++){const f=frames[i].frame;previews.push({input:await sharp(base.data,{raw:base.info}).extract({left:f.x,top:f.y,width:128,height:128}).png().toBuffer(),left:i*128,top:0});}
const preview=await sharp({create:{width:640,height:128,channels:4,background:'#273344'}}).composite(previews).png().toBuffer();
await sharp(preview).resize(1920,384,{kernel:'nearest'}).toFile('tmp/imagegen/attack-head-fixed.png');
})();
