const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const babel = require('@babel/core');
const api = {};
const code = babel.transformSync(fs.readFileSync('src/client/game/characters/gloop/slimeVisual.js','utf8'), {
  babelrc:false, configFile:false, presets:[['@babel/preset-env',{targets:{node:'current'}}]],
}).code;
const transformModule=file=>{
  const exports={};
  vm.runInNewContext(babel.transformSync(fs.readFileSync(file,'utf8'),{
    babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]],
  }).code,{exports});
  return exports;
};
const pixelShapes=transformModule('src/client/game/powerups/pixelShapes.js');
vm.runInNewContext(code,{exports:api,require:name=>name.includes('pixelShapes') ? pixelShapes : name.includes('projectilePresentation') ? require('../src/shared/projectilePresentation') : name.includes('renderLayers')
  ? {RENDER_LAYERS:{ATTACKS:20}} : require('../src/shared/characters/gloopProjectile')});
function setup(owner) {
  const objects=[];
  const scene={add:{graphics(){
    const g=Object.assign(new EventEmitter(),{colors:[],lines:[],destroyed:false,
      fillStyle(c){this.colors.push(c);return this;},
      lineTo(x,y){assert.ok(Number.isFinite(x)&&Number.isFinite(y));this.lines.push([x,y]);return this;},
      clear(){this.colors=[];this.lines=[];return this;},
      destroy(){
        assert.equal(this.destroying,undefined,'graphics destruction must not reenter');
        if(this.destroyed)return;
        this.destroying=true;
        this.emit('destroy');
        this.destroyed=true;
        this.destroying=undefined;
      },
    });
    g.setPosition=(x,y)=>{g.x=x;g.y=y;return g;};
    for(const name of ['setDepth','setVisible','beginPath','moveTo','closePath','fillPath','lineStyle','fillEllipse','lineBetween','strokeCircle','arc','strokePath','setScale','setRotation','setStrokeStyle','fillRect']) g[name]=()=>g;
    objects.push(g);return g;
  }}};
  const state={x:100,y:100,vx:200,vy:20,collisionRadius:28,floorY:500};
  const visual=api.createSlimeVisual(scene,state,1.5,owner);
  return {visual,objects,state,scene};
}
test('Crystal Gloop alone fires purple liquid with embedded faceted crystals',()=>{
  for(const owner of [{_bbSkinTextureKey:'gloop__gloop-amethyst'},{texture:{key:'gloop__gloop-amethyst'}}]) {
    const {visual,objects}=setup(owner); visual.update(16);
    assert.ok(objects[0].colors.includes(0x5633cb),'purple slime remains visible');
    assert.equal(objects[0].colors.filter(c=>c===0x3150b5).length,3,'three submerged crystal faces');
    assert.equal(objects[0].colors.filter(c=>c===0x7450b8).length,3,'muted violet facets');
    visual.destroy(); assert.ok(objects.every(g=>g.destroyed));
  }
  const base=setup({texture:{key:'gloop'}});base.visual.update(16);
  assert.ok(base.objects[0].colors.includes(0x11bbaa));
  assert.ok(!base.objects[0].colors.includes(0x3150b5));
});
test('crystal goo survives rebound, deposits crystal residue and cleans up',()=>{
  const {visual,objects,state}=setup({_bbSkinTextureKey:'gloop__gloop-amethyst'});
  visual.impact({x:100,y:128,nx:0,ny:-1,speed:200,terminal:false});
  state.contactHold={remaining:50,duration:100,speed:200};
  assert.equal(visual.update(16),true);
  assert.ok(objects[1].colors.includes(0x3150b5));
  visual.finish({onCharacter:true});
  assert.equal(objects[0].colors.length,0);
  for(let i=0;i<50;i++)visual.update(100);
  assert.equal(visual.update(100),false);
  visual.destroy();assert.ok(objects.every(g=>g.destroyed));
});

