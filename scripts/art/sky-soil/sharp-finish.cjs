const fs=require('fs'),path=require('path'),sharp=require('../../../spritesheet-generator/node_modules/sharp');
process.chdir(path.resolve(__dirname,'../../..'));
const out='public/assets/sky-soil/',src='scripts/art/sky-soil/';
// Discard detached specks; keep the single connected island.
function keepLargest(data,width,height){
const seen=new Uint8Array(width*height),queue=new Int32Array(width*height);let largest=[];
for(let seed=0;seed<seen.length;seed++){
if(seen[seed]||data[seed*4+3]===0)continue;
let head=0,tail=1;queue[0]=seed;seen[seed]=1;
while(head<tail){const v=queue[head++],x=v%width,y=Math.floor(v/width);
for(const n of [x>0?v-1:-1,x<width-1?v+1:-1,y>0?v-width:-1,y<height-1?v+width:-1])if(n>=0&&!seen[n]&&data[n*4+3]){seen[n]=1;queue[tail++]=n;}}
if(tail>largest.length)largest=Array.from(queue.subarray(0,tail));
}
seen.fill(0);for(const v of largest)seen[v]=1;for(let v=0;v<seen.length;v++)if(!seen[v])data[v*4+3]=0;
}
async function crisp(input,file){
const {data,info}=await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject:true});
for(let i=3;i<data.length;i+=4)data[i]=data[i]>=160?255:0;
await sharp(data,{raw:info}).webp({lossless:true}).toFile(out+file);
}
(async()=>{
await crisp(src+'sharp-sources/forest.png','forest-sharp.webp');
await crisp(src+'pixel-sources/sky.webp','sky-sharp.webp');
await crisp(src+'pixel-sources/peaks.webp','peaks-sharp.webp');
await crisp('public/assets/mangrove/lobbyPlatform.webp','small-platform-sharp.webp');
const meta=await sharp(src+'sharp-sources/island.png').metadata();
const width=meta.width,height=Math.round(width*680/1100),ratio=width/1100;
const {data,info}=await sharp(src+'sharp-sources/island.png').resize(width,height,{kernel:'nearest'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
for(let i=3;i<data.length;i+=4)data[i]=data[i]>=160?255:0;
keepLargest(data,width,height);
await sharp(data,{raw:info}).webp({lossless:true}).toFile(out+'island-sharp.webp');
const saved=Buffer.from(data);
for(let y=0;y<Math.round(165*ratio);y++)for(let x=Math.round(460*ratio);x<Math.round(640*ratio);x++){
const dst=(y*width+x)*4;if(y<54*ratio){saved.fill(0,dst,dst+4);continue;}
const sy=Math.round(15*ratio+(y-54*ratio)*150/111);data.copy(saved,dst,(sy*width+x)*4,(sy*width+x)*4+4);
}
// The pillar refit copies pixels after the first pass; clean again.
keepLargest(saved,width,height);
await sharp(saved,{raw:info}).webp({lossless:true}).toFile(out+'island-saved-sharp.webp');
for(const file of ['src/shared/maps/2.json','data/maps/2.json']){
const m=JSON.parse(fs.readFileSync(file));
for(const [id,name]of [['sky','sky'],['far-peaks','peaks'],['forest-ridges','forest']]){const l=m.scenery.layers.find(l=>l.id===id);l.url='/assets/sky-soil/'+name+'-sharp.webp';l.filter='nearest';if(l.fog)l.fog=id==='far-peaks'?0.16:0.04;}
const base=m.scenery.layers.find(l=>l.id==='island-base');base.url='/assets/sky-soil/'+(file.startsWith('data/')?'island-saved-sharp.webp':'island-sharp.webp');base.scale=1100/width;
m.assets['mangrove-tiny-platform'].url='/assets/sky-soil/small-platform-sharp.webp';
// Retain atmosphere depth without a milky veil across the detailed artwork.
m.scenery.atmosphere.mist[0].alpha=0.20;m.scenery.atmosphere.mist[1].alpha=0.10;m.scenery.atmosphere.mist[2].alpha=0.04;
m.scenery.atmosphere.glows[0].alpha=[0.06,0.12];m.scenery.atmosphere.rays[0].alpha=[0.03,0.08];
fs.writeFileSync(file,JSON.stringify(m,null,2)+'\n');
}
await sharp(out+'sky-sharp.webp').composite([{input:out+'peaks-sharp.webp'},{input:out+'forest-sharp.webp'}]).webp({lossless:true}).toFile('/tmp/sky-soil-sharp-bg.webp');fs.copyFileSync('/tmp/sky-soil-sharp-bg.webp',out+'background.webp');
console.log({islandTexture:[width,height],worldWidth:1100,scale:1100/width});
})();
