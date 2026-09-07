const fs = require('node:fs');
const path = require('node:path');
const PUBLIC = path.resolve(__dirname,'../../../public');
function imageSize(buffer) {
  if(buffer.toString('ascii',1,4)==='PNG') return {width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)};
  if(buffer.toString('ascii',8,12)==='WEBP'){
    const kind=buffer.toString('ascii',12,16);
    if(kind==='VP8X')return {width:1+buffer.readUIntLE(24,3),height:1+buffer.readUIntLE(27,3)};
    if(kind==='VP8 ')return {width:buffer.readUInt16LE(26)&0x3fff,height:buffer.readUInt16LE(28)&0x3fff};
    if(kind==='VP8L'){const bits=buffer.readUInt32LE(21);return {width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};}
  }
  if(buffer[0]===0xff&&buffer[1]===0xd8){let i=2;while(i+9<buffer.length){if(buffer[i]!==0xff)break;const marker=buffer[i+1],length=buffer.readUInt16BE(i+2);if([0xc0,0xc1,0xc2].includes(marker))return {height:buffer.readUInt16BE(i+5),width:buffer.readUInt16BE(i+7)};i+=length+2;}}
  throw Error('Use PNG, WebP or JPEG images');
}
function validateAssets(document, publicRoot=PUBLIC){
  const errors=[];const cache=new Map();
  function read(url){
    if(!url?.startsWith('/assets/')||url.includes('..'))throw Error('Asset URL must be under /assets/');
    const file=publicRoot===PUBLIC?require('./mapAssetFiles').resolveAssetFile(url):path.resolve(publicRoot,'.'+url);
    if(!url.startsWith('/assets/map-editor-staged/')&&!url.startsWith('/assets/map-revisions/')&&!fs.realpathSync(file).startsWith(fs.realpathSync(path.join(publicRoot,'assets'))+path.sep))throw Error('Asset must stay inside public/assets');
    return fs.readFileSync(file);
  }
  for(const[variant,map]of Object.entries(document.variants))for(const[key,asset]of Object.entries(map.assets)){
    try{
      const cacheKey=JSON.stringify([asset,map.textureSizes[key]]);if(cache.has(cacheKey))continue;
      const dimensions=imageSize(read(asset.url));const expected=map.textureSizes[key];
      if(asset.type==='image'&&(dimensions.width!==expected.width||dimensions.height!==expected.height))throw Error(`Image is ${dimensions.width}×${dimensions.height}; textureSizes must match`);
      if(asset.type==='spritesheet'){
        const frame=asset.frameConfig;if(frame.frameWidth!==expected.width||frame.frameHeight!==expected.height)throw Error('Spritesheet frame dimensions must match textureSizes');
        const total=Math.floor(dimensions.width/frame.frameWidth)*Math.floor(dimensions.height/frame.frameHeight);
        if(!total)throw Error('Spritesheet is smaller than its frame');
        for(const f of asset.animation?.frames||[])if(!Number.isInteger(f)||f<0||f>=total)throw Error(`Unknown spritesheet frame ${f}`);
      }
      if(asset.type==='atlas'){
        const atlas=JSON.parse(read(asset.atlasURL));const frames=Array.isArray(atlas.frames)?Object.fromEntries(atlas.frames.map(f=>[f.filename,f])):atlas.frames;
        if(!frames||!Object.keys(frames).length)throw Error('Atlas has no frames');
        for(const f of Object.values(frames))if(f.trimmed||f.rotated||f.frame?.w!==expected.width||f.frame?.h!==expected.height)throw Error('Atlas frames must be untrimmed, unrotated and match textureSizes');
        for(const f of asset.animation?.frames||[])if(!frames[f])throw Error(`Unknown atlas frame ${f}`);
      }
      cache.set(cacheKey,true);
    }catch(e){errors.push(`${variant}.assets.${key}: ${e.code==='ENOENT'?'Asset file does not exist in public/assets':e.message}`);}
  }
  for(const [variant,map]of Object.entries(document.variants))try{imageSize(read(map.background));}catch(e){errors.push(`${variant}.background: ${e.code==='ENOENT'?'Image file does not exist':e.message}`);}
  return errors;
}
module.exports={validateAssets,imageSize};
