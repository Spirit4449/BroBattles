// Optional source study / initial transcription. Renderer does not depend on this.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, 'output/draven-pixel');
const median = a => a.sort((a,b)=>a-b)[a.length>>1];
(async()=>{
 const {data,info}=await sharp(path.join(ROOT,'public/assets/draven/body.webp')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const sample = n => Array.from({length:n*n},(_,i)=>{
  const x=i%n,y=Math.floor(i/n), channels=[[],[],[],[]];
  for(let yy=Math.floor((y+.25)*info.height/n); yy<Math.ceil((y+.75)*info.height/n); yy++)
   for(let xx=Math.floor((x+.25)*info.width/n);xx<Math.ceil((x+.75)*info.width/n);xx++)
    for(let c=0;c<4;c++)channels[c].push(data[(yy*info.width+xx)*4+c]);
  const p=channels.map(median);return p[3]<128?[0,0,0,0]:[...p.slice(0,3),255];
 });
 const candidates=[];
 for(let n=60;n<=68;n++){
  const cells=sample(n);let err=0;
  for(let y=0;y<info.height;y+=3)for(let x=0;x<info.width;x+=3){const p=cells[Math.floor(y*n/info.height)*n+Math.floor(x*n/info.width)],j=(y*info.width+x)*4;for(let c=0;c<3;c++)err+=Math.abs(p[c]*p[3]/255-data[j+c]*data[j+3]/255);err+=Math.abs(p[3]-data[j+3]);}
  candidates.push({size:n,premultipliedMAE:err/(Math.ceil(info.width/3)*Math.ceil(info.height/3)*4)});
 }
 const n=64,cells=sample(n), solid=cells.filter(p=>p[3]);
 // Deterministic farthest-point seed and Lloyd palette fitting.
 const dist=(a,b)=>a.slice(0,3).reduce((s,v,i)=>s+(v-b[i])**2,0);
 let palette=[solid[0].slice(0,3)];
 while(palette.length<28){let best=solid.reduce((a,p)=>Math.min(...palette.map(c=>dist(p,c)))>Math.min(...palette.map(c=>dist(a,c)))?p:a);palette.push(best.slice(0,3));}
 for(let k=0;k<30;k++){let sums=palette.map(()=>[0,0,0,0]);for(const p of solid){let j=palette.reduce((b,c,i)=>dist(p,c)<dist(p,palette[b])?i:b,0);p.slice(0,3).forEach((v,c)=>sums[j][c]+=v);sums[j][3]++;}palette=palette.map((p,i)=>sums[i][3]?sums[i].slice(0,3).map(v=>Math.round(v/sums[i][3])):p);}
 palette.sort((a,b)=>a.reduce((s,v)=>s+v,0)-b.reduce((s,v)=>s+v,0));
 const symbols='ABCDEFGHIJKLMNOPQRSTUVWXYZab';
 const rows=Array.from({length:n},(_,y)=>cells.slice(y*n,(y+1)*n).map(p=>!p[3]?'.':symbols[palette.reduce((b,c,i)=>dist(p,c)<dist(p,palette[b])?i:b,0)]).join(''));
 fs.writeFileSync(path.join(__dirname,'pixels.cjs'),`// Transcribed 64x64 portrait. Editable palette-indexed pixels, no raster dependency.\nmodule.exports = ${JSON.stringify({size:n,palette:Object.fromEntries(palette.map((p,i)=>[symbols[i],p])),rows},null,2)};\n`);
 fs.writeFileSync(path.join(OUT,'source-study.json'),JSON.stringify({width:info.width,height:info.height,candidates,paletteSize:palette.length,method:'Median of cell central 50%, 28-color deterministic k-means; alpha threshold 128.'},null,2));
 console.log(candidates);console.log(rows.map((r,i)=>`${String(i).padStart(2)} ${r}`).join('\n'));
})();
