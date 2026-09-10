import Phaser from 'phaser/dist/phaser-arcade-physics.min.js';
import './mapEditor.css';
import { preloadMapDocument, buildMapDocument, syncMapDocument } from '../maps/documentRuntime';
import { clone, VARIANTS, POWERUP_TYPES, MapHistory, validateDocument, validateMap, geometryFromMap, resolvePowerupPoints } from '../shared/mapDocument';
import { resolveLanding } from '../shared/spawnPlacement';
import { allRows, snapMove, resizeRow, resizeCollision, removeRows, exportDocument, replaceAssetReferences } from './editorModel';
const $ = id => document.getElementById(id);
let documentData, revision, savedJSON, history, game, scene, mapList = [], selectedId = null, activeTab = 'selection', variant = '1v1', preview = false, busy = false;
const friendlyName=value=>String(value).replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
let guidelines=[], keyboard=new Set(), drag=null, sceneReady=null, playtestSession=null, playtestFrame=null, selectedIds=new Set(), handleMode='artwork';
const map = () => documentData?.variants[variant];
const selected = () => allRows(map()).find(r=>r.id===selectedId);
const size = () => Number(variant[0]);
const status = text => { $('status').textContent=text; };
const uid = prefix => `${prefix}-${crypto.randomUUID().slice(0,8)}`;
const dirty = () => documentData && JSON.stringify(documentData)!==savedJSON;
const setBusy = value => {busy=value;for(const id of ['save','map-select','variant','import','new-map','preview','infinite-supers','add','copy-variant']) $(id).disabled=value;};
async function request(url, options={}) {
  const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  let result;try{result=await response.json();}catch{throw Error(`Request failed (${response.status})`);}
  if(!response.ok)throw Error([result.error,...(result.errors||[]).slice(0,8)].join('\n'));
  return result;
}
function error(e){status(e.message);showDialog('Unable to complete this edit',node('p',e.message),null,'Close');}
function node(tag,text,attrs={}){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);return el;}
function persistDraft(){try{localStorage.setItem(`bb-map-draft-${documentData.id}`,JSON.stringify({revision,document:documentData}));}catch{status('Draft storage is full. Save or export to keep your edits.');}}
function refreshSave(){ $('save-state').textContent=dirty()?'● Unsaved changes':'✓ Saved';$('undo').disabled=!history || history.index===0;$('redo').disabled=!history || history.index===history.stack.length-1; }
function commit(message='Edit applied') {history.commit(documentData);persistDraft();refreshSave();renderBrowser();renderInspector();status(message);}
function transaction(fn,message){if(busy)return;const before=clone(documentData);try{fn();const errors=validateMap(map());if(errors.length)throw Error(errors.slice(0,6).join('\n'));scene?.rebuild();commit(message);}catch(e){documentData=before;scene?.rebuild();renderBrowser();renderInspector();error(e);}}
function showDialog(title,content,onApply,label='Apply'){
  const dialog=$('dialog');$('dialog-title').textContent=title;$('dialog-content').replaceChildren(content);$('dialog-apply').textContent=label;
  $('dialog-apply').onclick=async ev=>{if(!onApply)return;ev.preventDefault();try{await onApply();dialog.close();}catch(e){let errors=$('dialog-content').querySelector('.errors');if(!errors){errors=node('div','',{class:'errors'});$('dialog-content').prepend(errors);}errors.textContent=e.message;}};
  if(!dialog.open)dialog.showModal();keyboard.clear();
}
function advanced(parent,title='Advanced'){const details=node('details',undefined,{class:'section advanced'});details.append(node('summary',title));parent.append(details);return details;}
function section(title){const e=node('section',undefined,{class:'section'});e.append(node('div',title,{class:'section-title'}));return e;}
function field(parent,label,value,onChange,{type,options,min,max,step,full=false,disabled=false}={}){
  const wrap=node('label',undefined,{class:`field${full?' full':''}`});wrap.append(node('span',label));let input;
  if(options){input=node('select');for(const option of options){const [val,title]=Array.isArray(option)?option:[option,option];const el=node('option',String(title),{value:val});input.append(el);}input.value=String(value??'');}
  else {input=node('input',undefined,{type:type||(typeof value==='number'?'number':'text')});input.value=typeof value==='number'?Math.round(value):value??'';if(input.type==='number')input.step=step||'1';}
  if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;input.disabled=disabled;
  input.addEventListener('change',event=>{const v=input.type==='number'?Math.round(Number(input.value)):input.value;if(input.type==='number'&&(!input.value.trim()||!Number.isFinite(v))){input.value=value;return;}onChange(v,event);});
  wrap.append(input);parent.append(wrap);return input;
}
function check(parent,label,value,onChange){const wrap=node('label',undefined,{class:'check'});const input=node('input',undefined,{type:'checkbox'});input.checked=!!value;input.onchange=()=>onChange(input.checked);wrap.append(input,node('span',label));parent.append(wrap);}
function button(parent,title,callback,cls=''){const b=node('button',title,{type:'button',class:cls});b.onclick=callback;parent.append(b);return b;}
function editValue(object,key,value){transaction(()=>{object[key]=value;},`${key} updated`);}
function renderBrowser(){if(!map())return;const list=$('object-list');list.replaceChildren();let last='';const q=$('search').value.toLowerCase();const rows=allRows(map()).filter(r=>(r.kind!=='spawn'||$('all-spawns').checked||r.size===String(size()))&&`${r.id} ${r.value.label||''} ${r.value.textureKey||r.kind}`.toLowerCase().includes(q));
  $('object-count').textContent=rows.length;
  for(const r of rows){const group=({platform:'Platforms',hitbox:'Collision boxes',spawn:'Player spawns',powerup:'Powerups',vault:'Vaults',respawn:'Respawn references',objective:'Objectives',gold:'Gold spawns'})[r.kind];if(group!==last){list.append(node('div',group,{class:'group-label'}));last=group;}
    const b=node('button',undefined,{class:`object-row${selectedIds.has(r.id)?' active':''}`,type:'button',title:r.id});b.append(node('span',({platform:'▰',hitbox:'▧',spawn:'⚑',powerup:'✦'})[r.kind]||'◇',{class:'object-icon'}),node('span',r.value.label|| (r.kind==='spawn'?`${r.team==='team1'?'Blue':'Red'} · Spawn ${r.index+1}${$('all-spawns').checked?' ('+r.size+'v'+r.size+')':''}`:r.id)));b.onclick=event=>select(r.id,event.shiftKey);b.ondblclick=()=>scene?.focusRow(r);list.append(b);
  }
}
function select(id,additive=false){if(!additive)selectedIds.clear();if(id){if(additive&&selectedIds.has(id))selectedIds.delete(id);else selectedIds.add(id);}selectedId=selectedIds.has(id)?id:[...selectedIds].at(-1)||null;activeTab='selection';renderBrowser();renderInspector();}
function recursiveFields(parent,obj,path='',depth=0){
  if(depth>8)return;
  for(const [key,value]of Object.entries(obj)){
    if(value===null||value===undefined)continue;
    if(obj===documentData.metadata&&['id','label'].includes(key))continue;
    if(typeof value==='object') {const group=section(key);parent.append(group);recursiveFields(group,value,`${path}.${key}`,depth+1);}
    else if(key==='musicVolume')field(parent,'Music volume (%)',value*100,v=>editValue(obj,key,v/100));
    else if(typeof value==='boolean')check(parent,key,value,v=>editValue(obj,key,v));
    else if(key==='turnSpeed')field(parent,'Turn speed (%)',value*100,v=>editValue(obj,key,v/100));
    else field(parent,key,value,v=>editValue(obj,key,v));
  }
}
function renderInspector(){if(!map())return;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===activeTab));const panel=$('inspector-content');panel.replaceChildren();
  if(activeTab==='world'){
    panel.append(node('h3',`${documentData.label} · ${variant}`));field(panel,'Map name',documentData.label,v=>transaction(()=>{documentData.label=v;documentData.metadata.label=v;}));
    const world=section('World bounds');panel.append(world);const grid=node('div',undefined,{class:'fields'});world.append(grid);for(const k of ['x','y','width','height'])field(grid,k,map().bounds.world[k],v=>editValue(map().bounds.world,k,v));
    button(world,'Match camera to world',()=>transaction(()=>{Object.assign(map().bounds.camera,map().bounds.world);},'Camera bounds updated'));
    const cam=advanced(panel,'Camera');for(const[k,v]of Object.entries(map().bounds.camera))field(cam,k==='zoom'?'Zoom (%)':k,k==='zoom'?v*100:v,n=>editValue(map().bounds.camera,k,k==='zoom'?n/100:n));
    const powerups=section('Powerup rules');panel.append(powerups);for(const [k,label] of [['spawnIntervalMs','Spawn interval (ms)'],['maxActive','Maximum active'],['despawnMs','Lifetime (ms)']])field(powerups,label,map().powerups[k],v=>editValue(map().powerups,k,v));const powerupAdvanced=advanced(powerups);for(const [k,label] of [['pickupRadius','Pickup radius (px)'],['omenMs','Spawn warning (ms)'],['spawnLift','Legacy anchored spawn lift (px)']])field(powerupAdvanced,label,map().powerups[k],v=>editValue(map().powerups,k,v));
    for(const type of POWERUP_TYPES)check(powerups,type,map().powerups.types.includes(type),v=>transaction(()=>{map().powerups.types=v?[...map().powerups.types,type]:map().powerups.types.filter(t=>t!==type);}));
    const appearance=section('Presentation');panel.append(appearance);field(appearance,'Background image',map().background,v=>{transaction(()=>{map().background=v;});syncHistoryScene().catch(error);});
    const meta=advanced(panel,'Map catalog settings');recursiveFields(meta,documentData.metadata);
    if(map().objectiveLayout.bankBust){const extra=section('Objective world settings');panel.append(extra);recursiveFields(extra,map().objectiveLayout.bankBust.world);}
    return;
  }
  if(activeTab==='assets'){
    panel.append(node('h3','Platform artwork'),node('p','Place artwork on the map, or drop an image onto a card to replace every matching platform.'));button(panel,'＋ New platform artwork',()=>assetDialog());
    for(const[key,asset]of Object.entries(map().assets)){
      const row=node('div',undefined,{class:'asset-row'});
      const preview=node('div',undefined,{class:'asset-preview'});preview.append(node('img',undefined,{src:asset.url,alt:friendlyName(key)}));
      const info=node('div',undefined,{class:'asset-info'});info.append(node('strong',friendlyName(key)),node('small',`${asset.type==='image'?'Still image':'Animated'} · ${map().textureSizes[key]?.width} × ${map().textureSizes[key]?.height} px`));
      const actions=node('div',undefined,{class:'asset-actions'});
      button(actions,'Place platform',()=>addObject('platform',key),'asset-place');button(actions,'Edit artwork',()=>assetDialog(key));
      const upload=node('input',undefined,{type:'file',accept:'image/png,image/webp,image/jpeg',hidden:''});upload.onchange=()=>replaceArtwork(key,upload.files[0]);
      button(actions,'Replace image…',()=>upload.click());row.append(preview,info,actions,upload);row.ondragover=event=>{event.preventDefault();row.classList.add('drop-target');};row.ondragleave=()=>row.classList.remove('drop-target');row.ondrop=event=>{event.preventDefault();row.classList.remove('drop-target');replaceArtwork(key,event.dataTransfer.files[0]);};panel.append(row);
    }return;
  }
  if(selectedIds.size>1){panel.append(node('h3',`${selectedIds.size} objects selected`),node('p','Drag to move together. Shift-click toggles selection.'));button(panel,'Duplicate selection',duplicate);button(panel,'Delete selection',remove,'danger');return;}
  const row=selected();if(!row){panel.append(node('h3','Select an object'),node('p','Click a platform, marker, or object in the browser to edit its properties.'),node('div','Drag a corner to resize. Hold Shift to resize freely. Tab switches artwork/collision handles. Spawn markers always attach to a safe platform, even with snapping disabled.',{class:'notice'}));return;}
  const p=row.value;panel.append(node('h3',p.label||row.id),node('div',`${row.kind} · ${row.id}`,{class:'muted'}));
  if(!['spawn','vault','respawn'].includes(row.kind))field(panel,'Label',p.label||'',v=>editValue(p,'label',v));
  if(row.kind==='spawn'){
    panel.append(node('p','Anchored to a walkable collision surface. Move the platform and this marker follows.'));
    const geom=geometryFromMap(map());const surfaces=geom.colliders.filter(c=>c.collision.up);
    field(panel,'Platform',p.anchorId,v=>transaction(()=>{p.anchorId=v;p.dx=0;delete p.x;delete p.y;}),{options:surfaces.map(c=>[c.id,c.id])});
    field(panel,'Horizontal offset',p.dx??0,v=>transaction(()=>{p.dx=v;delete p.x;delete p.y;}));
    if(row.kind==='spawn')field(advanced(panel),'Drop height',p.dropHeight??180,v=>editValue(p,'dropHeight',v),{min:0,max:320});
    button(panel,'Playtest from here',()=>setPreview(true,row));
  }else{
    const grid=node('div',undefined,{class:'fields'});panel.append(grid);for(const k of ['x','y'])field(grid,k.toUpperCase(),mapPoint(row)[k],v=>transaction(()=>{if(row.kind==='powerup'){Object.assign(p,mapPoint(row));delete p.anchorId;delete p.dx;}p[k]=v;}));
    if(row.kind==='powerup'){field(panel,'Powerup type',p.type||'',v=>transaction(()=>{if(v)p.type=v;else delete p.type;}),{options:[['','Random available type'],...POWERUP_TYPES]});check(panel,'Enabled',p.enabled!==false,v=>editValue(p,'enabled',v));panel.append(node('p','Place this powerup anywhere in the world.'));}
    if(row.kind==='platform'){
      field(panel,'Texture',p.textureKey,v=>transaction(()=>{p.textureKey=v;delete p.frame;}),{options:Object.keys(map().assets)});
      const transform=section('Visual size');panel.append(transform);const dims=map().textureSizes[p.textureKey];
      for(const[axis,key]of [['width','scaleX'],['height','scaleY']])field(transform,axis,Math.round(dims[axis]*p[key]*100)/100,(v,event)=>transaction(()=>{const ratio=v/(dims[axis]*p[key]);const axes=event.shiftKey?[axis]:['width','height'];for(const dimension of axes){const scale=dimension==='width'?'scaleX':'scaleY';p[scale]=Math.round(dims[dimension]*p[scale]*ratio)/dims[dimension];if(p.body?.[dimension])p.body[dimension]=Math.max(1,Math.round(p.body[dimension]*ratio));}}),{min:1});
      const more=advanced(transform);
      if(map().assets[p.textureKey].type!=='image')field(more,'Frame',p.frame??'',v=>transaction(()=>{if(v!=='')p.frame=map().assets[p.textureKey].type==='spritesheet'?Number(v):v;else delete p.frame;}));
      field(more,'Depth',p.depth??0,v=>editValue(p,'depth',v));field(more,'Opacity (%)',Math.round((p.alpha??1)*100),v=>editValue(p,'alpha',v/100),{min:0,max:100});
      check(transform,'Flip horizontally',p.flipX,v=>editValue(p,'flipX',v));check(transform,'Flip vertically',p.flipY,v=>editValue(p,'flipY',v));
      const toggle=button(panel,handleMode==='artwork'?'Artwork handles · Tab for collision':'Collision handles · Tab for artwork',()=>{handleMode=handleMode==='artwork'?'collision':'artwork';renderInspector();});toggle.classList.add(handleMode==='collision'?'collision-mode':'artwork-mode');
      const body=advanced(panel,'Collision details');const b=p.body||{};
      for(const k of ['width','height','offsetX','offsetY'])field(body,k,b[k]??(/width|height/.test(k)?dims[k]*p[k==='width'?'scaleX':'scaleY']:0),v=>transaction(()=>{if(!p.body)p.body={};p.body[k]=v;}));
      body.append(node('div','Width/height are world pixels. Offsets are unscaled texture pixels.',{class:'muted'}));
    }else for(const[key,value]of Object.entries(p))if(row.kind!=='powerup'&&!['x','y','id','type','label','collision','collisionEnabled'].includes(key)&&typeof value!=='object')field(panel,key==='turnSpeed'?'Turn speed (%)':key,key==='turnSpeed'?value*100:value,v=>editValue(p,key,key==='turnSpeed'?v/100:v));
    if(['platform','hitbox'].includes(row.kind)){
      const collision=advanced(panel,'Collision behavior');check(collision,'Enabled',p.collisionEnabled!==false,v=>editValue(p,'collisionEnabled',v));
      for(const side of ['up','down','left','right'])check(collision,({up:'Land on top',down:'Block from below',left:'Block left side',right:'Block right side'})[side],p.collision?.[side]!==false,v=>transaction(()=>{if(!p.collision)p.collision={up:true,down:true,left:true,right:true};p.collision[side]=v;}));
    }
  }
  const actions=node('div',undefined,{class:'row-actions'});panel.append(actions);
  if(!['spawn','vault','respawn'].includes(row.kind)){button(actions,'Duplicate',duplicate);button(actions,'Delete',remove,'danger');}
}
async function uploadArtwork(file,targetUrl){
  const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Unable to read image'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});
  return request('/api/admin/maps/upload',{method:'POST',body:JSON.stringify({targetUrl,fileName:file.name,base64})});
}
async function replaceArtwork(key,file){
  if(!file||busy)return;
  const before=clone(documentData);setBusy(true);
  try{
    const original=map().assets[key],target=original.sourceUrl||original.replaceTarget||original.url;
    const upload=await uploadArtwork(file,target);
    replaceAssetReferences(documentData,original,upload);
    const errors=validateDocument(documentData);if(errors.length)throw Error(errors.slice(0,5).join('\n'));
    commit('Artwork replaced in every matching platform. Save writes the image into the game files.');await syncHistoryScene();
  }catch(e){documentData=before;error(e);}finally{setBusy(false);}
}
function assetDialog(key=null){
  if(busy)return;
  const current=map().assets[key];
  const values={key:key||uid('platform'),type:current?.type||'image',url:current?.url||'/assets/maps/platform.png',atlasURL:current?.atlasURL||'',width:map().textureSizes[key]?.width||64,height:map().textureSizes[key]?.height||64,frames:current?.animation?.frames?.join(',')||'',fps:current?.animation?.frameRate||12};
  const content=node('div');
  function form(){
    content.replaceChildren();
    field(content,'Artwork',values.type==='image'?'image':'animated',v=>{values.type=v==='image'?'image':'spritesheet';form();},{options:[['image','Still image'],['animated','Animated platform']]});
    field(content,values.type==='image'?'Image URL':'Sprite image URL',values.url,v=>values.url=v);
    if(values.type!=='image'){
      const explained=node('p','An animation uses one image containing many frames. If your export includes a JSON file describing those frames, choose “Image + JSON”.');content.append(explained);
      field(content,'Animation files',values.type,v=>{values.type=v;form();},{options:[['spritesheet','One image, equal-sized frames'],['atlas','Image + JSON frame file']]});
      if(values.type==='atlas')field(content,'Frame JSON URL',values.atlasURL,v=>values.atlasURL=v);
      for(const k of ['width','height'])field(content,`Each frame ${k} (px)`,values[k],v=>values[k]=v,{min:1});
      field(content,values.type==='atlas'?'Frame names (comma separated)':'Frame numbers (comma separated)',values.frames,v=>values.frames=v);
      field(content,'Animation speed (frames/sec)',values.fps,v=>values.fps=v,{min:1,max:120});
    }
    const more=advanced(content,'Advanced');field(more,'Reference key',values.key,v=>values.key=v,{disabled:!!key});
    content.append(node('p',key?'Changing this artwork updates platforms that use it.':'This registers the artwork and places a platform on your map.'));
  }
  form();
  showDialog(key?'Change platform artwork':'Add platform from artwork',content,async()=>{
    const before=clone(documentData);const asset={type:values.type,url:values.url};
    if(values.type==='image'){
      const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Unable to load that image URL'));img.src=values.url;});values.width=img.naturalWidth;values.height=img.naturalHeight;
    }
    if(values.type==='atlas')asset.atlasURL=values.atlasURL;
    if(values.type==='spritesheet')asset.frameConfig={frameWidth:values.width,frameHeight:values.height};
    if(values.type!=='image'){
      if(!values.frames.trim())throw Error('Enter the animation frames to play.');
      asset.animation={frames:values.frames.split(',').map(f=>values.type==='spritesheet'?Number(f.trim()):f.trim()),frameRate:values.fps,repeat:-1};
    }
    if(!key&&map().assets[values.key])throw Error('That reference key already exists.');
    const old=map().textureSizes[values.key];
    if(old)for(const p of map().layout.platforms.filter(p=>p.textureKey===values.key)){p.scaleX*=old.width/values.width;p.scaleY*=old.height/values.height;if(p.body){p.body.offsetX=(p.body.offsetX||0)*values.width/old.width;p.body.offsetY=(p.body.offsetY||0)*values.height/old.height;}}
    map().assets[values.key]=asset;map().textureSizes[values.key]={width:values.width,height:values.height};
    const errors=validateMap(map());if(errors.length){documentData=before;throw Error(errors.join('\n'));}
    commit('Platform artwork updated');await syncHistoryScene();if(!key)addObject('platform',values.key);
  },key?'Update platforms':'Add platform');
}
function addObject(kind=$('add-kind').value,textureKey=null){
  if(busy)return;
  textureKey ||= Object.keys(map().assets).sort((a,b)=>{const x=map().textureSizes[a],y=map().textureSizes[b];return y.width/y.height-x.width/x.height;})[0];
  if(!scene)return;const center=scene.cameras.main.midPoint;let newId;
  transaction(()=>{
    const p={id:uid(kind),x:Math.round(center.x/16)*16,y:Math.round(center.y/16)*16};newId=p.id;
    if(kind==='platform'){const scale=Math.min(1,240/map().textureSizes[textureKey].width);map().layout.platforms.push({...p,textureKey,scaleX:scale,scaleY:scale,flipX:false});}
    else if(kind==='hitbox')map().layout.hitboxes.push({...p,width:200,height:24,collision:{up:true,down:true,left:true,right:true}});
    else if(kind==='powerup')map().spawns.powerups.push(snapMove(map(),{kind:'powerup',value:p},p.x,p.y,16).value);
    else{const b=map().objectiveLayout.bankBust;if(!b)throw Error('Bank Bust objects belong to a Bank Bust map. Select Iron Junction or create a map from it.');
      if(kind==='gold')b.randomGoldSpawnPoints.push(p);
      else b.objects.push({...p,type:kind,...({goldMine:{radius:86,collectionRadius:110,yieldAmount:10,yieldIntervalMs:4000,maxStoredGold:60},claimableTurret:{claimRadius:110,claimCost:120,range:520,fireRateMs:900,damage:700,projectileSpeed:520,turnSpeed:0.08},wallSlot:{buildRadius:100,cost:90,width:120,height:46}})[kind]});
    }
    if(['platform','hitbox'].includes(kind)){
      const placed=(kind==='platform'?map().layout.platforms:map().layout.hitboxes).find(r=>r.id===newId);
      let valid=validateMap(map()).length===0;
      for(let step=1;!valid&&step<=20;step++)for(const [dx,dy]of [[0,-1],[1,0],[-1,0],[0,1]]){
        placed.x=p.x+dx*step*48;placed.y=p.y+dy*step*48;
        if(validateMap(map()).length===0){valid=true;break;}
      }
    }
    selectedId=newId;
  },'Object added');select(selectedId);
}
function duplicate(){
  const rows=allRows(map()).filter(row=>selectedIds.has(row.id)&&!['spawn','vault','respawn'].includes(row.kind));if(!rows.length)return;
  transaction(()=>{const ids=[];for(const row of rows){const p=clone(row.value);p.id=uid(row.kind);if(row.kind==='powerup'&&p.anchorId){Object.assign(p,mapPoint(row));delete p.anchorId;delete p.dx;}p.x=Math.round(p.x+32);p.y=Math.round(p.y+32);const target=row.kind==='platform'?map().layout.platforms:row.kind==='hitbox'?map().layout.hitboxes:row.kind==='powerup'?map().spawns.powerups:row.kind==='gold'?map().objectiveLayout.bankBust.randomGoldSpawnPoints:map().objectiveLayout.bankBust.objects;target.push(p);ids.push(p.id);}selectedIds=new Set(ids);selectedId=ids.at(-1);},'Selection duplicated');
}
function remove(){
  const ids=allRows(map()).filter(row=>selectedIds.has(row.id)&&!['spawn','vault','respawn'].includes(row.kind)).map(row=>row.id);if(!ids.length)return;
  transaction(()=>{removeRows(map(),ids);selectedId=null;selectedIds.clear();},'Selection removed');
}
function mapPoint(row,data=map()){if(row.kind!=='spawn'&&!(row.kind==='powerup'&&row.value.anchorId))return{x:row.value.x,y:row.value.y};const geometry=geometryFromMap(data);const p=resolveLanding(row.value,geometry.anchors[row.value.anchorId],geometry.colliders,row.kind==='powerup'?{width:32,height:40}:{width:64,height:96});return{x:p.x,y:p.y};}
function visibleRows(){return allRows(map()).filter(r=>r.kind!=='spawn'||$('all-spawns').checked||r.size===String(size()));}
function rowBounds(row,collision=false){if(collision&&row.kind==='platform'){const c=geometryFromMap(map()).anchors[row.id];return{x:c.left,y:c.top,width:c.right-c.left,height:c.bottom-c.top};}const p=row.value;const tex=map().textureSizes[p.textureKey];const width=row.kind==='platform'?tex.width*p.scaleX:row.kind==='hitbox'?p.width:24;const height=row.kind==='platform'?tex.height*p.scaleY:row.kind==='hitbox'?p.height:24;const pt=mapPoint(row);return{x:pt.x-width/2,y:pt.y-height/2,width,height};}
const handlesFor=b=>({nw:[b.x,b.y],n:[b.x+b.width/2,b.y],ne:[b.x+b.width,b.y],e:[b.x+b.width,b.y+b.height/2],se:[b.x+b.width,b.y+b.height],s:[b.x+b.width/2,b.y+b.height],sw:[b.x,b.y+b.height],w:[b.x,b.y+b.height/2]});
class StudioScene extends Phaser.Scene {
  constructor(){super('studio');this.markerElements=new Map();this.visuals=[];this.objectiveVisuals=[];this.mapObjects=[];this.pickups=new Map();this.accumulator=0;}
  preload(){
    preloadMapDocument(this,map());
    this.load.image('editor-background',map().background);
    const bankAssets={vault:'vault.webp',goldMine:'mine.webp',claimableTurret:'mount.webp',wallSlot:'not-built.png',gold:'../coin.webp'};
    for(const [key,file]of Object.entries(bankAssets))this.load.image(`editor-object-${key}`,`/assets/bank-bust/${file}`);
    this.assetErrors=[];this.load.on('loaderror',file=>this.assetErrors.push(`Unable to load ${file.url}`));
  }
  create(){scene=this;this._loadedAssets=clone(map().assets);this._loadedBackground=map().background;this.background=this.add.image(0,0,'editor-background').setDepth(-1000).setAlpha(.6);
    this.overlay=this.add.graphics().setDepth(10000);
    this.rebuild();this.fit();
    this.input.mouse.disableContextMenu();this.input.on('pointerdown',p=>this.pointerDown(p));this.input.on('pointermove',p=>this.pointerMove(p));this.input.on('pointerup',()=>this.pointerUp());this.input.on('wheel',(_p,_objects,_dx,dy)=>{if(!preview)this.zoomBy(dy>0?.9:1.1);});
    this.scale.on('resize',()=>{if(!preview)this.fit();});
    if(this.assetErrors.length)status(this.assetErrors.join(' · '));else status('Ready · Drag objects to edit. Esc enters playtest.');
    sceneReady?.();sceneReady=null;
  }
  rebuild(){
    const cam=this.cameras.main, savedCamera={zoom:cam.zoom,scrollX:cam.scrollX,scrollY:cam.scrollY};
    for(const object of [...this.visuals,...this.objectiveVisuals])object.destroy();this.visuals=[];this.objectiveVisuals=[];
    const runtime=syncMapDocument(this,documentData.id,map());this.mapObjects=runtime.objects;
    this.geometry=geometryFromMap(map(),documentData.id);
    const w=map().bounds.world;this.background.setPosition(w.x+w.width/2,w.y+w.height/2).setDisplaySize(w.width,w.height);
    // Edit camera can pan beyond world bounds; the play camera uses the document bounds.
    if(!preview){cam.removeBounds();cam.setZoom(savedCamera.zoom);cam.scrollX=savedCamera.scrollX;cam.scrollY=savedCamera.scrollY;}
    const markers=visibleRows().filter(r=>!['platform','hitbox'].includes(r.kind));
    const ids=new Set(markers.map(row=>row.id));
    for(const [id,entry] of this.markerElements)if(!ids.has(id)){entry.el.remove();this.markerElements.delete(id);}
    for(const row of markers){
      const p=mapPoint(row);
      if(['vault','objective','gold'].includes(row.kind)){
        const type=row.kind==='objective'?row.value.type:row.kind;
        const art=this.add.image(p.x,p.y,`editor-object-${type}`).setDepth(3000);
        const width=row.value.width|| (type==='gold'?24:type==='goldMine'?80:90);
        art.setDisplaySize(width,row.value.height||width);this.objectiveVisuals.push(art);
      }
      let entry=this.markerElements.get(row.id);
      if(!entry){
        const el=node('div',undefined,{class:'map-marker'}),dot=node('span',undefined,{class:'marker-dot'}),label=node('span',undefined,{class:'marker-label'});
        el.append(dot,label);$('marker-layer').append(el);entry={el,label};this.markerElements.set(row.id,entry);
      }
      entry.point=p;entry.row=row;
      entry.el.className=`map-marker ${row.kind}${row.kind==='spawn'?' '+row.team:''}`;
      entry.label.textContent=row.kind==='spawn'?`${row.team==='team1'?'Blue':'Red'} ${row.index+1}`:row.value.label||friendlyName(row.id);
    }
  }
  positionMarkers(){
    const cam=this.cameras.main;
    for(const [id,entry]of this.markerElements){
      const x=(entry.point.x-cam.scrollX-cam.width/2)*cam.zoom+cam.width/2;
      const y=(entry.point.y-cam.scrollY-cam.height/2)*cam.zoom+cam.height/2;
      entry.el.style.transform=`translate3d(${x}px,${y}px,0)`;
      entry.el.hidden=preview||x<-100||y<-60||x>cam.width+100||y>cam.height+60;
      entry.el.classList.toggle('selected',selectedIds.has(id));
      entry.label.hidden=entry.row.kind!=='spawn'&&!selectedIds.has(id)&&cam.zoom<=.8;
    }
  }

