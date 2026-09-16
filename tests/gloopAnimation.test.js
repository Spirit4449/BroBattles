const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const babel=require('@babel/core');
const {createAnimationBuilder}=require('../src/characters/shared/animationBuilder');
const {slimeLaunch}=require('../src/shared/gloopProjectile');
const definition=require('../src/shared/characters/gloop.json');
const code=babel.transformSync(fs.readFileSync('src/characters/gloop/anim.js','utf8'),{
  babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]],
}).code;
for(const folder of ['public/assets/gloop','public/assets/gloop/skins/gloop-amethyst']) {
  test(`${folder}: idle closes smoothly and wall-slide has its own pose`,()=>{
    const atlas=JSON.parse(fs.readFileSync(folder+'/animations.json'));
    const names=atlas.frames.map(f=>f.filename);
    const created=new Map(),api={};
    const scene={textures:{exists:()=>true,get:()=>({getFrameNames:()=>names})},
      anims:{exists:key=>created.has(key),create:anim=>created.set(anim.key,anim)}};
    vm.runInNewContext(code,{exports:api,require:()=>({createAnimationBuilder})});
    api.animations(scene);
    const idle=created.get('gloop-idle').frames.map(f=>Number(f.frame.slice(4)));
    for(let i=0;i<idle.length;i++)assert.equal(Math.abs(idle[i]-idle[(i+1)%idle.length]),1);
    assert.deepEqual(created.get('gloop-sliding').frames.map(f=>f.frame),['wall00']);
    assert.equal(created.get('gloop-sliding').repeat,-1);
    assert.deepEqual(created.get('gloop-falling').frames.map(f=>f.frame),['fall00','fall01','fall02']);
    const duck=atlas.frames.find(f=>f.frame.x===128*(definition.duckFrame[0]-1)&&f.frame.y===128*(definition.duckFrame[1]-1));
    assert.equal(duck?.filename,'duck00');
  });
}
test('Gloop throw releases sooner and overlaps the body on both sides',()=>{
  const cfg=definition.stats.tuning.attack.slimeball;
  assert.ok(cfg.castDelayMs<=120);
  const pose={x:100,y:100,width:153.6,height:153.6};
  for(const direction of [-1,1]){
    const {start}=slimeLaunch(pose,{x:pose.x+direction*250,y:100},cfg);
    assert.ok(Math.abs(start.x-pose.x)<cfg.collisionRadius);
    assert.equal(Math.sign(start.x-pose.x),direction);
  }
});

// Execute the production setup function, including its one-based cell fallback.
const registrySource=fs.readFileSync('src/characters/index.js','utf8');
const duckSetupSource=registrySource.slice(registrySource.indexOf('function setupDuckFrame('),registrySource.indexOf('// Build the registry'));
for(const folder of ['public/assets/gloop','public/assets/gloop/skins/gloop-amethyst']) {
  for(const named of [true,false]) {
    test(`${folder}: runtime duck selection uses authored pose (named=${named})`,()=>{
      const atlas=JSON.parse(fs.readFileSync(folder+'/animations.json'));
      const authored=atlas.frames.find(f=>f.filename==='duck00');
      assert.ok(authored);
      const frames=new Map(atlas.frames.filter(f=>named||f.filename!=='duck00').map(f=>[f.filename,f.frame]));
      const animations=new Map();
      const texture={has:name=>frames.has(name),add(name,source,x,y,w,h){frames.set(name,{x,y,w,h});}};
      const textureKey=folder.includes('skins')?'gloop__gloop-amethyst':'gloop';
      const scene={textures:{exists:key=>key===textureKey,get:()=>texture},
        anims:{exists:key=>animations.has(key),create:a=>animations.set(a.key,a)}};
      const context={DUCK_FRAME_CELLS:{gloop:definition.duckFrame},CHARACTER_FRAMES:{gloop:definition.frame},scene,textureKey};
      vm.runInNewContext(duckSetupSource+'; setupDuckFrame(scene,"gloop",textureKey);',context);
      const frame=frames.get('duck00');
      assert.equal(frame.x,authored.frame.x);
      assert.equal(frame.y,authored.frame.y);
      assert.equal(animations.get(textureKey+'-ducking').frames[0].frame,'duck00');
      assert.equal(animations.get(textureKey+'-ducking').frames[0].key,textureKey);
    });
  }
}
