#!/usr/bin/env node
// V2: one shared vertical transform, 50 frames / 25 fps. Logical artwork is
// drawn at 6x so its translation can advance in 1/6-art-pixel steps without
// filtering. Fire is regenerated each frame on a half-art-pixel grid.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const sharp=require('../../../spritesheet-generator/node_modules/sharp');
const {ROWS,PALETTE}=require('./parts.cjs');
const ROOT=path.resolve(__dirname,'../../..'),OUT=path.join(ROOT,'output/draven-pixel/v2');
const COUNT=50,FPS=25,SIZE=432,SCALE=6,TAU=Math.PI*2;
const colors={outline:[12,3,24],deep:[53,6,76],purple:[103,12,143],violet:[164,26,211],light:[222,70,249],pink:[248,142,255],red:[248,28,12],orange:[255,105,0],gold:[255,192,20],hot:[255,234,119]};
const raw=b=>sharp(b,{raw:{width:SIZE,height:SIZE,channels:4}});
function render(frame,fire=true){
 const t=((frame%COUNT)+COUNT)%COUNT/COUNT;
 const rise=Math.round(-9*(1-Math.cos(TAU*t))); // 0..-18 output pixels: 3 art pixels
 const b=Buffer.alloc(SIZE*SIZE*4);
 function rect(x,y,w,h,c){const x0=Math.round((x+4)*SCALE),y0=Math.round((y+4)*SCALE)+rise,x1=Math.round((x+w+4)*SCALE),y1=Math.round((y+h+4)*SCALE)+rise;
 for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++)if(xx>=0&&xx<SIZE&&yy>=0&&yy<SIZE){const j=(yy*SIZE+xx)*4;b.set(c,j);b[j+3]=255;}}
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){if(y<29&&x>=33)continue;const c=PALETTE[ROWS[y][x]];if(c)rect(x,y,1,1,c);}
 if(!fire)return b;
 // Three connected tongues rise from the staff bowl. Their centerlines bend
 // more toward their tips; the base remains locked to the grip/body transform.
 const phase=TAU*4*t;
 const tongues=[{x:42,y:29,h:18+1.5*Math.sin(phase),w:4.3,bend:1.7,lag:0},
 {x:40,y:28,h:12+1.8*Math.sin(phase+1.8),w:3.5,bend:-4.1,lag:1.6},
 {x:44,y:28,h:10+1.5*Math.sin(phase+3.7),w:2.8,bend:2.5,lag:3.2}];
 const W=128,grid=Array(W*W).fill(null);
 for(let gy=8;gy<60;gy++)for(let gx=64;gx<104;gx++){
  const x=(gx+.5)/2,y=(gy+.5)/2;let strength=-1,bestU=0;
  for(const a of tongues){const u=(a.y-y)/a.h;if(u<0||u>1)continue;
   const center=a.x+a.bend*u*u+1.35*Math.sin(phase-7*u+a.lag)*u;
   const width=a.w*Math.pow(1-u,.75)*(0.86+.14*Math.sin(phase-10*u+a.lag));
   const inside=1-Math.abs(x-center)/Math.max(.15,width);
   if(inside>strength){strength=inside;bestU=u;}}
  if(strength>0){let c=strength<.2?'deep':strength<.5?'purple':strength<.73?'violet':'light';
   // Advect highlights upward instead of rigidly moving flame chunks.
   if(strength>.58&&Math.sin(phase*2-19*bestU+gx*.32)>.60)c='pink';
   grid[gy*W+gx]=c;}
 }
 // One consistent half-pixel contour around the regenerated silhouette.
 for(let y=1;y<W-1;y++)for(let x=1;x<W-1;x++)if(!grid[y*W+x]&&[grid[y*W+x-1],grid[y*W+x+1],grid[(y-1)*W+x],grid[(y+1)*W+x]].some(Boolean))rect(x/2,y/2,.5,.5,colors.outline);
 for(let y=0;y<W;y++)for(let x=0;x<W;x++)if(grid[y*W+x])rect(x/2,y/2,.5,.5,colors[grid[y*W+x]]);
 // Red/orange heart retains the portrait's identifying staff gem coloration.
 for(let y=39;y<59;y++)for(let x=77;x<91;x++){
  const xx=(x+.5)/2,yy=(y+.5)/2,u=(29-yy)/9;
  const cx=42+.45*Math.sin(phase-u*5)*u;
  const width=2.5*Math.sin(Math.PI*Math.max(0,Math.min(1,u)))+.2;
  const q=Math.abs(xx-cx)/width;if(u>0&&u<1&&q<1){const c=q>.7?'red':q>.4?'orange':u>.62?'gold':'hot';rect(x/2,y/2,.5,.5,colors[c]);}
 }
 // Short rising embers fade through smaller clusters; no orbiting shards.
 for(let i=0;i<5;i++){const age=(t*4+i/5)%1;if(age>.9)continue;
  const x=37+(i%3)*5+.6*Math.sin(TAU*age+i),y=19-age*13-(i%2)*2;
  const w=age>.65?.5:1;rect(x,y,w,age>.65?1:1.5,colors[age>.65?'purple':'violet']);if(age<.55)rect(x,y,.5,.5,colors.pink);
 }
 return b;
}
async function main(){fs.mkdirSync(OUT,{recursive:true});const contact=[];
 for(let i=0;i<COUNT;i++){const b=render(i);await raw(b).png().toFile(path.join(OUT,`frame-${String(i).padStart(2,'0')}.png`));
 const big=await raw(b).resize(432,432,{kernel:'nearest'}).flatten({background:'#c6c9cd'}).png().toBuffer();await sharp(big).toFile(path.join(OUT,`preview-${String(i).padStart(2,'0')}.png`));
 if(i%6===0&&contact.length<8)contact.push({input:await raw(b).resize(324,324,{kernel:'nearest'}).flatten({background:'#c6c9cd'}).png().toBuffer(),left:(contact.length%4)*324,top:Math.floor(contact.length/4)*324});}
 await sharp({create:{width:1296,height:648,channels:4,background:'#c6c9cd'}}).composite(contact).png().toFile(path.join(OUT,'contact-sheet.png'));
 execFileSync('ffmpeg',['-y','-loglevel','error','-framerate',String(FPS),'-i',path.join(OUT,'preview-%02d.png'),'-vf','split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=none','-loop','0',path.join(OUT,'idle.gif')]);
 execFileSync('ffmpeg',['-y','-loglevel','error','-framerate',String(FPS),'-i',path.join(OUT,'preview-%02d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',path.join(OUT,'idle.mp4')]);
 const assert=require('node:assert/strict');assert(render(0).equals(render(COUNT)));
 // Body must be an identical rigid tile at each bob height, never shift sideways.
 const base=render(0,false);for(let i=0;i<COUNT;i++){const dy=Math.round(-9*(1-Math.cos(TAU*i/COUNT)));const b=render(i,false);for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){const sy=y-dy;if(sy>=0&&sy<SIZE)assert(b.subarray((y*SIZE+x)*4,(y*SIZE+x+1)*4).equals(base.subarray((sy*SIZE+x)*4,(sy*SIZE+x+1)*4)));}}
 fs.writeFileSync(path.join(OUT,'README.md'),'# Draven idle revision\n\n50 frames at 25 fps; 2-second loop. All anatomy, clothing, hands and staff share one vertical bob, with no horizontal displacement or phase offsets. 6x nearest-neighbor artwork allows 1/6 logical pixel translation while preserving crisp clusters. Fire is redrawn on a half-logical-pixel lattice, with four flicker cycles per body cycle, connected curling tongues, moving highlights, hot core and rising embers. The old eight-frame restriction is relaxed to satisfy the requested smooth motion.\n\nRun `node scripts/art/draven-pixel/revise-idle.cjs`. Outputs remain outside production. Periodicity and rigid synchronized body translation are asserted during generation.\n');
 console.log('Rendered 50 frames, 25 fps, 2-second loop; periodicity and synchronized vertical-only body checks pass.');}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={render,COUNT,FPS};
