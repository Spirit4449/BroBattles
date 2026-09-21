const test = require('node:test');
const assert = require('node:assert/strict');
const { spritePresentation } = require('../src/characters/shared/spritePresentation');
const { characterBody } = require('../src/shared/duelGeometry');
const settings = require('../public/assets/ninja/animation-settings.json');
const exportedAtlas = require('../public/assets/ninja/animations.json');
const atlas = {frames: Object.fromEntries(exportedAtlas.frames.map(frame => [frame.filename, frame]))};

test('standard Ninja preserves authoritative standing and ducking collision geometry', () => {
  const presentation = spritePresentation('ninja', { key:'ninja', has:()=>true, get:()=>({width:256}) });
  const {body,scale,originX,originY} = presentation;
  const original = characterBody('ninja');
  const width = 256-body.widthShrink, height = 256-body.heightShrink;
  const close = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
  close(width*scale,original.width);
  close(height*scale,original.height);
  close((128-256*originX)*scale,original.offsetX);
  close((body.offsetY+height/2-256*originY)*scale,original.offsetY);
  for(const ratio of [1,0.55]) {
    const duckHeight=height*ratio;
    close((body.offsetY+height-duckHeight+duckHeight-256*originY)*scale,
      original.offsetY+original.height/2);
  }
});

test('legacy Sovereign presentation remains unchanged',()=>{
  const p=spritePresentation('ninja',{key:'ninja-skin',has:()=>false});
  assert.equal(p.scale,.9);assert.equal(p.body.widthShrink,42);
  assert.equal(p.originX,.5);assert.equal(p.originY,.5);
});

test('original Ninja pose counts and spare frames survive repacking into 256 cells',()=>{
  assert.deepEqual(settings.animations.slice(0,8).map(row=>row.frames.length),[5,6,8,3,4,4,1,8]);
  for(const row of settings.animations)for(const name of row.frames){
    assert.ok(atlas.frames[name], name);
    assert.equal(atlas.frames[name].frame.w,256);
    assert.equal(atlas.frames[name].frame.h,256);
  }
  assert.ok(atlas.frames.duck00, 'dedicated combat crouch');
  for (const spare of ['running06','jumping08','dying04']) assert.ok(atlas.frames[spare]);
});

function loadAnimations(path) {
  const fs=require('node:fs'),vm=require('node:vm'),babel=require('@babel/core');
  const code=babel.transformSync(fs.readFileSync(require.resolve(path),'utf8'),{
    babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code;
  const api={};vm.runInNewContext(code,{exports:api,require:()=>settings});return api;
}
test('runtime preserves selected row timing and logical attack/wall aliases',()=>{
  const entries=new Map();
  loadAnimations('../src/characters/ninja/anim').animations({anims:{exists:key=>entries.has(key),create:row=>entries.set(row.key,row)}});
  for(const row of settings.animations){
    if (!row.frames.length || row.key === 'unused-original') continue;
    const key='ninja-'+({attack:'throw',wall:'sliding'}[row.key]||row.key);
    const animation=entries.get(key);assert.ok(animation,key);
    assert.equal(animation.frameRate,row.fps);
    assert.equal(animation.repeat,row.loop?-1:0);
    assert.equal(JSON.stringify(animation.frames.map(f=>f.frame)),JSON.stringify(row.frames));
  }
  assert.equal(entries.get('ninja-special').frames.length,8);
  assert.equal(entries.get('ninja-special').frameRate,30);
  assert.equal(entries.get('ninja-jumping').frameRate,24);
  assert.equal(entries.get('ninja-running').frameRate,14);
});

test('real Phaser playback keeps run and fall inside their rows across multiple cycles',()=>{
  const Manager=require('phaser/src/animations/AnimationManager');
  const State=require('phaser/src/animations/AnimationState');
  const Events=require('eventemitter3');
  const manager=new Manager({events:new Events()});
  manager.textureManager={getFrame:(key,name)=>{
    assert.ok(atlas.frames[name],`missing texture frame ${name}`);
    return {name,texture:{key}};
  }};
  const scene={anims:manager,sys:{anims:manager}};
  loadAnimations('../src/characters/ninja/anim').animations(scene);
  const sprite={scene,emit(){},setSizeToFrame(){}};
  const state=new State(sprite);sprite.anims=state;
  for(const logical of ['running','falling']){
    const seen=new Set();
    for(let i=0;i<240;i++){
      state.play('ninja-'+logical,true);state.update(i*1000/60,1000/60);
      assert.ok(sprite.frame.name.startsWith(logical),sprite.frame.name);
      seen.add(sprite.frame.name);
    }
    assert.equal(seen.size,logical==='running'?6:3);
  }
});
test('legacy Ninja skins keep throw names and original attack duration',()=>{
  const entries=new Map();
  const anims={exists:()=>false,create:row=>entries.set(row.key,row),
    generateFrameNames:(key,opts)=>Array.from({length:opts.end+1},(_,i)=>({key,frame:opts.prefix+String(i).padStart(2,'0')}))};
  loadAnimations('../src/characters/ninja/legacyAnim').legacyAnimations({anims},'sovereign');
  const attack=entries.get('sovereign-throw');
  assert.equal(attack.frames.length,4);assert.equal(attack.frameRate,15);
  assert.equal(attack.frames[0].frame,'throw00');
  assert.equal(entries.get('sovereign-jumping').frames.length,8);
});

test('Ninja standing artwork retains original world height and clears the HUD',async()=>{
  const sharp=require('../spritesheet-generator/node_modules/sharp');
  async function bounds(file,frame){const {data,info}=await sharp(file).extract({left:frame.x,top:frame.y,width:frame.w,height:frame.h}).ensureAlpha().raw().toBuffer({resolveWithObject:true});let top=info.height,bottom=0;for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>127){top=Math.min(top,y);bottom=Math.max(bottom,y);}return{top,height:bottom-top+1};}
  // Original idle00 visible bounds were y=8..71 in a 72px cell at 0.9 scale.
  const originalWorldHeight=64*.9;
  const current=await bounds('public/assets/ninja/spritesheet.webp',atlas.frames.idle00.frame);
  const p=spritePresentation('ninja',{key:'ninja',has:()=>true,get:()=>({width:256})});
  assert.ok(Math.abs(current.height*p.scale-originalWorldHeight)<=1,'art must not grow beyond original world size');
  const hoodTop=(current.top-p.originY*256)*p.scale;
  assert.ok(p.hudTopOffset+7<hoodTop,'super bar and glow must clear hood');
});
