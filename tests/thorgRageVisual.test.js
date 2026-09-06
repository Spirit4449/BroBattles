const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
const sweep = require('../src/shared/thorgSweep');
const source = fs.readFileSync(require.resolve('../src/characters/thorg/rageVisual.js'), 'utf8')
  .replace('import { THORG_SWEEP } from "../../shared/thorgSweep";', 'const { THORG_SWEEP } = sweep;')
  .replaceAll('export function ', 'function ') + '\nexports.setThorgRageVisual = setThorgRageVisual;';
const exportsObject = {};
vm.runInNewContext(source, { exports: exportsObject, sweep });

test('rage clone keeps physical transform untouched, restores alpha each render, and cleans up', () => {
  const events = new EventEmitter();
  const clone = {destroy(){this.destroyed=true;}};
  for (const method of ['setVisible','setDepth','setTexture','setPosition','setOrigin','setScale','setFlip','setRotation','setAlpha','setTint'])
    clone[method] = function(...args) { this[method+'Args'] = args; return this; };
  const body = Object.assign(new EventEmitter(), {active:true,x:50,y:100,alpha:0.7,scaleX:0.7,scaleY:0.7,originX:0.5,originY:0.5,depth:30,visible:true,texture:{key:'thorg'},frame:{name:'idle00'}});
  const scene = {events,add:{sprite:()=>clone}};
  const setRage = exportsObject.setThorgRageVisual;
  setRage(scene,body,true); setRage(scene,body,true);
  assert.equal(events.listenerCount('prerender'),1);
  events.emit('prerender');
  assert.equal(body.alpha,0);
  assert.equal(body.scaleX,0.7); assert.equal(body.y,100); assert.equal(body.originY,0.5);
  assert.equal(clone.setScaleArgs[0],0.875);
  events.emit('render'); assert.equal(body.alpha,0.7);
  events.emit('prerender'); events.emit('render');
  assert.equal(clone.setScaleArgs[0],0.875);
  setRage(scene,body,false);
  assert.equal(body._thorgVisualScale,1); assert.equal(body.alpha,0.7);
  assert.equal(events.listenerCount('prerender'),0); assert.equal(clone.destroyed,true);
});