  fit(){const w=map().bounds.world;const cam=this.cameras.main;cam.removeBounds();cam.setZoom(Math.min(this.scale.width/(w.width+160),this.scale.height/(w.height+200)));cam.centerOn(w.x+w.width/2,w.y+w.height/2);$('zoom-label').textContent=Math.round(cam.zoom*100)+'%';}
  zoomBy(factor){const cam=this.cameras.main;const x=cam.midPoint.x,y=cam.midPoint.y;cam.setZoom(Phaser.Math.Clamp(cam.zoom*factor,.08,4));cam.centerOn(x,y);$('zoom-label').textContent=Math.round(cam.zoom*100)+'%';}
  focusRow(row){const p=mapPoint(row);this.cameras.main.centerOn(p.x,p.y);}
  pointerDown(pointer){
    if(preview||busy||$('dialog').open)return;
    const cam=this.cameras.main,pt=cam.getWorldPoint(pointer.x,pointer.y);
    if(keyboard.has(' ')||pointer.middleButtonDown()||pointer.rightButtonDown()){
      drag={kind:'pan',x:pointer.x,y:pointer.y,scrollX:cam.scrollX,scrollY:cam.scrollY};return;
    }
    const current=selected();
    if(selectedIds.size===1&&current&&['platform','hitbox'].includes(current.kind)){
      for(const[handle,[x,y]]of Object.entries(handlesFor(rowBounds(current,handleMode==='collision')))){
        if(Math.hypot(pt.x-x,pt.y-y)<8/cam.zoom){
          drag={kind:'resize',handle,rowId:current.id,start:clone(current.value),before:clone(documentData),screenX:pointer.x,screenY:pointer.y,moved:false};return;
        }
      }
    }
    const rows=visibleRows();
    const ordered=[...rows.filter(r=>!['platform','hitbox'].includes(r.kind)).reverse(),...rows.filter(r=>['platform','hitbox'].includes(r.kind)).reverse()];
    const hit=ordered.find(r=>{const b=rowBounds(r);const pad=['platform','hitbox'].includes(r.kind)?0:8/cam.zoom;return pt.x>=b.x-pad&&pt.x<=b.x+b.width+pad&&pt.y>=b.y-pad&&pt.y<=b.y+b.height+pad;});
    if(!hit){
      drag={kind:'marquee',start:pt,end:pt,screenX:pointer.x,screenY:pointer.y,additive:!!pointer.event?.shiftKey,ids:new Set(selectedIds),moved:false};
      if(!drag.additive)select(null);return;
    }
    if(pointer.event?.shiftKey)select(hit.id,true);
    else if(!selectedIds.has(hit.id))select(hit.id);
    else {selectedId=hit.id;renderInspector();}
    if(!selectedIds.has(hit.id))return;
    const position=mapPoint(hit);
    drag={kind:'move',rowId:hit.id,dx:position.x-pt.x,dy:position.y-pt.y,start:position,ids:[...selectedIds],before:clone(documentData),screenX:pointer.x,screenY:pointer.y,moved:false};
  }
  pointerMove(pointer){
    if(!drag||preview)return;
    const cam=this.cameras.main;
    if(drag.kind==='pan'){cam.scrollX=drag.scrollX-(pointer.x-drag.x)/cam.zoom;cam.scrollY=drag.scrollY-(pointer.y-drag.y)/cam.zoom;return;}
    if(!drag.moved&&Math.hypot(pointer.x-drag.screenX,pointer.y-drag.screenY)<4)return;
    drag.moved=true;
    const pt=cam.getWorldPoint(pointer.x,pointer.y);
    if(drag.kind==='marquee'){
      drag.end=pt;const left=Math.min(pt.x,drag.start.x),right=Math.max(pt.x,drag.start.x),top=Math.min(pt.y,drag.start.y),bottom=Math.max(pt.y,drag.start.y);
      selectedIds=new Set(drag.additive?drag.ids:[]);
      for(const row of visibleRows()){const b=rowBounds(row);if(b.x+b.width>=left&&b.x<=right&&b.y+b.height>=top&&b.y<=bottom)selectedIds.add(row.id);}
      selectedId=[...selectedIds].at(-1)||null;renderBrowser();renderInspector();return;
    }
    documentData=clone(drag.before);
    const base=drag.before.variants[variant],row=allRows(map()).find(r=>r.id===drag.rowId);
    if(!row)return;
    try{
      const bypass=pointer.event?.metaKey||pointer.event?.ctrlKey,grid=Number($('grid').value);
      if(drag.kind==='resize'){
        const x=Math.round(!bypass&&grid?Math.round(pt.x/grid)*grid:pt.x),y=Math.round(!bypass&&grid?Math.round(pt.y/grid)*grid:pt.y);
        const value=handleMode==='collision'&&row.kind==='platform'?resizeCollision(base,row,drag.handle,x,y,!pointer.event?.shiftKey):resizeRow(drag.start,drag.handle,x,y,row.kind==='platform'?map().textureSizes[row.value.textureKey]:null,!pointer.event?.shiftKey);
        Object.assign(row.value,value);
      }else{
        const snap=snapMove(map(),row,pt.x+drag.dx,pt.y+drag.dy,grid,bypass,8/cam.zoom);
        const destination=mapPoint({...row,value:snap.value}),dx=destination.x-drag.start.x,dy=destination.y-drag.start.y;guidelines=snap.guides;
        for(const target of allRows(map()).filter(r=>drag.ids.includes(r.id))){
          if(target.kind==='spawn'&&drag.ids.includes(target.value.anchorId))continue;
          const original=allRows(base).find(r=>r.id===target.id),point=mapPoint(original,base);
          Object.assign(target.value,snapMove(map(),target,point.x+dx,point.y+dy,0,true).value);
        }
      }
      this.rebuild();
    }catch(e){documentData=clone(drag.before);this.rebuild();status(e.message);}
  }
  pointerUp(){
    if(!drag)return;
    const current=drag;drag=null;guidelines=[];
    if(current.kind==='pan'||current.kind==='marquee'||!current.moved)return;
    const errors=validateMap(map());
    if(errors.length){documentData=current.before;this.rebuild();renderInspector();status(`Edit reverted: ${errors[0]}`);return;}
    commit(current.kind==='resize'?'Object resized':'Selection moved');
  }
  drawOverlay(){this.overlay.clear();if(preview)return;const g=this.overlay,cam=this.cameras.main,w=map().bounds.world,grid=Number($('grid').value);
    if(grid&&grid*cam.zoom>=7){g.lineStyle(1/cam.zoom,0x7594a7,.12);const view=cam.worldView;const left=Math.max(w.x,Math.floor(view.x/grid)*grid),top=Math.max(w.y,Math.floor(view.y/grid)*grid),right=Math.min(w.x+w.width,view.right),bottom=Math.min(w.y+w.height,view.bottom);
      for(let x=left;x<=right;x+=grid)g.lineBetween(x,top,x,bottom);for(let y=top;y<=bottom;y+=grid)g.lineBetween(left,y,right,y);}
    g.lineStyle(2/cam.zoom,0x91adc0,.65).strokeRect(w.x,w.y,w.width,w.height);g.lineStyle(1/cam.zoom,0xbaf36b,.25).lineBetween(w.x+w.width/2,w.y,w.x+w.width/2,w.y+w.height);
    this.positionMarkers();
    for(const c of this.geometry.colliders){g.lineStyle(1/cam.zoom,c.id===selectedId?0xbaf36b:0x66bbff,c.id===selectedId?.9:.3).strokeRect(c.left,c.top,c.right-c.left,c.bottom-c.top);}
    for(const guide of guidelines){g.lineStyle(1/cam.zoom,0xff87c8,.9);if(guide.axis==='x')g.lineBetween(guide.value,w.y,guide.value,w.y+w.height);else g.lineBetween(w.x,guide.value,w.x+w.width,guide.value);}
    const color=handleMode==='collision'?0xffb866:0xbaf36b;
    for(const row of visibleRows().filter(row=>selectedIds.has(row.id))){
      const b=rowBounds(row,handleMode==='collision');
      g.lineStyle(2/cam.zoom,color,1).strokeRect(b.x,b.y,b.width,b.height);
      if(selectedIds.size===1&&['platform','hitbox'].includes(row.kind))for(const[x,y]of Object.values(handlesFor(b))){
        g.fillStyle(0x17212c).fillRect(x-4/cam.zoom,y-4/cam.zoom,8/cam.zoom,8/cam.zoom);
        g.lineStyle(1/cam.zoom,color).strokeRect(x-4/cam.zoom,y-4/cam.zoom,8/cam.zoom,8/cam.zoom);
      }
    }
    if(drag?.kind==='marquee'&&drag.moved){const x=Math.min(drag.start.x,drag.end.x),y=Math.min(drag.start.y,drag.end.y),width=Math.abs(drag.end.x-drag.start.x),height=Math.abs(drag.end.y-drag.start.y);g.fillStyle(0x66bbff,.12).fillRect(x,y,width,height);g.lineStyle(1/cam.zoom,0x66bbff,1).strokeRect(x,y,width,height);}

  }
  update(){if(documentData)this.drawOverlay();}
}

