#!/usr/bin/env node
// Preview-only Ozzy idle. Same master-art / quarter-pixel motion method as Ninja.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const ROOT=path.resolve(__dirname,'../../..');
const OUT=path.join(ROOT,'output/ozzy-pixel');
const palette=require('./palette.json');
const grid=fs.readFileSync(path.join(__dirname,'master.txt'),'utf8').split('\n').filter(l=>l&&!l.startsWith('#'));
const SIZE=88, BAKE=4, CELL=SIZE*BAKE, COUNT=40, MS=80;
const snap=v=>Math.round(v*BAKE)/BAKE;
const clamp=v=>Math.max(0,Math.min(1,v));
const layerAt=(x,y)=>x>=52&&y<=48?'book':x<30?'staff':'body';
function render(t){
  const data=Buffer.alloc(CELL*CELL*4),a=t*Math.PI*2;
  const rise=snap(-.75*(1-Math.cos(a))), sway=snap(.35*Math.sin(a));
  for(const layer of ['body','staff','book'])for(let py=0;py<CELL;py++)for(let px=0;px<CELL;px++){
    const x=px/BAKE,y=py/BAKE;let sx=x,sy=y;
    if(layer==='book'){sx-=snap(.35*Math.sin(a));sy-=snap(1.25*Math.sin(a-Math.PI/3));}
    if(layer==='body'){
      const footWeight=clamp((77-y)/17), gripWeight=clamp((x-29)/8);
      sx-=sway*footWeight*gripWeight;sy-=rise*footWeight*gripWeight;
      // Small lag at the loose coat edges; the belt and planted boots stay stable.
      if(y>62&&y<75){const edge=clamp((Math.abs(x-43)-5)/8);sx-=snap(.35*Math.sin(a-.7)*edge*Math.sin((y-62)/13*Math.PI));}
    }
    const ix=Math.floor(sx),iy=Math.floor(sy),ch=grid[iy]?.[ix];
    if(!ch||ch==='.'||layerAt(ix,iy)!==layer)continue;
    data.set([...palette[ch],255],(py*CELL+px)*4);
  }
  return data;
}
const png=(data,width=CELL,height=CELL)=>sharp(data,{raw:{width,height,channels:4}}).png();
async function main(){
  fs.mkdirSync(path.join(OUT,'frames'),{recursive:true});fs.mkdirSync(path.join(OUT,'candidate'),{recursive:true});
  const frames=Array.from({length:COUNT},(_,i)=>render(i/COUNT));
  if(!render(0).equals(render(1)))throw Error('Loop endpoint does not match');
  const colors=new Set(Object.values(palette).map(c=>c.join(',')));
  let unique=new Set(),maxStep=0;
  for(const [i,b] of frames.entries()){
    unique.add(require('node:crypto').createHash('sha256').update(b).digest('hex'));
    for(let y=0;y<CELL;y++)for(let x=0;x<CELL;x++){
      const j=(y*CELL+x)*4;if(!b[j+3])continue;
      if(x<4||y<4||x>=CELL-4||y>=CELL-4)throw Error('Clipped frame '+i);
      if(b[j+3]!==255||!colors.has([...b.subarray(j,j+3)].join(',')))throw Error('Palette or alpha error');
      if(y>=77*BAKE&&b.subarray(j,j+4).compare(frames[0].subarray(j,j+4)))throw Error('Feet moved');
    }
    const prev=frames[(i+COUNT-1)%COUNT];let changed=0;for(let j=0;j<b.length;j+=4)if(!b.subarray(j,j+4).equals(prev.subarray(j,j+4)))changed++;
    maxStep=Math.max(maxStep,changed);
    await png(b).toFile(path.join(OUT,'frames',`${String(i).padStart(2,'0')}.png`));
  }
  const atlasFrames=frames.map((b,i)=>({input:b,raw:{width:CELL,height:CELL,channels:4},left:(i%8)*CELL,top:Math.floor(i/8)*CELL}));
  await sharp({create:{width:CELL*8,height:CELL*5,channels:4,background:'#00000000'}}).composite(atlasFrames).webp({lossless:true}).toFile(path.join(OUT,'candidate/spritesheet.webp'));
  const atlas={frames:frames.map((_,i)=>({filename:`idle${String(i).padStart(2,'0')}`,frame:{x:(i%8)*CELL,y:Math.floor(i/8)*CELL,w:CELL,h:CELL},rotated:false,trimmed:false,spriteSourceSize:{x:0,y:0,w:CELL,h:CELL},sourceSize:{w:CELL,h:CELL}})),meta:{image:'spritesheet.webp',scale:'1'}};
  fs.writeFileSync(path.join(OUT,'candidate/animations.json'),JSON.stringify(atlas,null,2)+'\n');
  fs.writeFileSync(path.join(OUT,'candidate/animation-settings.json'),JSON.stringify({previewOnly:true,logicalSize:SIZE,bake:BAKE,groundY:84*BAKE,animations:{idle:{frameRate:1000/MS,repeat:-1,frames:atlas.frames.map(f=>f.filename)}}},null,2)+'\n');
  execFileSync('ffmpeg',['-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgba','-s',`${CELL}x${CELL}`,'-r',String(1000/MS),'-i','-','-filter_complex','split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=dither=none','-loop','0',path.join(OUT,'idle.gif')],{input:Buffer.concat(frames),maxBuffer:1<<28});
  execFileSync('img2webp',[...frames.flatMap((_,i)=>['-d',String(MS),path.join(OUT,'frames',`${String(i).padStart(2,'0')}.png`)]),'-loop','0','-o',path.join(OUT,'idle.webp')],{stdio:'pipe'});
  await sharp({create:{width:CELL*4,height:CELL*2,channels:4,background:'#969ca8'}}).composite([0,5,10,15,20,25,30,35].map((i,j)=>({input:frames[i],raw:{width:CELL,height:CELL,channels:4},left:j%4*CELL,top:Math.floor(j/4)*CELL}))).png().toFile(path.join(OUT,'contact-sheet.png'));
  const portrait=await sharp(path.join(ROOT,'public/assets/ozzy/body.webp')).trim().resize(260,272,{fit:'inside',kernel:'nearest'}).png().toBuffer();
  const old=await sharp(path.join(ROOT,'public/assets/ozzy/spritesheet.webp')).extract({left:80,top:54,width:61,height:89}).resize(240,272,{fit:'inside',kernel:'nearest'}).png().toBuffer();
  const label=Buffer.from('<svg width="940" height="420"><style>text{font:18px sans-serif;fill:#202535}</style><text x="40" y="35">body.webp reference</text><text x="350" y="35">Current idle</text><text x="650" y="35">New pixel idle</text></svg>');
  await sharp({create:{width:940,height:420,channels:4,background:'#969ca8'}}).composite([{input:portrait,left:55,top:109},{input:old,left:355,top:109},{input:frames[0],raw:{width:CELL,height:CELL,channels:4},left:580,top:45},{input:label,left:0,top:0}]).png().toFile(path.join(OUT,'comparison.png'));
  fs.writeFileSync(path.join(OUT,'preview.html'),`<!doctype html><html><meta charset="utf-8"><title>Ozzy pixel idle</title><style>body{background:#202333;color:#f6f3eb;font:16px system-ui;max-width:1060px;margin:40px auto}button,input{font:inherit}section{display:flex;align-items:end;gap:50px;background:#969ca8;padding:20px}img.sprite{image-rendering:pixelated}.large{width:352px;height:352px}.small{width:88px;height:88px}label{display:block;margin:20px 0}#comparison{width:100%}</style><h1>Ozzy — pixel idle, first pass</h1><p>Portrait-based master, planted feet and staff, breathing shoulders, independently floating book. 40 frames · 3.2 seconds · 12.5 fps. Preview only.</p><section><img class="sprite large" src="frames/00.png"><img class="sprite small" src="frames/00.png"></section><label><button id="toggle">Pause</button> <input id="frame" type="range" min="0" max="39" value="0"> <span id="count"></span></label><p>Small view is native art resolution; final in-game scale will be set during installation.</p><img id="comparison" src="comparison.png"><p>Reference comparison uses enlarged silhouettes for readability.</p><script>const imgs=[...document.querySelectorAll('.sprite')],slider=document.querySelector('#frame'),count=document.querySelector('#count');let play=true,i=0;function show(){imgs.forEach(img=>img.src='frames/'+String(i).padStart(2,'0')+'.png');slider.value=i;count.textContent=(i+1)+' / 40';}document.querySelector('#toggle').onclick=()=>{play=!play;document.querySelector('#toggle').textContent=play?'Pause':'Play'};slider.oninput=()=>{play=false;i=+slider.value;document.querySelector('#toggle').textContent='Play';show()};setInterval(()=>{if(play){i=(i+1)%40;show()}},80);show();</script></html>`);
  fs.writeFileSync(path.join(OUT,'checks.json'),JSON.stringify({frames:COUNT,uniqueFrames:unique.size,durationMs:COUNT*MS,binaryAlpha:true,paletteColors:colors.size,feetFixed:true,loopEndpointExact:true,safeMargins:true,maxChangedPixelsPerStep:maxStep},null,2)+'\n');
  console.log(`Built ${COUNT} frames (${unique.size} unique); palette, alpha, foot registration, margins and loop checks passed. ${OUT}`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
