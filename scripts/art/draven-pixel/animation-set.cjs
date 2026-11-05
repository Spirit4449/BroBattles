#!/usr/bin/env node
// Preview-only full Draven set. Palette tiles are the artwork; all posing,
// coverage, flame accents and secondary effects are authored here in code.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const sharp=require('../../../spritesheet-generator/node_modules/sharp');
const {PALETTE,PARTS,ROWS,ORDER}=require('./parts.cjs');
const grounded=require('./grounded-idle.cjs');
const ROOT=path.resolve(__dirname,'../../..'),OUT=path.join(ROOT,'output/draven-pixel/all-animations');
const SCALE=4,W=144,H=96,OX=28,OY=14,FPS=25,TAU=2*Math.PI;
const I=[1,0,0,1,0,0];
const mul=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const tr=(x,y)=>[1,0,0,1,x,y];
function rot(x,y,degrees){let a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return mul(tr(x,y),mul([c,s,-s,c,0,0],tr(-x,-y)));}
function inv(m){let d=m[0]*m[3]-m[1]*m[2];return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];}
const apply=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=v=>{v=clamp(v);return v*v*(3-2*v)};
function track(t,keys){for(let i=1;i<keys.length;i++)if(t<=keys[i][0]){let a=keys[i-1],b=keys[i],u=ease((t-a[0])/(b[0]-a[0]));return a[1]+(b[1]-a[1])*u}return keys.at(-1)[1];}
const CLIPS=[
 {name:'idle',label:'IDLE',detail:'Grounded breath • original staff magic',count:50,loop:true},
 {name:'run',label:'RUN',detail:'Forward drive • alternating robe stride',count:20,loop:true},
 {name:'attack',label:'ATTACK / CAST',detail:'Windup → staff thrust → recovery',count:30,loop:false},
 {name:'jump',label:'JUMP',detail:'Crouch → launch → tucked ascent',count:25,loop:false},
 {name:'fall',label:'FALL',detail:'Suspended robe • braced landing',count:25,loop:false},
 {name:'hit',label:'HIT REACTION',detail:'Recoil → settle → ready stance',count:20,loop:false},
 {name:'sliding',label:'WALL SLIDE',detail:'Wall contact • compressed stance',count:25,loop:true},
 {name:'dying',label:'DEATH',detail:'Stagger → collapse • extinguishing magic',count:50,loop:false},
 {name:'special',label:'SPECIAL / INFERNO',detail:'Channeling hover • charged staff and rising embers',count:50,loop:true}
];
function pose(name,t){
 let p={x:0,y:0,lean:0,arm:0,bend:0,reachX:0,reachY:0,weapon:0,hem:0,skirt:0,collapse:0,fire:1};
 const wave=Math.sin(TAU*t);
 if(name==='run')Object.assign(p,{y:-1.5+1.5*Math.cos(TAU*t*2),lean:11,arm:23*wave,bend:8+8*Math.cos(TAU*t),reachX:1,reachY:-3+wave,weapon:-29+4*wave,hem:2.5*wave,skirt:4*Math.sin(TAU*t+.7)});
 if(name==='attack'){
  const wind=track(t,[[0,0],[.23,1],[.42,0],[1,0]]),cast=track(t,[[0,0],[.25,0],[.43,1],[.6,.85],[1,0]]);
  Object.assign(p,{y:2*wind,lean:-7*wind+11*cast,arm:18*wind-95*cast,bend:-9*cast,reachX:-2*wind+5*cast,reachY:-3*wind-4*cast,weapon:-22*wind+27*cast,skirt:-cast});
 }
 if(name==='jump'){
  const crouch=track(t,[[0,0],[.24,1],[.5,0],[1,0]]),launch=ease((t-.25)/.45);
  Object.assign(p,{y:3*crouch-7*launch,lean:5*crouch-5*launch,arm:-22*launch,bend:16*launch,reachY:-5*launch,weapon:-22*launch,hem:2*launch,skirt:2*launch});
 }
 if(name==='fall'){
  const land=ease((t-.65)/.18),settle=ease((t-.83)/.17),air=1-land;
  Object.assign(p,{y:-7*air+3*(land-settle),lean:-5*air+5*(land-settle),arm:-20*air,reachY:-4*air,weapon:15*air,hem:-3*air,skirt:2*air});
 }
 if(name==='hit'){
  const kick=track(t,[[0,0],[.18,1],[.38,.7],[.75,.15],[1,0]]);
  Object.assign(p,{x:-2*kick,y:1.5*kick,lean:-13*kick,arm:18*kick,reachX:-2*kick,reachY:-2*kick,weapon:-18*kick,skirt:1.5*kick});
 }
 if(name==='sliding')Object.assign(p,{y:1+.4*wave,lean:-7,arm:65,bend:8,reachX:1,reachY:-4,weapon:7,hem:2,skirt:-2});
 if(name==='dying'){
  const c=ease((t-.2)/.56),stagger=Math.sin(clamp(t/.35)*Math.PI);
  Object.assign(p,{y:2*stagger,lean:-8*stagger,arm:-65*c,reachY:-2*stagger,weapon:5*stagger,collapse:c,fire:1-ease((t-.15)/.5)});
 }
 if(name==='special'){
  const charge=.5-.5*Math.cos(TAU*t);
  Object.assign(p,{y:-2-2*charge,lean:-2,arm:-100-5*charge,bend:-8,reachY:-7-2*charge,reachX:-1,weapon:-4,hem:1.3*wave,skirt:1.5*wave,fire:1});
 }
 return p;
}
function makeLayers(p){
 const body=mul(tr(p.x,p.y),rot(28,44,p.lean));
 const global=mul(tr(0,-7*p.collapse),rot(28,62,88*p.collapse));
 const bm=mul(global,body);
 const left=mul(bm,rot(20,34,p.arm));
 const hand=mul(left,rot(17,42,p.bend));
 const wrist=[41+p.reachX,39+p.reachY];
 const vx=wrist[0]-31,vy=wrist[1]-35,angle=Math.atan2(vy,vx)-Math.atan2(4,10),len=Math.hypot(vx,vy)/Math.hypot(10,4);
 const c=Math.cos(angle)*len,s=Math.sin(angle)*len;
 const arm=mul(bm,mul(tr(31,35),mul([c,s,-s,c,0,0],tr(-31,-35))));
 let weapon=mul(bm,mul(tr(p.reachX,p.reachY),rot(41,39,p.weapon)));
 if(p.collapse){
  const drop=mul(tr(0,-2*p.collapse),rot(41,62,88*p.collapse));
  weapon=mul(drop,mul(tr(p.reachX*(1-p.collapse),p.reachY*(1-p.collapse)),rot(41,39,p.weapon*(1-p.collapse))));
 }
 const neck=apply(body,27,33);
 const head=mul(global,tr(neck[0]-27,neck[1]-33));
 const maps={hood:head,torso:bm,leftSleeve:left,leftHand:hand,rightSleeve:arm,staff:weapon,grip:weapon,flame:weapon,crystal:weapon,shardLeft:weapon,shardRight:weapon,robe:global};
 return {maps:Object.fromEntries(Object.entries(maps).map(([k,m])=>[k,inv(m)])),body,global,weapon};
}
// Additional hidden cloth at joints: two-pixel aprons, covered by the original
// outer tiles. These are colors from the original palette, not pasted images.
function tile(name,x,y){
 let ch=PARTS[name][y]?.[x];if(ch&&ch!=='.')return ch;
 if(name==='torso'&&x>=21&&x<=31&&y>=33&&y<=44)return x<24?'F':'L';
 if(name==='leftSleeve'&&x>=18&&x<=21&&y>=32&&y<=35)return 'L';
 if(name==='rightSleeve'&&x>=30&&x<=34&&y>=34&&y<=37)return 'L';
 if(name==='leftSleeve'&&x>=15&&x<=18&&y>=43&&y<=46)return 'F';
 return '.';
}
function render(name,frame){
 if(name==='idle'){
  // Use the accepted grounded idle without reinterpreting its pose.
  const src=grounded.render(frame),b=Buffer.alloc(W*SCALE*H*SCALE*4);
  for(let y=0;y<72*SCALE;y++)for(let x=0;x<72*SCALE;x++){
   const si=(Math.floor((y+.5)*6/SCALE)*432+Math.floor((x+.5)*6/SCALE))*4;
   const di=((y+(OY-4)*SCALE)*W*SCALE+x+(OX-4)*SCALE)*4;src.copy(b,di,si,si+4);
  }return b;
 }
 const clip=CLIPS.find(c=>c.name===name),t=clip.loop?((frame%clip.count)+clip.count)%clip.count/clip.count:clamp(frame/(clip.count-1));
 const p=pose(name,t),rig=makeLayers(p),width=W*SCALE,height=H*SCALE,b=Buffer.alloc(width*height*4),phase=TAU*t*(name==='special'?4:2);
 const colorAt=(name,x,y)=>tile(name,Math.floor(x),Math.floor(y));
 const write=(x,y,c)=>{if(x<0||x>=width||y<0||y>=height)return;const i=(y*width+x)*4;b.set(c,i);b[i+3]=255};
 // Rendering each destination pixel through the inverse transform avoids
 // forward-splat cracks; hidden overlap aprons cover moving attachments.
 for(const part of ORDER){
  const magic=['flame','crystal','shardLeft','shardRight'].includes(part);
  if(magic&&p.fire<.05)continue;
  const m=rig.maps[part];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const wx=(x+.5)/SCALE-OX,wy=(y+.5)/SCALE-OY;
   let [sx,sy]=apply(m,wx,wy);
   if(part==='robe'){
    // Waist follows torso; hem stays grounded except on airborne clips.
    const lift=['jump','fall','special'].includes(name)?p.y:0;
    const top=44+p.y,bot=63+lift;
    const u=clamp((sy-top)/(bot-top));
    sy=44+(sy-top)*19/(bot-top);
    const leanShift=apply(rig.body,28,44)[0]-28;
    sx-=leanShift*(1-u)+p.skirt*Math.sin(Math.PI*u)+p.hem*u*(sx<27?-1:1);
    sy-=p.hem*Math.sin(Math.PI*u)*(sx<27?-.6:.6);
   }
   if(part==='leftSleeve'&&sy>40){
    // Blend toward the hand's bend at the cuff, avoiding detached wrists.
    const h=apply(rig.maps.leftHand,wx,wy),u=clamp((sy-40)/5);sx=sx*(1-u)+h[0]*u;sy=sy*(1-u)+h[1]*u;
   }
   if(magic){
    const row=Math.floor(sy),weight=clamp((29-row)/16);
    sx-=Math.round(SCALE*.32*weight*(Math.sin(phase+(29-row)*.42)-Math.sin((29-row)*.42)))/SCALE;
    if(p.fire<1){sx=42+(sx-42)/Math.max(.05,p.fire);sy=28+(sy-28)/Math.max(.05,p.fire);}
   }
   let ch=colorAt(part,sx,sy);if(ch==='.'||!ch)continue;
   if(magic){const wave=Math.sin(phase*2+Math.floor(sy)*.9+Math.floor(sx)*.55)*Math.sin(phase/2)**2;if(wave>.86&&ch==='O')ch='b';else if(wave>.72&&ch==='E')ch='M';else if(wave<-.88&&ch==='b')ch='O';}
   write(x,y,PALETTE[ch]);
  }
 }
 // Inferno's restrained orbit of original-color embers is separate from the
 // unchanged staff silhouette. Pixels are square, with no glow/filtering.
 if(name==='special')for(let k=0;k<9;k++){
  const age=(t*2+k/9)%1,a=TAU*(t+k/9),xx=28+Math.cos(a)*19,yy=64-age*47;
  if(age>.88)continue;
  const color=PALETTE[age>.6?'O':'b'],side=age>.6?2:3;
  for(let y=0;y<side;y++)for(let x=0;x<side;x++)write(Math.round((xx+OX)*SCALE)+x,Math.round((yy+OY)*SCALE)+y,color);
 }
 return b;
}
const raw=b=>sharp(b,{raw:{width:W*SCALE,height:H*SCALE,channels:4}});
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
function panel(title,sub,width=1280,height=720){return Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#171b29"/><rect x="30" y="30" width="4" height="64" fill="#d45cff"/><text x="52" y="61" font-family="sans-serif" font-weight="bold" font-size="30" fill="#f5f0ff">${escape(title)}</text><text x="52" y="91" font-family="sans-serif" font-size="17" fill="#b9b3c8">${escape(sub)}</text><line x1="100" x2="1180" y1="626" y2="626" stroke="#41445b"/><text x="52" y="684" font-family="sans-serif" font-size="14" fill="#8e91aa">DRAVEN / CODE-GENERATED PIXEL ART · PREVIEW ONLY · 25 FPS</text></svg>`)}
async function main(){
 fs.mkdirSync(OUT,{recursive:true});const frameCache={},manifest={fps:FPS,frameSize:{w:W*SCALE,h:H*SCALE},clips:[]};
 for(const clip of CLIPS){
  const dir=path.join(OUT,clip.name);fs.mkdirSync(dir,{recursive:true});frameCache[clip.name]=[];
  for(let i=0;i<clip.count;i++){
   const b=render(clip.name,i);const width=W*SCALE,height=H*SCALE;
   for(let x=0;x<width;x++)assert(!b[x*4+3]&&!b[((height-1)*width+x)*4+3],`${clip.name} vertical clipping`);
   for(let y=0;y<height;y++)assert(!b[(y*width)*4+3]&&!b[(y*width+width-1)*4+3],`${clip.name} horizontal clipping`);
   const png=await raw(b).png().toBuffer();frameCache[clip.name].push(png);await fs.promises.writeFile(path.join(dir,`${String(i).padStart(3,'0')}.png`),png);
  }
  if(clip.loop)assert(render(clip.name,0).equals(render(clip.name,clip.count)),`${clip.name} periodicity`);
  const indexes=Array.from({length:8},(_,i)=>Math.round(i*(clip.count-1)/7));
  await sharp({create:{width:W*3*4,height:H*3*2+56,channels:4,background:'#c6c9cd'}}).composite(await Promise.all(indexes.map(async(i,j)=>({input:await sharp(frameCache[clip.name][i]).resize(W*3,H*3,{kernel:'nearest'}).png().toBuffer(),left:(j%4)*W*3,top:28+Math.floor(j/4)*H*3})))).png().toFile(path.join(dir,'contact-sheet.png'));
  manifest.clips.push({...clip,durationSeconds:clip.count/FPS,path:`${clip.name}/%03d.png`});
  console.log(`Rendered ${clip.name}: ${clip.count} frames`);
 }
 fs.writeFileSync(path.join(OUT,'manifest.json'),JSON.stringify(manifest,null,2));
 // Labeled 4-second chapters, plus a six-second 3x3 simultaneous overview.
 const videoDir=path.join(OUT,'video-frames');fs.mkdirSync(videoDir,{recursive:true});let seq=0;
 for(const clip of CLIPS){
  const bg=panel(clip.label,clip.detail);let base=await sharp(bg).png().toBuffer();
  for(let i=0;i<100;i++){
   let f=clip.loop?i%clip.count:Math.min(i%50,clip.count-1);
   if(clip.name==='dying')f=Math.min(i,clip.count-1);
   const sprite=await sharp(frameCache[clip.name][f]).resize(W*6,H*6,{kernel:'nearest'}).extract({left:0,top:0,width:W*6,height:550}).png().toBuffer();
   // Body rest ground: (63+14)*6 + 164 = 626.
   let layers=[{input:sprite,left:220,top:164}];
   if(clip.name==='sliding')layers.unshift({input:Buffer.from('<svg width="25" height="400"><rect width="25" height="400" fill="#424255"/><path d="M25 0V400" stroke="#77758c" stroke-width="4"/></svg>'),left:220+(28+7)*6-25,top:226});
   await sharp(base).composite(layers).png().toFile(path.join(videoDir,`${String(seq++).padStart(4,'0')}.png`));
  }
 }
 for(let i=0;i<150;i++){
  const layers=[];
  for(let j=0;j<CLIPS.length;j++){
   const c=CLIPS[j],f=c.loop?i%c.count:Math.min(i%75,c.count-1),x=(j%3)*426,y=Math.floor(j/3)*240;
   const img=await sharp(frameCache[c.name][f]).resize(W*2,H*2,{kernel:'nearest'}).png().toBuffer();layers.push({input:img,left:x+69,top:y+30});
   layers.push({input:Buffer.from(`<svg width="426" height="28"><text x="20" y="23" font-family="sans-serif" font-size="16" fill="#e9dcff">${c.label}</text></svg>`),left:x,top:y});
  }
  await sharp({create:{width:1280,height:720,channels:4,background:'#171b29'}}).composite(layers).png().toFile(path.join(videoDir,`${String(seq++).padStart(4,'0')}.png`));
 }
 execFileSync('ffmpeg',['-y','-loglevel','error','-framerate',String(FPS),'-i',path.join(videoDir,'%04d.png'),'-c:v','libx264','-crf','17','-preset','medium','-pix_fmt','yuv420p','-movflags','+faststart',path.join(OUT,'draven-all-animations.mp4')]);
 fs.copyFileSync(path.join(videoDir,'0900.png'),path.join(OUT,'overview.png'));
 fs.writeFileSync(path.join(OUT,'README.md'),`# Draven complete animation preview\n\nNine clips: idle, run, attack, jump, fall, hit, sliding, dying, special. Frames are transparent PNGs at ${W*SCALE}×${H*SCALE}; manifest.json contains counts and timing. All clips play at 25 fps. The showcase is ${seq/FPS} seconds at 1280×720, with four seconds per action followed by a six-second overview.\n\nRun: node scripts/art/draven-pixel/animation-set.cjs\n\nThe idle reuses the grounded v3 render. Other actions use the original code-transcribed palette tiles, articulated sleeves, hidden joint coverage, cloth deformation and original-shape magic. Attack has anticipation, thrust and recovery; jump/fall include launch/landing staging; death ends in a held collapse; special adds preview-only ember particles. These are authored preview timings, not drop-in runtime animation metadata. Existing production assets and code are untouched. Separate game projectile/explosion atlases are outside this character-pose set.\n\nRendering checks all frames for canvas clipping and all looping clips for periodic endpoints.\n`);
 console.log(`Wrote ${seq/FPS}s showcase to ${OUT}`);
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={render,pose,CLIPS,W,H,SCALE};