async function startScene(){setBusy(true);$('marker-layer').replaceChildren();if(game){game.destroy(true);game=null;scene=null;await new Promise(r=>setTimeout(r,30));}
  return new Promise(resolve=>{sceneReady=()=>{setBusy(false);resolve();};const host=$('canvas');game=new Phaser.Game({type:Phaser.AUTO,parent:host,width:host.clientWidth,height:host.clientHeight,backgroundColor:'#111d29',transparent:false,pixelArt:true,physics:{default:'arcade',arcade:{gravity:{y:0}}},scale:{mode:Phaser.Scale.NONE},scene:StudioScene});});
}
async function setPreview(value,row=null){
  if(!scene||busy)return;
  if(!value){
    const token=playtestSession;playtestSession=null;playtestFrame?.remove();playtestFrame=null;
    preview=false;document.body.classList.remove('preview');keyboard.clear();game.scene.resume('studio');
    if(token)request(`/api/admin/map-playtests/${token}`,{method:'DELETE'}).catch(e=>status(e.message));
    return;
  }
  scene.pointerUp();setBusy(true);
  try{
    const result=await request('/api/admin/map-playtests',{method:'POST',body:JSON.stringify({document:documentData,variant,bots:$('playtest-kind').value==='bots',infiniteSupers:$('infinite-supers').checked,character:$('playtest-character').value,spawn:row?.kind==='spawn'?{point:row.value}:null})});
    playtestSession=result.session;
    preview=true;keyboard.clear();game.scene.pause('studio');document.body.classList.add('preview');
    playtestFrame=node('iframe',undefined,{id:'playtest-frame',title:'Live game playtest',src:`/map-editor/playtest?session=${result.session}&match=${result.matchId}`,allow:'autoplay; fullscreen'});
    document.body.append(playtestFrame);playtestFrame.onload=()=>playtestFrame?.contentWindow?.focus();
  }catch(e){error(e);}finally{setBusy(false);}
}
window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===playtestFrame?.contentWindow&&event.data?.type==='bb-map-playtest-exit')setPreview(false);});
async function syncHistoryScene(){
  const wanted=map().assets,previous=scene._loadedAssets||{};
  const changed=Object.keys(wanted).filter(key=>!scene.textures.exists(key)||JSON.stringify(wanted[key])!==JSON.stringify(previous[key]));
  const backgroundChanged=scene._loadedBackground!==map().background;
  if(changed.length||backgroundChanged){
    setBusy(true);
    for(const key of changed){
      for(const object of scene.mapObjects.filter(o=>o.texture?.key===key)){object.setTexture('__DEFAULT');object._mapRowJSON=null;}
      if(scene.textures.exists(key))scene.textures.remove(key);
      if(scene.anims.exists(`map-animation-${key}`))scene.anims.remove(`map-animation-${key}`);
    }
    if(backgroundChanged){scene.background.setTexture('__DEFAULT');scene.textures.remove('editor-background');scene.load.image('editor-background',map().background);}
    preloadMapDocument(scene,map());
    await new Promise(resolve=>{scene.load.once('complete',resolve);scene.load.start();});setBusy(false);
  }
  if(backgroundChanged){scene.background.setTexture('editor-background');scene._loadedBackground=map().background;}
  scene._loadedAssets=clone(wanted);scene.rebuild();
}
async function loadMap(id){setBusy(true);try{const response=await request(`/api/admin/maps/${id}`);documentData=response.document;revision=response.revision;savedJSON=JSON.stringify(documentData);
    try{const draft=JSON.parse(localStorage.getItem(`bb-map-draft-${id}`)||'null');if(draft?.document&&validateDocument(draft.document).length===0&&JSON.stringify(draft.document)!==savedJSON){documentData=draft.document;revision=draft.revision;status('Recovered local draft.');}}catch{}
    history=new MapHistory(documentData);selectedId=null;selectedIds.clear();$('map-select').value=id;renderBrowser();renderInspector();refreshSave();await startScene();
  }catch(e){error(e);}finally{setBusy(false);}}
