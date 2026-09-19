const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const api = {};
const code = babel.transformSync(fs.readFileSync('src/characters/gloop/slimeVisual.js','utf8'), {
  babelrc:false, configFile:false, presets:[['@babel/preset-env',{targets:{node:'current'}}]],
}).code;
vm.runInNewContext(code,{exports:api,require:name=>name.includes('projectilePresentation') ? require('../src/shared/projectilePresentation') : name.includes('renderLayers')
  ? {RENDER_LAYERS:{ATTACKS:20}} : require('../src/shared/gloopProjectile')});
function setup(owner) {
  const objects=[];
  const scene={add:{graphics(){
    const g={colors:[],lines:[],destroyed:false,
      fillStyle(c){this.colors.push(c);return this;},
      lineTo(x,y){assert.ok(Number.isFinite(x)&&Number.isFinite(y));this.lines.push([x,y]);return this;},
      clear(){this.colors=[];this.lines=[];return this;},
      destroy(){this.destroyed=true;},
    };
    for(const name of ['setDepth','beginPath','moveTo','closePath','fillPath','lineStyle','fillEllipse','lineBetween','strokeCircle','arc','strokePath','setPosition','setScale','setRotation']) g[name]=()=>g;
    objects.push(g);return g;
  }}};
  const state={x:100,y:100,vx:200,vy:20,collisionRadius:28,floorY:500};
  const visual=api.createSlimeVisual(scene,state,1.5,owner);
  return {visual,objects,state};
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
