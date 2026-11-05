#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const sharp=require('../../../spritesheet-generator/node_modules/sharp');
const {ROWS,SIZE,PALETTE,PARTS}=require('./parts.cjs');
const {compose,pixels,CANVAS}=require('./render.cjs');
const {idlePose,FPS,FRAME_COUNT}=require('./idle.cjs');
const ROOT=path.resolve(__dirname,'../../..'), OUT=path.join(ROOT,'output/draven-pixel');
const raw=(data,w,h=w)=>sharp(data,{raw:{width:w,height:h,channels:4}});
const blank=(w,h)=>sharp({create:{width:w,height:h,channels:4,background:'#c6c9cd'}});
const label=(text,w)=>Buffer.from(`<svg width="${w}" height="36"><rect width="100%" height="100%" fill="#202331"/><text x="16" y="24" font-family="sans-serif" font-size="16" fill="white">${text}</text></svg>`);
async function main(){
 fs.mkdirSync(path.join(OUT,'frames'),{recursive:true});fs.mkdirSync(path.join(OUT,'current'),{recursive:true});
 const rest=pixels(ROWS.join('').split(''));
 await raw(rest,SIZE).png().toFile(path.join(OUT,'rest-64.png'));
 const body=await raw(rest,SIZE).resize(1254,1254,{kernel:'nearest'}).raw().toBuffer();
 await raw(body,1254).webp({lossless:true}).toFile(path.join(OUT,'body.webp'));
 const source=await sharp(path.join(ROOT,'public/assets/draven/body.webp')).ensureAlpha().raw().toBuffer();
 await blank(864,468).composite([{input:await sharp(path.join(ROOT,'public/assets/draven/body.webp')).resize(432,432,{kernel:'nearest'}).png().toBuffer(),left:0,top:36},{input:await raw(rest,SIZE).resize(432,432,{kernel:'nearest'}).png().toBuffer(),left:432,top:36},{input:label('SOURCE PORTRAIT',432),left:0,top:0},{input:label('CODE REST POSE',432),left:432,top:0}]).png().toFile(path.join(OUT,'rest-comparison.png'));
 let intersect=0,union=0,ae=0,fgerr=0,fgcount=0,identical=0;const diff=Buffer.alloc(body.length);
 for(let i=0;i<body.length;i+=4){const a=source[i+3]/255,b=body[i+3]/255;if(a>.5&&b)intersect++;if(a>.5||b)union++;
  let eq=source[i+3]===body[i+3];for(let c=0;c<4;c++) {const av=c===3?source[i+c]:source[i+c]*a,bv=c===3?body[i+c]:body[i+c]*b;ae+=Math.abs(av-bv);if(a>.5||b){fgerr+=Math.abs(av-bv);fgcount++;}if(c<3){diff[i+c]=Math.min(255,Math.abs(av-bv)*4);if(a&&source[i+c]!==body[i+c])eq=false;}}diff[i+3]=255;if(eq)identical++;
 }
 const report={source:{width:1254,height:1254,inferredGrid:64,scale:1254/64,paletteColors:28},accuracy:{silhouetteIoU:intersect/union,premultipliedRGBA_MAE:ae/body.length,foregroundUnionRGBA_MAE:fgerr/fgcount,exactPixelFraction:identical/(1254*1254),note:'Exact match includes transparent background; MAE uses 0–255 channels. Source has noisy colors and nonbinary alpha. Not a lossless reconstruction.'},animation:{frames:FRAME_COUNT,fps:FPS,durationSeconds:4}};
 await raw(diff,1254).resize(627,627,{kernel:'nearest'}).png().toFile(path.join(OUT,'difference-4x.png'));
 const atlas=JSON.parse(fs.readFileSync(path.join(ROOT,'public/assets/draven/animations.json')));
 const entries=atlas.frames.filter(f=>/^idle/.test(f.filename));if(entries.length!==FRAME_COUNT)throw Error('Idle count changed');
 const old=[];let bounds={left:250,top:250,right:0,bottom:0};
 for(const e of entries){const f=e.frame;const b=await sharp(path.join(ROOT,'public/assets/draven/spritesheet.webp')).extract({left:f.x,top:f.y,width:f.w,height:f.h}).ensureAlpha().raw().toBuffer();old.push(b);
  for(let y=0;y<250;y++)for(let x=0;x<250;x++)if(b[(y*250+x)*4+3]>127){bounds.left=Math.min(bounds.left,x);bounds.top=Math.min(bounds.top,y);bounds.right=Math.max(bounds.right,x);bounds.bottom=Math.max(bounds.bottom,y);}
 }
 const frames=[],comparison=[],contacts=[];const enlarged=[];
 for(let i=0;i<FRAME_COUNT;i++){
  const b=pixels(compose(idlePose(i)));frames.push(b);let name=`idle${String(i).padStart(2,'0')}.png`;
  await raw(b,CANVAS).png().toFile(path.join(OUT,'frames',name));
  await raw(old[i],250).png().toFile(path.join(OUT,'current',name));
  const big=await raw(b,CANVAS).resize(432,432,{kernel:'nearest'}).flatten({background:'#c6c9cd'}).png().toBuffer();enlarged.push(big);
  await sharp(big).toFile(path.join(OUT,`preview-${i}.png`));
  // Normalize the original with ONE union crop for all frames, preserving its
  // original relative motion. Native 250px frames are retained separately.
  const normalized=await raw(old[i],250).extract({left:bounds.left,top:bounds.top,width:bounds.right-bounds.left+1,height:bounds.bottom-bounds.top+1}).resize({width:384,height:384,fit:'inside',kernel:'nearest'}).png().toBuffer();
  const meta=await sharp(normalized).metadata();
  const current=await blank(432,432).composite([{input:normalized,left:Math.round((432-meta.width)/2),top:408-meta.height}]).png().toBuffer();
  const side=await blank(864,468).composite([{input:current,left:0,top:36},{input:big,left:432,top:36},{input:label('CURRENT IN-GAME • 8 frames / 2 fps',432),left:0,top:0},{input:label('CODE REBUILD • 8 frames / 2 fps',432),left:432,top:0}]).png().toBuffer();
  await sharp(side).toFile(path.join(OUT,`compare-${i}.png`));comparison.push(side);
  const tile=await raw(b,CANVAS).resize(288,288,{kernel:'nearest'}).flatten({background:'#c6c9cd'}).png().toBuffer();contacts.push({input:tile,left:(i%4)*288,top:Math.floor(i/4)*324+36});contacts.push({input:label(`Frame ${i} · ${i*.5}s`,288),left:(i%4)*288,top:Math.floor(i/4)*324});
 }
 await blank(1152,648).composite(contacts).png().toFile(path.join(OUT,'contact-sheet.png'));
 await sharp({create:{width:CANVAS*8,height:CANVAS,channels:4,background:'#00000000'}}).composite(await Promise.all(frames.map(async(b,i)=>({input:await raw(b,CANVAS).png().toBuffer(),left:i*CANVAS,top:0})))).png().toFile(path.join(OUT,'idle-strip.png'));
 for(const [pattern,name] of [['preview-%d.png','idle-preview.gif'],['compare-%d.png','comparison.gif']])execFileSync('ffmpeg',['-y','-loglevel','error','-framerate','2','-i',path.join(OUT,pattern),'-vf','split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=none','-loop','0',path.join(OUT,name)]);
 // Quantify the wrap alongside ordinary adjacent frame changes.
 report.animation.changedPixels=frames.map((b,i)=>{const next=frames[(i+1)%8];let n=0;for(let j=0;j<b.length;j+=4)if(!b.subarray(j,j+4).equals(next.subarray(j,j+4)))n++;return n;});
 report.comparison={originalUnionBounds:bounds,normalization:'Fixed union crop, nearest-neighbor fit into 384px; unchanged timing. Native frames in current/.'};
 fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
 fs.writeFileSync(path.join(OUT,'animations.json'),JSON.stringify({frames:frames.map((_,i)=>({filename:`idle0${i}`,frame:{x:i*CANVAS,y:0,w:CANVAS,h:CANVAS}})),meta:{image:'idle-strip.png',size:{w:CANVAS*8,h:CANVAS},fps:FPS}},null,2));
 fs.writeFileSync(path.join(OUT,'preview.html'),`<!doctype html><meta charset="utf-8"><title>Draven pixel idle</title><style>body{background:#202331;color:#eee;font:16px system-ui;margin:24px}img{image-rendering:pixelated;max-width:100%}button,input{margin:12px}small{display:block}</style><h1>Draven — code-rendered idle</h1><p>Current in-game (left) and rebuilt (right). Both eight frames at 2 fps, four-second loop. Fixed silhouette normalization for comparison.</p><img id="view" src="compare-0.png"><div><button id="play">Pause</button><input id="frame" type="range" min="0" max="7" value="0"><span id="num">0</span></div><small>Arrow keys step frames. Source-size frames: current/; rebuilt logical frames: frames/.</small><h2>All rebuilt poses at 4×</h2><img src="contact-sheet.png"><script>let n=0,playing=true;const v=document.querySelector('#view'),r=document.querySelector('#frame'),t=document.querySelector('#num'),p=document.querySelector('#play');function show(i){n=(i+8)%8;v.src='compare-'+n+'.png';r.value=n;t.textContent=n}function pause(){playing=false;p.textContent='Play'}p.onclick=()=>{playing=!playing;p.textContent=playing?'Pause':'Play'};r.oninput=()=>{pause();show(+r.value)};onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){pause();show(n+(e.key==='ArrowRight'?1:-1))}};setInterval(()=>{if(playing)show(n+1)},500)</script>`);
 console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