test('a slimeball that bounces off a ledge falls with its physics instead of hovering at the ledge height',()=>{
  const {visual,objects,state}=setup({texture:{key:'gloop'}});
  state.vx=0;state.vy=0;state.y=100;
  visual.impact({x:100,y:128,nx:0,ny:-1,speed:300,terminal:false});
  state.contactHold={remaining:100,duration:100,speed:300};
  for(let t=0;t<100;t+=16){state.contactHold.remaining-=16;visual.update(16);}
  state.contactHold=null;
  // Rolled off the platform's edge: the ball drops well below its top.
  state.vx=120;state.vy=400;
  for(let i=0;i<30;i++){state.x+=2;state.y+=6.4;visual.update(16);}
  assert.ok(Math.abs(objects[0].y-state.y)<=4,`body at ${objects[0].y} trails the ball at ${state.y}`);
  visual.destroy();
});

test('slimeball graphics can be destroyed by Phaser without recursive destruction',()=>{
  const attackApi={};
  const attackCode=babel.transformSync(fs.readFileSync('src/client/game/characters/gloop/attack.js','utf8'),{
    babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]],
  }).code;
  vm.runInNewContext(attackCode,{exports:attackApi,require:name=>{
    if(name.includes('slimeVisual'))return {createSlimeVisual:api.createSlimeVisual};
    if(name.includes('gloopProjectile'))return require('../src/shared/characters/gloopProjectile');
    if(name.includes('characterTuning'))return {getResolvedCharacterAttackConfig:()=>({collisionRadius:28,visualScale:1.5})};
    if(name.includes('renderLayers'))return {RENDER_LAYERS:{ATTACKS:20}};
    return {};
  }});
  for(const trigger of ['body','shutdown']){
    const {scene,objects}=setup();
    scene.events=new EventEmitter();
    scene.add.circle=()=>scene.add.graphics();
    scene.physics={world:{bounds:{x:0,y:0,width:2300,height:1000}}};
    const body=attackApi.spawnGloopSlimeballVisual(scene,{id:'test',start:{x:100,y:100}});
    assert.ok(body);
    if(trigger==='body')body.destroy();
    else scene.events.emit('shutdown');
    assert.ok(objects.slice(2).every(object=>object.destroyed));
    assert.equal(scene.events.listenerCount('update'),0);
    assert.equal(scene.events.listenerCount('postupdate'),0);
  }
});
test('the windup lump grows out of the thrower, follows him, and is reabsorbed if never released',()=>{
  const {scene}=setup({texture:{key:'gloop'}});
  const owner={x:100,y:100,active:true,texture:{key:'gloop'}};
  const made=[];
  const probe=api.createSlimeBud({add:{graphics(){const g=scene.add.graphics();made.push(g);return g;}}},owner,{offsetX:10,offsetY:20,angle:0,radius:18,durationMs:120});
  probe.update(16); owner.x+=50; probe.update(200);
  assert.ok(Math.abs(made[1].x-(owner.x+10))<=4,'fully grown, the lump sits at the launch start on the moved thrower');
  probe.retract();
  let frames=0; while(probe.update(16)&&frames<100) frames++;
  assert.ok(frames<20,'reabsorbed quickly');
  assert.ok(made.every(g=>g.destroyed));
});
test('a spat ball stays joined to the thrower by a neck that tears off early in flight',()=>{
  const owner={x:60,y:110,active:true,texture:{key:'gloop'}};
  const neckColor=0x11bbaa;
  const plain=setup(owner); plain.visual.update(16);
  assert.ok(!plain.objects[1].colors.includes(neckColor),'no neck without a thrower to tear from');
  const objects=[];
  const scene={add:{graphics(){const g=setup(owner).scene.add.graphics();objects.push(g);return g;}}};
  const state={x:100,y:100,vx:200,vy:-60,collisionRadius:18,floorY:500};
  const visual=api.createSlimeVisual(scene,state,1.5,owner,{offsetX:5,offsetY:-5});
  visual.update(16);
  assert.ok(objects[1].colors.includes(neckColor),'joined at release');
  for(let i=0;i<20;i++){state.x+=4;visual.update(16);}
  assert.ok(!objects[1].colors.includes(neckColor),'torn free shortly after');
  visual.destroy();
});
