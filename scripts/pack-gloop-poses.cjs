// Overlay authored movement poses on both Gloop atlases; preserve logical cells.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../spritesheet-generator/node_modules/sharp');
const root=path.resolve(__dirname,'..');
async function main(){
  const source=path.join(root,'public/assets/gloop/movement-source.png');
  const {data,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if(!data.some((v,i)=>i%4===3&&v===0))throw Error('Movement artwork needs real alpha');
  for(const [row,folder] of ['','skins/gloop-amethyst'].entries()){
    const dir=path.join(root,'public/assets/gloop',folder);
    const atlas=JSON.parse(fs.readFileSync(path.join(dir,'animations.json')));
    const original=await sharp(path.join(dir,'spritesheet.webp')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const pixels=Buffer.from(original.data);
    const layers=[];
    for(let col=0;col<5;col++){
      // Preserve original base falling art and separately authored crystal falls.
      if(col<3) continue;
      // Authored gutters: the broader duck extends beyond an equal-width cell.
      const cuts=[0,410,810,1220,1650,1983];
      const x0=Math.round(cuts[col]*info.width/1983),x1=Math.round(cuts[col+1]*info.width/1983);
      const y0=Math.round(row*info.height/2),y1=Math.round((row+1)*info.height/2);
      let l=x1,t=y1,r=-1,b=-1;
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(data[(y*info.width+x)*4+3]>=128){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
      if(r<l)throw Error('Empty pose');
      const cellCol=5+col,cellX=cellCol*128,cellY=256;
      for(let y=cellY;y<cellY+128;y++)pixels.fill(0,(y*original.info.width+cellX)*4,(y*original.info.width+cellX+128)*4);
      // Compact bodies with a little vertical stretch as the fall settles.
      const sizes = row === 0
        ? [[39,36],[38,40],[39,38],[51,23],[39,34]]
        : [[41,34],[40,38],[41,36],[51,20],[39,31]];
      const [width,height]=sizes[col];
      const input=await sharp(source).extract({left:l,top:t,width:r-l+1,height:b-t+1})
        .resize(width,height,{fit:'fill',kernel:'nearest'}).png().toBuffer();
      const left=col===4?79-width:Math.floor((128-width)/2);
      layers.push({input,left:cellX+left,top:cellY+128-height});
      if(col>=3){
        // Explicit names avoid coordinate ambiguity; config cells are one-based.
        const entry=atlas.frames.find(f=>f.frame.x===cellX&&f.frame.y===cellY);
        entry.filename=col===3?'duck00':'wall00';
      }
    }
    const output=await sharp(pixels,{raw:original.info}).composite(layers).webp({lossless:true,effort:6}).toBuffer();
    fs.writeFileSync(path.join(dir,'spritesheet.webp'),output);
    fs.writeFileSync(path.join(dir,'animations.json'),JSON.stringify(atlas)+'\n');
  }
  console.log('Updated falling, duck and dedicated wall-slide poses for both Gloop skins.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
