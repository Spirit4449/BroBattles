const { imageSize } = require("./imageSize");
const { resolveAssetFile } = require("./mapAssetFiles");
const fs = require('node:fs');
const path = require('node:path');
const PUBLIC = path.resolve(__dirname,"../../../../public");
function validateAssets(document, publicRoot=PUBLIC, directory){
  // Cloud art is the game-wide library (clouds.json), checked by validate:content.
  const errors=[];const cache=new Map();
  function read(url){
    if(!url?.startsWith('/assets/')||url.includes('..'))throw Error('Asset URL must be under /assets/');
    const file=publicRoot===PUBLIC?resolveAssetFile(url, directory):path.resolve(publicRoot,'.'+url);
    if(!url.startsWith('/assets/map-editor-staged/')&&!url.startsWith('/assets/map-revisions/')&&!fs.realpathSync(file).startsWith(fs.realpathSync(path.join(publicRoot,'assets'))+path.sep))throw Error('Asset must stay inside public/assets');
    return fs.readFileSync(file);
  }
  const map=document;
  for(const[key,asset]of Object.entries(map.assets)){
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
    }catch(e){errors.push(`assets.${key}: ${e.code==='ENOENT'?'Asset file does not exist in public/assets':e.message}`);}
  }
  for(const layer of map.scenery?.layers||[])try{imageSize(read(layer.url));}catch(e){errors.push(`scenery.${layer.id}: ${e.code==='ENOENT'?'Image file does not exist':e.message}`);}
  return errors;
}
module.exports={validateAssets,imageSize};
