const fs=require('fs'),path=require('path'),sharp=require('../../../spritesheet-generator/node_modules/sharp');
const root=path.resolve(__dirname,'../../..');process.chdir(root);
const source='/Users/nisch/.codex/generated_images/01a1d0e2-3790-7552-b9aa-552af715328b/';
(async()=>{
const out='public/assets/sky-soil/';
await sharp(source+'exec-6e3ebdfe-e9ae-4516-b9d2-27bbf7ab6e1f.png').webp({quality:94}).toFile(out+'sky-v2.webp');
await sharp(source+'exec-15aad0cb-f87f-4ae9-aa58-3eaf6862429f.png').webp({quality:94,alphaQuality:100}).toFile(out+'forest-ridges-v2.webp');
const master=await sharp(source+'exec-2b9d6016-5ad6-41f4-a6a3-2c0a49516cfb.png').resize(1100,680,{kernel:'nearest'}).png().toBuffer();
await sharp(master).toFile(out+'island-master.png');
const def=JSON.parse(fs.readFileSync('src/shared/maps/2.json'));
for(const p of def.layout.platforms.slice(0,4)){
const size=def.textureSizes[p.textureKey],w=Math.round(size.width*.6),h=Math.round(size.height*.6);
const left=Math.round(p.x-size.width*.3-600),top=Math.round(p.y-size.height*.3-410);
const original={p0:'baseMiddle',p1:'baseTop',p2:'baseLeft',p3:'baseRight'};
const mask='public/assets/mangrove/'+original[p.id]+'.webp';
await sharp(master).extract({left,top,width:w,height:h}).resize(size.width,size.height,{kernel:'nearest'}).composite([{input:mask,blend:'dest-in'}]).webp({lossless:true}).toFile(out+p.textureKey+'.webp');
}
await sharp(master).extract({left:14,top:380,width:1074,height:240}).webp({lossless:true}).toFile(out+'underside-v2.webp');
for(const file of ['src/shared/maps/2.json','data/maps/2.json']){
const m=JSON.parse(fs.readFileSync(file));
for(const p of m.layout.platforms.slice(0,4))m.assets[p.textureKey].url='/assets/sky-soil/'+p.textureKey+'.webp';
m.scenery.layers.find(l=>l.id==='sky').url='/assets/sky-soil/sky-v2.webp';
m.scenery.layers.find(l=>l.id==='forest-ridges').url='/assets/sky-soil/forest-ridges-v2.webp';
const u=m.scenery.layers.find(l=>l.id==='island-underside');u.url='/assets/sky-soil/underside-v2.webp';u.y=790+120*u.scale-440;
// Gentler light avoids washing out the richer cloud and meadow artwork.
m.scenery.atmosphere.glows[0].alpha=[0.12,0.22];
m.scenery.atmosphere.platforms.strength=0.08;
fs.writeFileSync(file,JSON.stringify(m,null,2)+'\n');
}
await sharp(out+'sky-v2.webp').resize(1536,1024).composite([{input:out+'far-peaks.webp'},{input:out+'forest-ridges-v2.webp'}]).webp({quality:94}).toFile('/tmp/sky-soil-bg-v2.webp');fs.copyFileSync('/tmp/sky-soil-bg-v2.webp',out+'background.webp');
})();
