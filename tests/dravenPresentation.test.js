const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
function load(file, deps) {
  const exports = {};
  const code = babel.transformSync(fs.readFileSync(file,'utf8'), {babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code;
  vm.runInNewContext(code,{exports,require:name=>deps[name] || {}});
  return exports;
}
test('remote cast never schedules a phantom explosion; confirmed impact renders once at target',()=>{
  const impacts=[];
  const Draven=load('src/characters/draven/constructor.js',{
    '../../shared/characterTuning.js':{getResolvedCharacterAttackConfig:()=>({})},
    '../shared/characterEntityBase':{default:class {},__esModule:true},
    '../shared/animationState':{playSpriteAnimation(){}},
    './attack':{spawnExplosion:(...args)=>impacts.push(args)},
  }).default;
  const scene={sound:{play(){}},time:{delayedCall(){throw Error('phantom impact timer');}}};
  const owner={opponent:{active:true,x:10,y:20}};
  assert.equal(Draven.handleRemoteAttack(scene,{type:'draven-splash'},owner),true);
  assert.equal(impacts.length,0);
  Draven.handleRemoteAttack(scene,{type:'draven-splash-explode',x:240,y:160},owner);
  assert.equal(impacts.length,1);
  assert.equal(impacts[0][1],240);assert.equal(impacts[0][2],160);
});
test('explosion starts at contact frame with brief translucent fade-in',()=>{
  const api=load('src/characters/draven/attack.js',{
    '../../shared/characterTuning.js':{getResolvedCharacterAttackConfig:()=>({})},
    '../../shared/projectilePresentation':require('../src/shared/projectilePresentation'),
    '../../gameScene/renderLayers':{RENDER_LAYERS:{PLAYER:30,ATTACKS:60}},
  });
  let animation,tween;
  const sprite={setDepth(v){this.depth=v;},setScale(v){this.scale=v;},setAlpha(v){this.alpha=v;},anims:{play(v){animation=v;}},once(){}};
  const scene={textures:{exists:()=>true},anims:{exists:()=>true},add:{sprite:()=>sprite},tweens:{add(v){tween=v;}}};
  assert.equal(api.spawnExplosion(scene,100,200),sprite);
  assert.equal(animation.startFrame,3);
  assert.equal(sprite.depth,60);
  assert.equal(animation.frameRate,22);
  assert.equal(sprite.alpha,0.42);
  assert.equal(tween.duration,70);
  assert.equal(tween.alpha,0.92);
});
test('both super atlases retain 16 high-resolution 288px cells',()=>{
  for(const suffix of ['', '-red']){
    const atlas=JSON.parse(fs.readFileSync(`public/assets/draven/special-bb${suffix}.json`));
    assert.equal(atlas.frames.length,16);
    for(const frame of atlas.frames){assert.equal(frame.frame.w,288);assert.equal(frame.frame.h,288);}
  }
});
