// One continuous base image; original platform rows remain invisible colliders.
const fs=require('fs'),path=require('path'),sharp=require('../../../spritesheet-generator/node_modules/sharp');
const root=path.resolve(__dirname,'../../..');process.chdir(root);
const src='scripts/art/sky-soil/pixel-sources/',out='public/assets/sky-soil/';
async function pixel(input,file,grid,colors){
const meta=await sharp(input).metadata(),w=Math.ceil(meta.width/grid),h=Math.ceil(meta.height/grid);
// Area sampling collects existing shapes into a shared grid; palette quantization
// removes painted color noise. Hard alpha and nearest expansion keep edges crisp.
const small=await sharp(input).resize(w,h,{kernel:'lanczos3'}).ensureAlpha().raw().toBuffer();
for(let i=3;i<small.length;i+=4)small[i]=small[i]>=150?255:0;
const limited=await sharp(small,{raw:{width:w,height:h,channels:4}}).png({palette:true,colours:colors,dither:0}).toBuffer();
await sharp(limited).resize(meta.width,meta.height,{kernel:'nearest'}).webp({lossless:true}).toFile(out+file);
}
(async()=>{
await pixel(src+'sky.webp','sky-pixel.webp',4,32);
await pixel(src+'forest.webp','forest-pixel.webp',3,48);
await pixel(src+'peaks.webp','peaks-pixel.webp',4,24);
await pixel('public/assets/mangrove/lobbyPlatform.webp','small-platform-pixel.webp',5,32);
await pixel(src+'island.png','island-pixel.webp',2,40);
// Saved Map Studio layout lowers the pillar by 44 world px. Refit that region
// within the single master rather than reintroducing separate visible pieces.
const master=await sharp(src+'island.png').ensureAlpha().raw().toBuffer({resolveWithObject:true});
const data=Buffer.from(master.data),W=master.info.width,H=master.info.height;
for(let y=0;y<165;y++)for(let x=460;x<640;x++){
const dst=(y*W+x)*4;
if(y<54){data.fill(0,dst,dst+4);continue;}
const sy=Math.round(15+(y-54)*(165-15)/(165-54));
master.data.copy(data,dst,(sy*W+x)*4,(sy*W+x)*4+4);
}
const saved=await sharp(data,{raw:{width:W,height:H,channels:4}}).png().toBuffer();
await pixel(saved,'island-saved-pixel.webp',2,40);
for(const file of ['src/shared/maps/2.json','data/maps/2.json']){
const m=JSON.parse(fs.readFileSync(file));
for(const p of m.layout.platforms.filter(p=>['p0','p1','p2','p3'].includes(p.id)))p.alpha=0;
m.assets['mangrove-tiny-platform'].url='/assets/sky-soil/small-platform-pixel.webp';
const layers=m.scenery.layers;
layers.find(l=>l.id==='sky').url='/assets/sky-soil/sky-pixel.webp';
layers.find(l=>l.id==='far-peaks').url='/assets/sky-soil/peaks-pixel.webp';
layers.find(l=>l.id==='forest-ridges').url='/assets/sky-soil/forest-pixel.webp';
const base=layers.find(l=>l.id==='island-underside'||l.id==='island-base');
Object.assign(base,{id:'island-base',url:'/assets/sky-soil/'+(file.startsWith('data/')?'island-saved-pixel.webp':'island-pixel.webp'),scroll:1,fit:'none',scale:1,x:0,y:310,stack:'arena',filter:'nearest'});
for(const l of layers)l.filter='nearest';
// A single lighting pass on the unified island avoids four rectangular overlays.
m.scenery.atmosphere.platforms.strength=0;
fs.writeFileSync(file,JSON.stringify(m,null,2)+'\n');
}
await sharp(out+'sky-pixel.webp').composite([{input:out+'peaks-pixel.webp'},{input:out+'forest-pixel.webp'}]).webp({lossless:true}).toFile('/tmp/sky-soil-pixel-lobby.webp');fs.copyFileSync('/tmp/sky-soil-pixel-lobby.webp',out+'background.webp');
})();
