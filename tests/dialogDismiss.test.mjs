import test from 'node:test';
import assert from 'node:assert/strict';
import { wireBackdropDismiss, wireOutsideDismiss } from '../src/site/dialogDismiss.mjs';
function setup() {
  const handlers={};let closed=0;
  const dialog={addEventListener:(name,fn)=>handlers[name]=fn,getBoundingClientRect:()=>({left:100,right:500,top:100,bottom:500}),close:()=>closed++};
  wireBackdropDismiss(dialog);
  return {dialog,emit:(name,patch={})=>handlers[name]({target:dialog,clientX:50,clientY:50,button:0,isPrimary:true,...patch}),closed:()=>closed};
}
test('releasing a slider drag outside does not dismiss the popup',()=>{
  const f=setup();f.emit('pointerdown',{target:{type:'range'},clientX:200,clientY:200});f.emit('click');assert.equal(f.closed(),0);
});
test('a real backdrop click still dismisses',()=>{
  const f=setup();f.emit('pointerdown');f.emit('click');assert.equal(f.closed(),1);
});
test('backdrop press ending inside and cancelled gestures do not dismiss',()=>{
  const f=setup();f.emit('pointerdown');f.emit('click',{clientX:200,clientY:200});assert.equal(f.closed(),0);
  f.emit('pointerdown');f.emit('pointercancel');f.emit('click');assert.equal(f.closed(),0);
});

function setupOutsideDismiss() {
  const documentHandlers={};const dialogHandlers={};let closed=0;
  const eventTarget={
    addEventListener:(name,fn)=>documentHandlers[name]=fn,
    removeEventListener:(name,fn)=>{if(documentHandlers[name]===fn)delete documentHandlers[name];},
  };
  const inside={};
  const dialog={
    addEventListener:(name,fn)=>dialogHandlers[name]=fn,
    contains:target=>target===dialog || target===inside,
    close:()=>closed++,
  };
  wireOutsideDismiss(dialog,eventTarget);
  const emit=(name,target={})=>documentHandlers[name]?.({target,button:0,isPrimary:true});
  return {dialog,inside,emit,close:()=>dialogHandlers.close?.(),closed:()=>closed,handlers:documentHandlers};
}

test('an outside click dismisses a non-modal popup',()=>{
  const f=setupOutsideDismiss();f.emit('pointerdown');f.emit('click');assert.equal(f.closed(),1);
});

test('clicks and drags beginning inside a non-modal popup do not dismiss it',()=>{
  const f=setupOutsideDismiss();f.emit('pointerdown',f.inside);f.emit('click');assert.equal(f.closed(),0);
  f.emit('pointerdown');f.emit('click',f.inside);assert.equal(f.closed(),0);
});

test('non-modal outside dismissal listeners are removed when the popup closes',()=>{
  const f=setupOutsideDismiss();f.close();assert.deepEqual(f.handlers,{});
});