async function save(){if(busy||!documentData)return;scene?.pointerUp();const errors=validateDocument(documentData);if(errors.length){error(Error(errors.join('\n')));return;}setBusy(true);
  try{const result=await request(`/api/admin/maps/${documentData.id}`,{method:'PUT',body:JSON.stringify({document:documentData,revision})});revision=result.revision;documentData=result.document;history.stack[history.index]=clone(documentData);savedJSON=JSON.stringify(documentData);await syncHistoryScene();renderInspector();persistDraft();refreshSave();status('Saved. New matches will use this revision; existing matches keep their current map.');await refreshMaps();}
  catch(e){error(e);}finally{setBusy(false);}}
function download(){const {document:exported,files:pending}=exportDocument(documentData);const blob=new Blob([JSON.stringify(exported,null,2)+'\n'],{type:'application/json'});const url=URL.createObjectURL(blob);const link=node('a',undefined,{href:url,download:`map-${documentData.id}.json`});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Exported full map document with all variants.');if(pending.size){const info=node('div');info.append(node('p','JSON does not include uploaded image files. Manually replace these game files when using this export:'));for(const file of pending)info.append(node('p','public'+file));showDialog('Images needed for this export',info,null,'Got it');}}
function importDialog(){if(busy)return;const content=node('div');content.append(node('p','Paste a complete versioned map document, or select an exported JSON file. Import replaces every object and all three variants and can be undone.'));const input=node('input',undefined,{type:'file',accept:'.json,application/json'});const text=node('textarea',undefined,{'aria-label':'Map document JSON',spellcheck:'false'});input.onchange=async()=>{if(input.files[0])text.value=await input.files[0].text();};content.append(input,text);
  showDialog('Import map document',content,async()=>{let doc;try{doc=JSON.parse(text.value);}catch{throw Error('Invalid JSON.');}const errors=validateDocument(doc);if(errors.length)throw Error(errors.slice(0,12).join('\n'));if(doc.id!==documentData.id)throw Error('The imported map ID must match the open map. Use New map to create a separate map.');documentData=doc;selectedId=null;selectedIds.clear();commit('Document imported');await syncHistoryScene();});}
async function refreshMaps(){const result=await request('/api/admin/maps');mapList=result.maps;$('map-select').replaceChildren(...mapList.map(m=>node('option',m.label,{value:m.id})));if(documentData)$('map-select').value=documentData.id;}
function newMapDialog(){if(busy)return;const content=node('div');const values={id:Math.max(...mapList.map(m=>m.id))+1,label:'New map'};content.append(node('p','Create a separate map using the current map as a starting point. All variants and assets are included.'));field(content,'Map ID',values.id,v=>values.id=v,{min:1});field(content,'Map name',values.label,v=>values.label=v);
  showDialog('Create map',content,async()=>{if(mapList.some(m=>m.id===values.id))throw Error('Map ID already exists.');const doc=clone(documentData);doc.id=values.id;doc.label=values.label;Object.assign(doc.metadata,{id:doc.id,label:doc.label,key:`map-${doc.id}`});const errors=validateDocument(doc);if(errors.length)throw Error(errors.join('\n'));persistDraft();documentData=doc;revision=null;savedJSON='';history=new MapHistory(doc);selectedId=null;selectedIds.clear();commit('New map created locally. Save to add it to the map catalog.');$('map-select').append(node('option',doc.label,{value:doc.id}));$('map-select').value=doc.id;await startScene();},'Create');}
function copyVariantDialog(){if(busy)return;const content=node('div');let target=VARIANTS.find(v=>v!==variant);content.append(node('p',`Copy the complete ${variant} layout, bounds, spawns and settings into another variant. This can be undone.`));field(content,'Destination',target,v=>target=v,{options:VARIANTS.filter(v=>v!==variant)});showDialog('Copy variant',content,()=>{documentData.variants[target]=clone(map());commit(`Copied ${variant} to ${target}`);});}
async function undo(redo=false){if(!history||busy)return;documentData=redo?history.redo():history.undo();selectedIds=new Set([...selectedIds].filter(id=>allRows(map()).some(r=>r.id===id)));selectedId=[...selectedIds].at(-1)||null;persistDraft();refreshSave();renderBrowser();renderInspector();await syncHistoryScene();status(redo?'Edit restored':'Edit undone');}
$('map-select').onchange=()=>loadMap(Number($('map-select').value));$('variant').onchange=async()=>{variant=$('variant').value;selectedId=null;selectedIds.clear();renderBrowser();renderInspector();await startScene();};$('search').oninput=renderBrowser;$('all-spawns').onchange=()=>{renderBrowser();scene?.rebuild();};
$('add').onclick=()=>addObject();$('save').onclick=save;$('export').onclick=download;$('import').onclick=importDialog;$('new-map').onclick=newMapDialog;$('copy-variant').onclick=copyVariantDialog;
$('undo').onclick=()=>undo();$('redo').onclick=()=>undo(true);$('preview').onclick=()=>setPreview(!preview);$('fit').onclick=()=>scene?.fit();$('zoom-in').onclick=()=>scene?.zoomBy(1.2);$('zoom-out').onclick=()=>scene?.zoomBy(1/1.2);
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{activeTab=b.dataset.tab;renderInspector();});
window.addEventListener('keydown',ev=>{if($('dialog').open)return;const typing=/INPUT|SELECT|TEXTAREA/.test(ev.target.tagName);const key=ev.key.toLowerCase(),ctrl=ev.metaKey||ev.ctrlKey;
  if(key==='escape'){ev.preventDefault();if(typing)ev.target.blur();setPreview(!preview);return;}if(typing)return;
  if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(key))ev.preventDefault();keyboard.add(key);
  if(preview)return;
  if(key==='tab'&&selected()?.kind==='platform'){ev.preventDefault();handleMode=handleMode==='artwork'?'collision':'artwork';renderInspector();return;}
  if(ctrl&&key==='s'){ev.preventDefault();save();}else if(ctrl&&key==='z'){ev.preventDefault();undo(ev.shiftKey);}else if(ctrl&&key==='y'){ev.preventDefault();undo(true);}else if(key==='d'){ev.preventDefault();duplicate();}else if(key==='delete'||key==='backspace'){ev.preventDefault();remove();}else if(key==='f')scene?.fit();
  else if(['arrowup','arrowdown','arrowleft','arrowright'].includes(key)){const row=selected();if(!row)return;transaction(()=>{const pt=mapPoint(row),step=ev.shiftKey?16:1;Object.assign(row.value,snapMove(map(),row,pt.x+(key==='arrowleft'?-step:key==='arrowright'?step:0),pt.y+(key==='arrowup'?-step:key==='arrowdown'?step:0),0,true).value);},'Object nudged');}
});
const viewportObserver=new ResizeObserver(()=>{if(game&&scene&&!preview)game.scale.resize($('viewport').clientWidth,$('viewport').clientHeight);});viewportObserver.observe($('viewport'));
window.addEventListener('keyup',ev=>keyboard.delete(ev.key.toLowerCase()));window.addEventListener('blur',()=>{keyboard.clear();scene?.pointerUp();});window.addEventListener('pointerup',()=>scene?.pointerUp());
window.addEventListener('beforeunload',ev=>{if(dirty()){persistDraft();ev.preventDefault();ev.returnValue='';}});
(async()=>{try{await refreshMaps();const query=new URLSearchParams(location.search);const requestedVariant=query.get('variant');if(VARIANTS.includes(requestedVariant)){variant=requestedVariant;$('variant').value=variant;}await loadMap(Number(query.get('map'))||mapList[0].id);}catch(e){error(e);}})();
