const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const babel = require('@babel/core');
const exportsObject = {};
vm.runInNewContext(babel.transformSync(fs.readFileSync('src/gameScene/renderResolution.js','utf8'), {
  babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]],
}).code, {exports:exportsObject,require:()=>({installHighResolutionCanvas:()=> 'canvas-adapter'})});
const { installRenderResolution } = exportsObject;
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
