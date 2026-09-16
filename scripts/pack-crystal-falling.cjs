// Pack regenerated airborne art at one shared scale, preserving authored stretch.
const fs=require('node:fs');
const path=require('node:path');
const sharp=require('../spritesheet-generator/node_modules/sharp');
async function main(){
  const dir=path.resolve(__dirname,'../public/assets/gloop/skins/gloop-amethyst');
  const source=path.join(dir,'falling-source.png');
  const {data,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if(!data.some((v,i)=>i%4===3&&v===0))throw Error('Expected transparent source');
  const boxes=[];
  for(let col=0;col<3;col++){
    const x0=Math.round(col*info.width/3),x1=Math.round((col+1)*info.width/3);
    let l=x1,t=info.height,r=-1,b=-1;
    for(let y=0;y<info.height;y++)for(let x=x0;x<x1;x++)if(data[(y*info.width+x)*4+3]>=128){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
    if(r<l)throw Error('Empty falling pose');
    boxes.push({left:l,top:t,width:r-l+1,height:b-t+1});
  }
  const sheet=await sharp(path.join(dir,'spritesheet.webp')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let y=256;y<384;y++)sheet.data.fill(0,(y*sheet.info.width+640)*4,(y*sheet.info.width+1024)*4);
  const layers=[],scale=38/boxes[0].width;
  for(const [i,box] of boxes.entries()){
    const width=Math.round(box.width*scale),height=Math.round(box.height*scale);
    const input=await sharp(source).extract(box).resize(width,height,{kernel:'nearest'}).png().toBuffer();
    layers.push({input,left:640+i*128+Math.floor((128-width)/2),top:384-height});
    console.log(`fall0${i}: ${width}x${height}`);
  }
  const packed=await sharp(sheet.data,{raw:sheet.info}).composite(layers).webp({lossless:true,effort:6}).toBuffer();
  fs.writeFileSync(path.join(dir,'spritesheet.webp'),packed);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
