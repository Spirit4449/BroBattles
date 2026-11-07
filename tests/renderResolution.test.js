const { loadClientModule } = require('./helpers/clientModule');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');




describe("Backing resolution", () => {
  const { EventEmitter } = require('node:events');

  const exportsObject = {};
  loadClientModule('src/client/game/scene/renderResolution.js', {exports:exportsObject,require:()=>({installHighResolutionCanvas:()=> 'canvas-adapter'})});
  const { installRenderResolution } = exportsObject;
  const releaseExports = {};
  loadClientModule('src/client/game/scene/releaseRenderer.js', {exports:releaseExports});
  const { releaseRendererContext, rendererContextOf } = releaseExports;
  const Phaser = {CANVAS:1,WEBGL:2,Scale:{Events:{RESIZE:'resize'}},Core:{Events:{DESTROY:'destroy'}}};
  test('WebGL scales screen viewport/scissors but not offscreen targets or logical coordinates',()=>{
    const calls=[];
    const gl={FRAMEBUFFER:1,MAX_VIEWPORT_DIMS:2,MAX_RENDERBUFFER_SIZE:3,
      viewport(...args){calls.push(['viewport',...args]);},scissor(...args){calls.push(['scissor',...args]);},bindFramebuffer(){},
      getParameter(key){return key===2?[4096,4096]:4096;}};
    const viewport=gl.viewport;
    const renderer=Object.assign(new EventEmitter(),{type:2,gl,drawingBufferHeight:200,
      resize(w,h){this.width=w;this.height=h;gl.viewport(0,0,w,h);gl.scissor(0,game.canvas.height-h,w,h);}});
    const game={renderer,canvas:{width:400,height:200,style:{}},scale:Object.assign(new EventEmitter(),{baseSize:{width:400,height:200}}),events:new EventEmitter()};
    const adapter=installRenderResolution(game,Phaser,Math.SQRT2);
    assert.deepEqual([game.canvas.width,game.canvas.height],[566,283]);
    assert.deepEqual([renderer.width,renderer.height],[400,200]);
    assert.deepEqual(calls.at(-1),['scissor',0,0,566,283]);
    gl.bindFramebuffer(1,{});renderer.drawingBufferHeight=64;
    gl.viewport(0,0,64,64);assert.deepEqual(calls.at(-1),['viewport',0,0,64,64]);
    assert.equal(renderer.drawingBufferHeight,64);
    gl.bindFramebuffer(1,null);assert.equal(renderer.drawingBufferHeight,200);
    adapter.setScale(2);assert.deepEqual([game.canvas.width,game.canvas.height],[800,400]);
    game.scale.baseSize={width:500,height:250};game.scale.emit('resize');
    assert.deepEqual([game.canvas.width,game.canvas.height],[1000,500]);
    game.events.emit('destroy');assert.equal(gl.viewport,viewport);assert.equal(game.scale.listenerCount('resize'),0);
  });
  test('Canvas uses the existing adapter',()=>{
   assert.equal(installRenderResolution({renderer:{type:1}},Phaser,2),'canvas-adapter');
  });

  test('a lost context is left alone instead of being resized',()=>{
    const calls=[];
    const gl={FRAMEBUFFER:1,MAX_VIEWPORT_DIMS:2,MAX_RENDERBUFFER_SIZE:3,
      viewport(){},scissor(){},bindFramebuffer(){},getParameter(key){return key===2?[4096,4096]:4096;},
      isContextLost:()=>false};
    const renderer=Object.assign(new EventEmitter(),{type:2,gl,drawingBufferHeight:200,contextLost:false,
      resize(w,h){calls.push([w,h]);}});
    const game={renderer,canvas:{width:400,height:200,style:{}},scale:Object.assign(new EventEmitter(),{baseSize:{width:400,height:200}}),events:new EventEmitter()};
    installRenderResolution(game,Phaser,1);
    assert.equal(calls.length,1);
    renderer.contextLost=true;
    game.scale.baseSize={width:500,height:250};game.scale.emit('resize');
    assert.equal(calls.length,1);
  });
  test('a destroyed game hands its WebGL context back',()=>{
    let lost=false;
    const gl={isContextLost:()=>lost,getExtension:name=>name==='WEBGL_lose_context'?{loseContext(){lost=true;}}:null};
    const game={renderer:{gl}};
    assert.equal(rendererContextOf(game),gl);
    assert.equal(releaseRendererContext(rendererContextOf(game)),true);
    assert.equal(lost,true);
    // Nothing to give back a second time, or for a canvas-rendered game.
    assert.equal(releaseRendererContext(gl),false);
    assert.equal(rendererContextOf({renderer:{}}),null);
    assert.equal(releaseRendererContext(null),false);
  });
});

describe("Viewport sizing", () => {
  const exported = {};
  loadClientModule(require.resolve('../src/client/game/scene/gameViewport.js'), { exports: exported, Math });
  const { fitGameSize, GAME_VIEW } = exported;

  const fills = (size, w, h) => Math.abs(size.width / size.height - w / h) < 0.01;

  test('common windows fill the screen without bezels', () => {
    for (const [w, h] of [[1920, 1080], [1440, 900], [1024, 768], [1280, 1024], [2340, 1080], [2560, 1080]]) {
      assert.ok(fills(fitGameSize(w, h), w, h), `${w}x${h}`);
    }
  });

  test('filling trims the view instead of showing more than the arena', () => {
    for (const [w, h] of [[1024, 768], [2560, 1080], [800, 1000], [3840, 1080]]) {
      const size = fitGameSize(w, h);
      assert.ok(size.width <= GAME_VIEW.width && size.width >= GAME_VIEW.minWidth, `${w}x${h} width`);
      assert.ok(size.height <= GAME_VIEW.maxHeight && size.height >= GAME_VIEW.minHeight, `${w}x${h} height`);
    }
    // A 4:3 window trims the sides rather than letterboxing.
    assert.ok(fitGameSize(1024, 768).width < GAME_VIEW.width);
  });

  test('extreme windows stop trimming and leave room for bezels', () => {
    const portrait = fitGameSize(390, 844);
    assert.equal(portrait.width, GAME_VIEW.minWidth);
    assert.ok(portrait.width / portrait.height > 390 / 844);
    const superWide = fitGameSize(5120, 1440);
    assert.equal(superWide.height, GAME_VIEW.minHeight);
    assert.ok(superWide.width / superWide.height < 5120 / 1440);
  });
});
