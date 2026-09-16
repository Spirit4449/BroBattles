// Pack the generated 10 x 4 sheet without painting or synthesizing artwork.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../spritesheet-generator/node_modules/sharp');
const dir = path.resolve(__dirname, '../public/assets/gloop/skins/gloop-amethyst');
async function main() {
  const source = path.join(dir, 'ai-source.png');
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (!data.some((value, index) => index % 4 === 3 && value === 0)) throw Error('Source must contain real transparency');
  const boxes = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 10; col++) {
    // The generated attack extensions lean into the nominal grid gutters.
    const attackCuts = [0,198,397,604,819,1030,1228,1426,1600,1800,1983];
    const x0 = Math.round(row === 3 ? attackCuts[col] * info.width / 1983 : col * info.width / 10);
    const x1 = Math.round(row === 3 ? attackCuts[col+1] * info.width / 1983 : (col + 1) * info.width / 10);
    const y0 = Math.round(row * info.height / 4), y1 = Math.round((row + 1) * info.height / 4);
    let l=x1,t=y1,r=-1,b=-1;
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) {
      if (data[(y*info.width+x)*4+3] < 128) continue;
      l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);
    }
    if(r<l) throw Error(`Empty frame ${row},${col}`);
    boxes.push({left:l,top:t,width:r-l+1,height:b-t+1});
  }
  // Match base Gloop's 47px idle width inside each 128px logical frame.
  const scale = 47 / boxes[0].width;
  const layers = [];
  const atlas = JSON.parse(fs.readFileSync(path.join(dir,'animations.json')));
  for (const {frame} of atlas.frames) {
    if(frame.h !== 128) continue; // Legacy unused 1px frames remain transparent.
    const index = frame.y / 128 * 10 + frame.x / 128;
    const box = boxes[index];
    const width = Math.round(box.width*scale), height = Math.round(box.height*scale);
    if(width>124 || height>126) throw Error('Frame exceeds safe bounds');
    const input = await sharp(source).extract(box).resize(width,height,{kernel:'nearest'}).png().toBuffer();
    layers.push({input,left:frame.x+Math.floor((128-width)/2),top:frame.y+128-height});
  }
  await sharp({create:{width:1280,height:513,channels:4,background:'#00000000'}})
    .composite(layers).webp({lossless:true,effort:6}).toFile(path.join(dir,'spritesheet.webp'));
  // Export directly from the source art, never upscale the tiny gameplay sprite.
  const box=boxes[0], gridWidth=64, gridHeight=Math.round(box.height*gridWidth/box.width);
  const width=gridWidth*12, height=gridHeight*12;
  const grid=await sharp(source).extract(box).resize(gridWidth,gridHeight,{kernel:'nearest'}).png().toBuffer();
  const portrait=await sharp(grid).resize(width,height,{kernel:'nearest'}).png().toBuffer();
  await sharp({create:{width:1000,height:1000,channels:4,background:'#00000000'}})
    .composite([{input:portrait,left:(1000-width)/2,top:1000-height}]).webp({lossless:true,effort:6})
    .toFile(path.join(dir,'body.webp'));
  console.log('Packed 1280x513 atlas, 128px frames, and bottom-aligned 1000x1000 portrait.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
