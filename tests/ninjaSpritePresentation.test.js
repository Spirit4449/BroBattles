const test = require('node:test');
const assert = require('node:assert/strict');
const { spritePresentation } = require('../src/client/game/characters/shared/spritePresentation');
const { characterBody } = require('../src/shared/physics/duelGeometry');
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
  // Client body centre: origin plus offset (the origin sits under the rig's feet).
  close((128+body.offsetXFromHalf-256*originX)*scale,original.offsetX);
  close((body.offsetY+height/2-256*originY)*scale,original.offsetY);
  for(const ratio of [1,0.55]) {
    const duckHeight=height*ratio;
    close((body.offsetY+height-duckHeight+duckHeight-256*originY)*scale,
      original.offsetY+original.height/2);
  }
});

test('off-centre art stands on its feet either way it faces, with the body where it was', () => {
  const { bindPlayerOrigin } = require('../src/client/game/characters/shared/rig.js');
  const { rigOf } = require('../src/shared/characters/characterRig');
  const { characterFrames, characterPresentation } = require('../src/shared/characters');
  const frame = characterFrames.wizard, standX = rigOf('wizard').feet[0];
  const shifted = spritePresentation('wizard', { key: 'wizard' });
  const centred = spritePresentation('wizard', { key: 'wizard-skin' });
  assert.equal(centred.originX, 0.5, 'other art keeps the centred origin');
  // Phaser mirrors a flipped texture inside its frame, so the feet are at W - x.
  const feetOnScreen = (p, flip) => ((flip ? frame.w - standX : standX) - (flip ? p.flipOriginX : p.originX) * frame.w) * p.scale;
  // Arcade: body.x = sprite.x - displayOriginX * scale + offset.x * scale; offsets ignore flip.
  const offsetFor = (p, flip) => frame.w / 2 - (frame.w - p.body.widthShrink) / 2 + p.body.offsetXFromHalf + (flip ? p.body.flipOffset || 0 : 0);
  const bodyCentre = (p, flip) => (offsetFor(p, flip) - (flip ? p.flipOriginX ?? p.originX : p.originX) * frame.w
    + (frame.w - p.body.widthShrink) / 2) * p.scale;
  for (const flip of [false, true]) {
    assert.ok(Math.abs(feetOnScreen(shifted, flip)) < 1e-8, `feet on the sprite position (flip ${flip})`);
    assert.ok(Math.abs(bodyCentre(shifted, flip) - bodyCentre(centred, flip)) < 1e-8, `body unchanged (flip ${flip})`);
  }
  class Sprite {
    setOrigin(x = 0.5, y = x) { this.originX = x; this.originY = y; return this; }
  }
  const sprite = Object.assign(new Sprite(), { flipX: false, frame: { realWidth: frame.w },
    body: { offset: { x: offsetFor(shifted, false), y: 7 }, setOffset(x, y) { this.offset = { x, y }; } } });
  bindPlayerOrigin(sprite, shifted);
  assert.equal(sprite.originX, shifted.originX);
  const saved = sprite.originX; // what powerup effects capture and later restore
  sprite.flipX = true;
  assert.equal(sprite.originX, shifted.flipOriginX);
  assert.ok(Math.abs(sprite.body.offset.x - offsetFor(shifted, true)) < 1e-8, 'matches what applyFlipOffset sets');
  assert.equal(sprite.body.offset.y, 7);
  sprite.setOrigin(saved, 0.5);
  assert.equal(sprite.originX, shifted.flipOriginX, 'restoring a saved origin keeps the current facing');
  sprite.setOrigin(0.2, 0.4);
  assert.equal(sprite.originX, shifted.flipOriginX, 'nothing else moves the horizontal origin');
  assert.equal(sprite.originY, 0.4, 'vertical origin is still free');
  sprite.setOrigin(saved, 0.5);
  sprite.flipX = 0;
  assert.equal(sprite.flipX, false);
  assert.equal(sprite.originX, shifted.originX);
  assert.ok(Math.abs(sprite.body.offset.x - offsetFor(shifted, false)) < 1e-8);
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
  loadAnimations('../src/client/game/characters/ninja/anim').animations({anims:{exists:key=>entries.has(key),create:row=>entries.set(row.key,row)}});
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
  loadAnimations('../src/client/game/characters/ninja/anim').animations(scene);
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
  loadAnimations('../src/client/game/characters/ninja/legacyAnim').legacyAnimations({anims},'sovereign');
  const attack=entries.get('sovereign-throw');
  assert.equal(attack.frames.length,4);assert.equal(attack.frameRate,15);
  assert.equal(attack.frames[0].frame,'throw00');
  assert.equal(entries.get('sovereign-jumping').frames.length,8);
});

test('idle holds its open eyes while blink frames use short total durations',()=>{
  const entries=new Map();
  loadAnimations('../src/client/game/characters/ninja/anim').animations({anims:{exists:()=>false,create:row=>entries.set(row.key,row)}});
  const idle=entries.get('ninja-idle');
  const holds=idle.frames.map(frame=>1000/idle.frameRate+(frame.duration||0));
  assert.deepEqual(Array.from(holds),[1000,400,70,90,160]);
  assert.equal(idle.repeat,-1);
  assert.ok(entries.get('ninja-running').frames.every(frame=>frame.duration===undefined));
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
