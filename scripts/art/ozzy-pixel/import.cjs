#!/usr/bin/env node
// Import once, then edit master.txt. Builds never overwrite the editable master.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const SIZE = 88;
const COLORS = ['111323','25203f','382759','493078','61359c','7c45bd',
  '522044','7d286e','a43897','c252b4','754b28','ad793f','e7b95d','ffe194',
  'd09664','f3bc80','ffe0a4','6c6878','aaa7ae','dbd9dd','fff9ef',
  '302016','53351e','785035','a47750','176586','209cb8','4bd7ed','baf8fa'];
async function main() {
  const {data,info} = await sharp(path.join(__dirname,'source/master.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let x0=info.width,y0=info.height,x1=0,y1=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>128){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
  const palette = COLORS.map(h=>[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)));
  const symbols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabc';
  const cell=(y1-y0+1)/68, left=(SIZE-(x1-x0+1)/cell)/2;
  const grid=Array.from({length:SIZE},()=>Array(SIZE).fill('.'));
  for(let gy=0;gy<SIZE;gy++)for(let gx=0;gx<SIZE;gx++){
    const votes=new Map();
    for(let sy=.2;sy<.81;sy+=.2)for(let sx=.2;sx<.81;sx+=.2){
      const x=Math.floor(x0+(gx-left+sx)*cell),y=Math.floor(y0+(gy-16+sy)*cell);
      let ch='.';
      if(x>=0&&x<info.width&&y>=0&&y<info.height){const i=(y*info.width+x)*4;
        if(data[i+3]>128){let best=Infinity;palette.forEach((p,k)=>{const d=p.reduce((s,c,j)=>s+(c-data[i+j])**2,0);if(d<best){best=d;ch=symbols[k];}});}}
      votes.set(ch,(votes.get(ch)||0)+1);
    }
    grid[gy][gx]=[...votes].sort((a,b)=>b[1]-a[1])[0][0];
  }
  fs.writeFileSync(path.join(__dirname,'master.txt'),'# Ozzy idle master. One character per art pixel; . is transparent.\n'+grid.map(r=>r.join('')).join('\n')+'\n');
  fs.writeFileSync(path.join(__dirname,'palette.json'),JSON.stringify(Object.fromEntries(palette.map((p,i)=>[symbols[i],p])),null,2)+'\n');
  console.log(JSON.stringify({source:info.width+'x'+info.height,bounds:[x0,y0,x1,y1],cell,grid:SIZE}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
