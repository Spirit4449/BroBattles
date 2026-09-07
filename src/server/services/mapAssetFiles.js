const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const publicRoot=path.resolve(__dirname,'../../../public');
const assetDataRoot=()=>path.join(process.env.BB_MAP_DIR||path.resolve(__dirname,'../../../data/maps'),'assets');
const assetUrl=url=>typeof url==='string'&&/^\/assets\/[a-zA-Z0-9_./-]+$/.test(url)&&!url.includes('..');
function resolveAssetFile(url){
  if(!assetUrl(url))throw Error('Asset must use a local /assets/ path');
  for(const [prefix,folder]of [['/assets/map-editor-staged/','staged'],['/assets/map-revisions/','revisions']]){
    if(url.startsWith(prefix)){const name=url.slice(prefix.length);if(!/^[a-zA-Z0-9_-]+\.(webp|png|jpg|jpeg|json)$/.test(name))throw Error('Invalid asset filename');return path.join(assetDataRoot(),folder,name);}
  }
  return path.join(publicRoot,url.slice(1));
}
function stageUpload({targetUrl,fileName,base64}){
  const ext=path.extname(String(fileName)).toLowerCase();
  if(!['.webp','.png','.jpg','.jpeg'].includes(ext))throw Object.assign(Error('Choose a PNG, WebP or JPEG image'),{status:400});
  if(!assetUrl(targetUrl)||['/assets/map-editor-staged/','/assets/map-revisions/'].some(prefix=>targetUrl.startsWith(prefix)))throw Object.assign(Error('Choose a game asset path under /assets/'),{status:400});
  const bytes=Buffer.from(String(base64||''),'base64');if(!bytes.length||bytes.length>8*1024*1024)throw Object.assign(Error('Image must be smaller than 8 MB'),{status:400});
  const {imageSize}=require('./mapAssetValidation');let dimensions;try{dimensions=imageSize(bytes);}catch{throw Object.assign(Error('Choose a valid PNG, WebP or JPEG image'),{status:400});}if(dimensions.width<1||dimensions.height<1||dimensions.width>16384||dimensions.height>16384)throw Object.assign(Error('Image exceeds 16384 pixels'),{status:400});
  const name=randomUUID()+ext;const url='/assets/map-editor-staged/'+name;const file=resolveAssetFile(url);fs.mkdirSync(path.dirname(file),{recursive:true});
  const target=targetUrl.replace(/\.[a-zA-Z0-9]+$/,ext);
  fs.writeFileSync(file,bytes);fs.writeFileSync(file+'.json',JSON.stringify({targetUrl:target,originalUrl:targetUrl}));
  return {url,targetUrl:target,...dimensions};
}
function immutableAsset(url){
  if(url.startsWith('/assets/map-revisions/'))return url;
  const bytes=fs.readFileSync(resolveAssetFile(url));const hash=createHash('sha256').update(bytes).digest('hex');const result=`/assets/map-revisions/${hash}${path.extname(url)}`;const file=resolveAssetFile(result);fs.mkdirSync(path.dirname(file),{recursive:true});if(!fs.existsSync(file))fs.writeFileSync(file,bytes);return result;
}
function publishUploads(document,commit=doc=>doc){
  const doc=JSON.parse(JSON.stringify(document));const replacements=new Map();
  for(const map of Object.values(doc.variants))for(const asset of Object.values(map.assets))if(asset.url.startsWith('/assets/map-editor-staged/')){
    const stage=resolveAssetFile(asset.url),meta=JSON.parse(fs.readFileSync(stage+'.json','utf8'));
    if(!assetUrl(meta.targetUrl))throw Error('Invalid staged asset destination');
    replacements.set(meta.targetUrl,{stage,url:asset.url});
    asset.sourceUrl=meta.targetUrl;asset.url=immutableAsset(asset.url);delete asset.replaceTarget;
  }
  const backups=new Map();
  function replace(file,stage,root){
    const assetRoot=fs.realpathSync(path.join(root,'assets'));
    // Check the nearest existing parent before creating any directories.
    let parent=path.dirname(file);
    while(!fs.existsSync(parent))parent=path.dirname(parent);
    const realParent=fs.realpathSync(parent);
    if(realParent!==assetRoot&&!realParent.startsWith(assetRoot+path.sep))throw Error('Asset target escapes assets');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    backups.set(file,fs.existsSync(file)?fs.readFileSync(file):null);
    const temp=file+'.'+randomUUID()+'.tmp';
    try{fs.copyFileSync(stage,temp);fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  }
  try{
    for(const [target,{stage}]of replacements){
      const file=resolveAssetFile(target);
      if(fs.existsSync(file))immutableAsset(target);
      replace(file,stage,publicRoot);
      const distRoot=path.resolve(__dirname,'../../../dist');
      if(fs.existsSync(path.join(distRoot,'assets')))replace(path.join(distRoot,target.slice(1)),stage,distRoot);
    }
    return commit(doc);
  }catch(error){
    // An unsuccessful document save must not leave changed game artwork behind.
    for(const [file,bytes]of [...backups].reverse()){
      if(bytes===null){if(fs.existsSync(file))fs.unlinkSync(file);}
      else{const temp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,bytes);fs.renameSync(temp,file);}
    }
    throw error;
  }
}

function pinMapAssets(map){
  const copy=JSON.parse(JSON.stringify(map));
  for(const asset of Object.values(copy.assets)){
    asset.sourceUrl=asset.sourceUrl||asset.replaceTarget||asset.url;
    asset.url=immutableAsset(asset.url);
    if(asset.atlasURL)asset.atlasURL=immutableAsset(asset.atlasURL);
  }
  copy.background=immutableAsset(copy.background);
  return copy;
}
module.exports={resolveAssetFile,stageUpload,publishUploads,pinMapAssets,immutableAsset};
