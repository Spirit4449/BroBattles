const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const babel=require('@babel/core');
const {createAnimationBuilder}=require('../src/client/game/characters/shared/animationBuilder');
const {slimeLaunch}=require('../src/shared/characters/gloopProjectile');
const definition=require('../src/shared/characters/gloop.json');
const code=babel.transformSync(fs.readFileSync('src/client/game/characters/gloop/anim.js','utf8'),{
  babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]],
}).code;
for(const folder of ['public/assets/gloop','public/assets/gloop/skins/gloop-amethyst']) {
  test(`${folder}: idle closes smoothly and wall-slide has its own pose`,()=>{
    const atlas=JSON.parse(fs.readFileSync(folder+'/animations.json'));
    const names=atlas.frames.map(f=>f.filename);
    const created=new Map(),api={};
    const scene={textures:{exists:()=>true,get:()=>({getFrameNames:()=>names})},
      anims:{exists:key=>created.has(key),get:key=>created.get(key),create:anim=>created.set(anim.key,anim)}};
    vm.runInNewContext(code,{exports:api,require:name=>name.endsWith('movementPhysics.json')?require('../src/shared/physics/movementPhysics.json'):({createAnimationBuilder})});
    api.animations(scene);
    if(folder==='public/assets/gloop')for(const direction of ['dashright','dashdiagonal','dashup']){
      const dash=created.get('gloop-'+direction);
      assert.deepEqual(dash.frames.map(f=>f.frame),names.filter(n=>n.startsWith(direction)));
      assert.ok(dash.frames.length>1);
      assert.equal(dash.repeat,0);
      assert.equal(dash.frames.length/dash.frameRate*1000,require('../src/shared/physics/movementPhysics.json').dashDurationMs);
    }
    const idle=created.get('gloop-idle').frames.map(f=>Number(f.frame.slice(4)));
    for(let i=0;i<idle.length;i++)assert.equal(Math.abs(idle[i]-idle[(i+1)%idle.length]),1);
    assert.equal(created.get('gloop-running').bbMotion.kind,'running');
    assert.equal(created.get('gloop-jumping').bbMotion.kind,'jumping');
    const idleAnimation=created.get('gloop-idle');
    const runAnimation=created.get('gloop-running');
    const idleDuration=idleAnimation.frames.length/idleAnimation.frameRate;
    const runningDuration=runAnimation.frames.length/runAnimation.frameRate;
    assert.ok(idleDuration>runningDuration*2,'idle breath should be much slower than running');
    assert.deepEqual(runAnimation.frames.map(f=>f.frame),names.filter(n=>/^run\d+$/.test(n)));
    assert.deepEqual(created.get('gloop-sliding').frames.map(f=>f.frame),['wall00']);
    assert.equal(created.get('gloop-sliding').repeat,-1);
    assert.deepEqual(created.get('gloop-falling').frames.map(f=>f.frame),['fall00','fall01','fall02']);
    const duck=atlas.frames.find(f=>f.frame.x===128*(definition.duckFrame[0]-1)&&f.frame.y===128*(definition.duckFrame[1]-1));
    assert.equal(duck?.filename,'duck00');
  });
}
test('base Gloop running poses change gradually through the loop seam',async()=>{
  const sharp=require('../spritesheet-generator/node_modules/sharp');
  const atlas=require('../public/assets/gloop/animations.json');
  const {data,info}=await sharp('public/assets/gloop/spritesheet.webp').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const sizes=atlas.frames.filter(f=>/^run\d+$/.test(f.filename)).map(({frame:f})=>{
    let l=f.w,t=f.h,r=-1,b=-1;
    for(let y=0;y<f.h;y++)for(let x=0;x<f.w;x++)if(data[((f.y+y)*info.width+f.x+x)*4+3]){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y);}
    assert.ok(r>=l,'running pose must contain artwork');
    return [r-l+1,b-t+1];
  });
  for(let i=0;i<sizes.length;i++)for(let axis=0;axis<2;axis++){
    const a=sizes[i][axis],b=sizes[(i+1)%sizes.length][axis];
    assert.ok(Math.abs(a-b)/Math.max(a,b)<0.15,'squash should progress gently, including loop seam');
  }
});
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
const registrySource=fs.readFileSync('src/client/game/characters/index.js','utf8');
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
      const context={DUCK_FRAME_CELLS:{gloop:definition.duckFrame},CHARACTER_FRAMES:{gloop:definition.frame},characterPresentation:()=>({}),scene,textureKey};
      vm.runInNewContext(duckSetupSource+'; setupDuckFrame(scene,"gloop",textureKey);',context);
      const frame=frames.get('duck00');
      assert.equal(frame.x,authored.frame.x);
      assert.equal(frame.y,authored.frame.y);
      assert.equal(animations.get(textureKey+'-ducking').frames[0].frame,'duck00');
      assert.equal(animations.get(textureKey+'-ducking').frames[0].key,textureKey);
    });
  }
}
