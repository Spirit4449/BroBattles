import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BINDINGS} from '../src/site/keyBindings.mjs';
import {updateControlsGuide,bindingEventCode} from '../src/site/controlsGuide.mjs';
test('guide updates labels and pressed-key tracking after remapping and reset',()=>{
 const keys=['up','attack','special','leftAlt'].map(binding=>({dataset:{binding},classList:{remove(value){assert.equal(value,'is-pressed');}}}));
 const root={querySelectorAll:()=>keys};
 updateControlsGuide(root,{keys:{...DEFAULT_BINDINGS,up:84,attack:75,special:49}});
 assert.deepEqual(keys.map(k=>[k.textContent,k.dataset.code]),[['T','KeyT'],['K','KeyK'],['1','Digit1'],['←','ArrowLeft']]);
 updateControlsGuide(root,{keys:DEFAULT_BINDINGS});
 assert.deepEqual(keys.slice(0,3).map(k=>k.textContent),['W','J','I']);
 assert.equal(bindingEventCode(32),'Space');
});
