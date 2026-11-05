#!/usr/bin/env node
// Grounded idle: deform the intact drawing with a shared vertical motion field.
// No disconnected layer offsets, no sideways body shift, no replacement fire.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const sharp=require('../../../spritesheet-generator/node_modules/sharp');
const {ROWS,PALETTE}=require('./parts.cjs');
const ROOT=path.resolve(__dirname,'../../..'),OUT=path.join(ROOT,'output/draven-pixel/v3');
const COUNT=50,FPS=25,SIZE=432,SCALE=6,TAU=Math.PI*2;
const raw=b=>sharp(b,{raw:{width:SIZE,height:SIZE,channels:4}});
function render(frame,fire=true){
 const t=((frame%COUNT)+COUNT)%COUNT/COUNT;
 const rise=(1-Math.cos(TAU*t)); // 0..2 logical pixels
 const phase=TAU*3*t;
 const b=Buffer.alloc(SIZE*SIZE*4);
 for(let y=0;y<SIZE;y++){
  const dy=(y+.5)/SCALE-4;
  // Identical translation above waist. Continuous lower-body deformation,
  // ending at row 62 so the complete bottom outline remains planted.
  let sy=dy<42-rise?dy+rise:dy<62?42+(dy-42+rise)*20/(20+rise):dy;
  for(let x=0;x<SIZE;x++){
   let sx=(x+.5)/SCALE-4,fy=sy;
   const magic=fire&&sx>=33&&sy<29;
   if(magic){
    const row=Math.floor(sy);
    const weight=Math.max(0,Math.min(1,(29-row)/16));
    // A small flowing distortion of the original silhouette. The offset
    // vanishes at phase zero and the root, preserving attachment and identity.
    sx-=Math.round(SCALE*.32*weight*(Math.sin(phase+(29-row)*.42)-Math.sin((29-row)*.42)))/SCALE;
   }
   const ix=Math.floor(sx),iy=Math.floor(fy);
   let ch=ROWS[iy]?.[ix];if(!ch||ch==='.')continue;
   if(magic){
    // Sparse traveling accents within existing purple material. Never recolor
    // the black contour, central red gem, or body/clothing.
    const wave=Math.sin(phase*2+iy*.9+ix*.55)*Math.sin(phase/2)**2;
    if(wave>.86&&ch==='O')ch='b';
    else if(wave>.72&&ch==='E')ch='M';
    else if(wave<-.88&&ch==='b')ch='O';
   }
   const j=(y*SIZE+x)*4;b.set(PALETTE[ch],j);b[j+3]=255;
  }
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
 const assert=require('node:assert/strict');
 assert(render(0).equals(render(COUNT)), 'loop endpoint');
 const rest=render(0,false);
 for(let i=0;i<COUNT;i++){
  const b=render(i,false);
  // Grounded hem and staff tip: bottom two logical rows never change.
  assert(b.subarray(66*SCALE*SIZE*4).equals(rest.subarray(66*SCALE*SIZE*4)), 'ground moves');
  for(let p=3;p<b.length;p+=4)assert(b[p]===0||b[p]===255);
 }
 fs.writeFileSync(path.join(OUT,'README.md'), '# Draven grounded idle\n\n50 frames at 25 fps, two-second loop. Original palette drawing retained. Hood, torso, sleeves, hands and staff head share the same two-logical-pixel vertical breath. Lower robe and staff shaft stretch smoothly toward a stationary hem/tip. No horizontal body displacement. Flame silhouettes are sampled from the original drawing with a small continuous ripple and moving palette highlights; the original hooked purple shape, separate fragments and red core are preserved. Three flame cycles per breath. Rendered on a 6x grid for crisp 1/6-logical-pixel motion, without blur or interpolation.\n\nRun `node scripts/art/draven-pixel/grounded-idle.cjs`. All outputs are previews only. Ground registration, binary alpha and periodic endpoint checks pass.\n');
 console.log('V3: original drawing, grounded synchronized breath; 50 frames / 25 fps. Endpoint, alpha and ground checks pass.');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={render,COUNT,FPS};
