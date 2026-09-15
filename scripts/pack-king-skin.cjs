// Mechanical chroma-key import and nearest-neighbor atlas packing of generated art.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync: run } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'public/assets/ninja/skins/ninja-arena-sovereign');
const tmp = fs.mkdtempSync('/private/tmp/king-atlas-');
function read(name) {
const source = path.join(dir, name);
const info = JSON.parse(run('ffprobe', ['-v','quiet','-show_streams','-of','json',source])).streams[0];
const raw = run('ffmpeg', ['-v','error','-i',source,'-f','rawvideo','-pix_fmt','rgba','pipe:1'], {maxBuffer:32*1024*1024});
const {width: sw, height: sh} = info;
for(let i=0;i<raw.length;i+=4) {
  // Magenta is reserved for the source background, never used in the king palette.
  if(raw[i]>raw[i+1]+25 && raw[i+2]>raw[i+1]+25 && raw[i+2]>raw[i]*.75 && raw[i]>raw[i+2]*.75) raw.fill(0,i,i+4);
}
return {raw,sw,sh};
}
const original=read('ai-source.png'), actions=read('action-source.png');
const atlas = JSON.parse(fs.readFileSync(path.join(root,'public/assets/ninja/animations.json')));
const cell=72, gutter=16, stride=cell+gutter, width=8*stride, height=5*stride;
const pixels=Buffer.alloc(width*height*4);
function save(data,w,h,name) {
  const pam=path.join(tmp,'out.pam');
  fs.writeFileSync(pam,Buffer.concat([Buffer.from(`P7\nWIDTH ${w}\nHEIGHT ${h}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`),data]));
  run('cwebp',['-quiet','-lossless','-exact',pam,'-o',path.join(dir,name)]);
}

atlas.frames.forEach((frame,n)=>{
  const actionIndex=frame.filename.startsWith('falling')?Number(frame.filename.slice(-2)):frame.filename.startsWith('throw')?3+Number(frame.filename.slice(-2)):-1;
  const {raw,sw,sh}=actionIndex>=0?actions:original;
  const index=actionIndex>=0?actionIndex:n,cols=actionIndex>=0?4:6,rows=actionIndex>=0?2:6;
  const x0=Math.round(index%cols*sw/cols),x1=Math.round((index%cols+1)*sw/cols);
  const y0=Math.round(Math.floor(index/cols)*sh/rows),y1=Math.round((Math.floor(index/cols)+1)*sh/rows);
  let l=x1,r=x0,t=y1,b=y0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(raw[(y*sw+x)*4+3]){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
  if(l<=x0||r>=x1-1||t<=y0||b>=y1-1||r<l)throw Error(`Source pose crosses cell boundary: ${frame.filename}`);
  const scale=actionIndex>=0?.18:.34;
  const w=Math.round((r-l+1)*scale),h=Math.round((b-t+1)*scale);
  if(w>64||h>64)throw Error(`Pose exceeds safe frame area: ${frame.filename}`);
  const ox=n%8*stride+8,oy=Math.floor(n/8)*stride+8;
  const left=Math.floor((cell-w)/2),top=68-h;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const si=((t+Math.floor((y+.5)*(b-t+1)/h))*sw+l+Math.floor((x+.5)*(r-l+1)/w))*4;
    raw.copy(pixels,((oy+top+y)*width+ox+left+x)*4,si,si+4);
  }
  frame.frame={x:ox,y:oy,w:cell,h:cell};

});
atlas.meta={...atlas.meta,app:'Bro Battles padded king atlas',size:{w:width,h:height}};
save(pixels,width,height,'spritesheet.webp');
fs.writeFileSync(path.join(dir,'animations.json'),JSON.stringify(atlas,null,2)+'\n');
// Match the base ninja's 1000px body canvas, with boot soles on the last row.
// Crop the transparent margin on the pixel grid, then use integer scaling.
const portrait=read('portrait-source.png');
const portraitGrid=96, portraitSize=1000;
const gridPixels=Buffer.alloc(portraitGrid*portraitGrid*4);
let pl=portraitGrid,pr=-1,pt=portraitGrid,pb=-1;
for(let y=0;y<portraitGrid;y++)for(let x=0;x<portraitGrid;x++){
  const sx=Math.floor((x+.5)*portrait.sw/portraitGrid);
  const sy=Math.floor((y+.5)*portrait.sh/portraitGrid);
  const si=(sy*portrait.sw+sx)*4;
  portrait.raw.copy(gridPixels,(y*portraitGrid+x)*4,si,si+4);
  if(portrait.raw[si+3]){pl=Math.min(pl,x);pr=Math.max(pr,x);pt=Math.min(pt,y);pb=Math.max(pb,y);}
}
if(pr<pl||pb<pt)throw Error('Empty portrait');
const portraitScale=Math.floor(portraitSize/Math.max(pr-pl+1,pb-pt+1));
const pw=(pr-pl+1)*portraitScale,ph=(pb-pt+1)*portraitScale;
const px=Math.floor((portraitSize-pw)/2),py=portraitSize-ph;
const portraitPixels=Buffer.alloc(portraitSize*portraitSize*4);
for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){
  const si=((pt+Math.floor(y/portraitScale))*portraitGrid+pl+Math.floor(x/portraitScale))*4;
  gridPixels.copy(portraitPixels,((py+y)*portraitSize+px+x)*4,si,si+4);
}
save(portraitPixels,portraitSize,portraitSize,'body.webp');
// Same canvas dimensions as the base shuriken, preserving projectile scale/physics.
const crown=Buffer.alloc(237*237*4);
let l=actions.sw,r=0,t=actions.sh,b=0;
for(let y=Math.round(actions.sh/2);y<actions.sh;y++)for(let x=Math.round(actions.sw*3/4);x<actions.sw;x++){
  if(actions.raw[(y*actions.sw+x)*4+3]){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
}
const cw=217,ch=Math.round((b-t+1)*cw/(r-l+1));
for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
  const si=((t+Math.floor(y*(b-t+1)/ch))*actions.sw+l+Math.floor(x*(r-l+1)/cw))*4;
  actions.raw.copy(crown,((Math.floor((237-ch)/2)+y)*237+10+x)*4,si,si+4);
}
save(crown,237,237,'crown.webp');
fs.rmSync(tmp,{recursive:true});
console.log('Packed 34 isolated 72px frames with 16px gutters; nearest-neighbor, lossless output.');
