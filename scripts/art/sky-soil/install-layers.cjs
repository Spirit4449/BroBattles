const fs=require('fs');
const sharp=require('../../../spritesheet-generator/node_modules/sharp');
const root=require('path').resolve(__dirname,'../../..');
process.chdir(root);
const source='/Users/nisch/.codex/generated_images/01a1d0e2-3790-7552-b9aa-552af715328b/';
(async()=>{
await sharp(source+'exec-fb606032-46b2-4464-bf3a-e2895adf45a8.png').webp({quality:94}).toFile('public/assets/sky-soil/sky.webp');
for(const [name,top,height,place] of [['far-peaks',0,490,270],['forest-ridges',520,504,470]]){
const strip=await sharp(source+'exec-49d8ee49-1852-435f-a127-cfef17d96087.png').extract({left:0,top,width:1536,height}).ensureAlpha().toBuffer();
// Extend the solid terrain below the canvas, so each range has no visible bottom edge.
const edge=await sharp(strip).extract({left:0,top:height-4,width:1536,height:4}).resize(1536,1024-place-height,{kernel:'nearest'}).toBuffer();
await sharp({create:{width:1536,height:1024,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:strip,left:0,top:place},{input:edge,left:0,top:place+height}]).webp({lossless:true}).toFile(`public/assets/sky-soil/${name}.webp`);
}
for(const file of ['src/shared/maps/2.json','data/maps/2.json']){
const m=JSON.parse(fs.readFileSync(file));const underside=m.scenery.layers.find(l=>l.id==='island-underside');
m.scenery.layers=[{id:'sky',url:'/assets/sky-soil/sky.webp',scroll:0.025},{id:'far-peaks',url:'/assets/sky-soil/far-peaks.webp',scroll:0.10,fit:'cover-x',y:-60,fog:0.40},{id:'forest-ridges',url:'/assets/sky-soil/forest-ridges.webp',scroll:0.26,fit:'cover-x',y:80,fog:0.18},underside];
m.scenery.atmosphere={fogColor:'#d2f4d7',glows:[{after:'sky',x:650,y:-480,scroll:0.04,radius:1050,color:'#fff6ce',alpha:[0.20,0.32],periodMs:10000}],mist:[{after:'far-peaks',color:'#d4f4db',alpha:0.40,scroll:0.12,y:190,height:400,speed:5},{after:'forest-ridges',color:'#ccefd7',alpha:0.28,scroll:0.28,y:420,height:400,speed:11},{after:'arena',color:'#d9f5e1',alpha:0.12,scroll:0.8,y:650,height:320,speed:16}],rays:[{after:'forest-ridges',x:620,y:-650,scroll:0.18,count:6,angle:26,spread:22,length:2200,width:[80,220],color:'#fff8d6',alpha:[0.06,0.16],periodMs:[6000,11000]}],dust:[{after:'forest-ridges',color:'#efffd9',count:24,superHighCount:40,scroll:0.35,size:[3,7],alpha:0.30}],platforms:{top:'#fff5d3',bottom:'#315349',strength:0.16},vignette:{color:'#123e42',alpha:0.14}};
m.scenery.clouds={enabled:true,items:[{id:'sky-soil-far-cloud',type:'cloud-1',x:400,y:80,direction:'right',speed:4,scale:0.55,alpha:0.5,after:'sky'},{id:'sky-soil-mid-cloud',type:'cloud-3',x:1800,y:210,direction:'left',speed:7,scale:0.55,alpha:0.5,after:'far-peaks'},{id:'sky-soil-low-cloud',type:'cloud-6',x:900,y:900,direction:'right',speed:11,scale:0.75,alpha:0.35,after:'forest-ridges'}]};
fs.writeFileSync(file,JSON.stringify(m,null,2)+'\n');
}
})();
