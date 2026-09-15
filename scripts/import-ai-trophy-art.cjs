// Imports AI-produced artwork; only crops, scales and packs pixels. No repainting.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync: run } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sources = process.argv[2];
if (!sources) throw new Error('Pass the generated image directory');
const jobs = [
  ['exec-4a632189-3886-4c10-aad9-0f11757b799f.png', 'player-cards/arena-crown'],
  ['exec-5801e1b1-9a40-4d46-ae0f-44ed4a70d680.png', 'player-cards/slime-circuit'],
  // King uses its revised source and padded atlas: scripts/pack-king-skin.cjs.
  ['exec-5b36a2c3-35e0-4d7c-9db8-9bc20b2cb253.png', 'gloop/skins/gloop-amethyst'],
];
const tmp = fs.mkdtempSync('/private/tmp/ai-trophy-import-');
function read(file) {
  run('cwebp', ['-quiet', '-lossless', file, '-o', `${tmp}/input.webp`]);
  run('dwebp', ['-quiet', '-pam', `${tmp}/input.webp`, '-o', `${tmp}/input.pam`]);
  const b = fs.readFileSync(`${tmp}/input.pam`), end = b.indexOf('ENDHDR\n');
  const head = b.subarray(0, end).toString();
  return { w: +head.match(/WIDTH (\d+)/)[1], h: +head.match(/HEIGHT (\d+)/)[1], data: b.subarray(end + 7) };
}
function blank(w, h) { return { w, h, data: Buffer.alloc(w*h*4) }; }
function save(im, file) {
  fs.writeFileSync(`${tmp}/out.pam`, Buffer.concat([Buffer.from(`P7\nWIDTH ${im.w}\nHEIGHT ${im.h}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`), im.data]));
  run('cwebp', ['-quiet', '-lossless', '-exact', `${tmp}/out.pam`, '-o', file]);
}
function bounds(im, x, y, w, h) {
  let l=x+w,t=y+h,r=x,b=y;
  for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++) {
    if(im.data[(yy*im.w+xx)*4+3]<128)continue;
    l=Math.min(l,xx);r=Math.max(r,xx);t=Math.min(t,yy);b=Math.max(b,yy);
  }
  if(r<l||b<t)throw new Error('Empty generated frame');
  return {x:l,y:t,w:r-l+1,h:b-t+1};
}
function paste(src, box, dst, x, y, w, h) {
  for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++) {
    const i=((box.y+Math.floor(yy*box.h/h))*src.w+box.x+Math.floor(xx*box.w/w))*4;
    src.data.copy(dst.data,((y+yy)*dst.w+x+xx)*4,i,i+4);
  }
}
for(const [name,target] of jobs) {
  const dir=path.join(root,'public/assets',target);
  const card=target.startsWith('player-cards');
  fs.mkdirSync(card?path.dirname(dir):dir,{recursive:true});
  const sourceFile=card?`${dir}-ai-source.png`:path.join(dir,'ai-source.png');
  fs.copyFileSync(path.join(sources,name),sourceFile);
  const src=read(sourceFile);
  if(card) { save(src,`${dir}.webp`); continue; }
  const ninja=target.startsWith('ninja'), cell=ninja?72:128, cols=ninja?8:10;
  const sheet=blank(ninja?576:1280,ninja?648:512);
  const rows=ninja?[0,182,351,518,686,855]:[0,220,410,605,793];
  for(let row=0;row<rows.length-1;row++)for(let col=0;col<(ninja?(row===4?2:8):(row===0?8:10));col++) {
    const x=Math.round(col*src.w/cols), end=Math.round((col+1)*src.w/cols);
    const box=bounds(src,x,rows[row],end-x,rows[row+1]-rows[row]);
    const scale=ninja?Math.min(.38,66/box.w,66/box.h):Math.min(.46,104/box.w,104/box.h);
    const w=Math.round(box.w*scale),h=Math.round(box.h*scale);
    paste(src,box,sheet,col*cell+Math.floor((cell-w)/2),(row+1)*cell-h-2,w,h);
  }
  save(sheet,path.join(dir,'spritesheet.webp'));
  const box=bounds(sheet,0,0,cell,cell),body=blank(1000,1000);
  const scale=Math.floor(820/Math.max(box.w,box.h)),w=box.w*scale,h=box.h*scale;
  paste(sheet,box,body,Math.floor((1000-w)/2),Math.floor((1000-h)/2),w,h);
  save(body,path.join(dir,'body.webp'));
}
console.log('Imported AI cards, packed animation frames, and matching idle portraits.');
