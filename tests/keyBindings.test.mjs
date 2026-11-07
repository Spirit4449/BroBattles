import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BINDINGS, normalizeBindings, assignBinding, eventKeyCode } from "../src/client/site/keyBindings.mjs";
import { updateControlsGuide, bindingEventCode } from "../src/client/site/controlsGuide.mjs";

describe("Binding preferences", () => {
  test('missing or corrupt bindings preserve all default controls',()=>{
   for(const value of [null,{}, {left:27},{...DEFAULT_BINDINGS,left:68}])assert.deepEqual(normalizeBindings(value),DEFAULT_BINDINGS);
  });
  test('remapping persists valid replacements without mutating defaults',()=>{
   const result=assignBinding(DEFAULT_BINDINGS,'attack',75);
   assert.equal(result.attack,75);assert.equal(DEFAULT_BINDINGS.attack,74);
   assert.deepEqual(normalizeBindings(JSON.parse(JSON.stringify(result))),result);
  });
  test('duplicate controls and browser navigation keys are rejected',()=>{
   for(const code of [65,27,9,17,91,undefined])assert.throws(()=>assignBinding(DEFAULT_BINDINGS,'attack',code));
   assert.throws(()=>assignBinding(DEFAULT_BINDINGS,'unknown',75));
  });
  test('physical keyboard codes map independently of keyboard character case',()=>{
   assert.equal(eventKeyCode({code:'KeyK',key:'k'}),75);
   assert.equal(eventKeyCode({code:'Digit2'}),50);
   assert.equal(eventKeyCode({code:'ArrowLeft'}),37);
   assert.equal(eventKeyCode({code:'Space'}),32);
   assert.equal(eventKeyCode({code:'Escape'}),undefined);
  });
  test('alternate arrows and space remain fixed when loading saved preferences',()=>{
   const saved={...DEFAULT_BINDINGS,leftAlt:80,jump:79};
   assert.equal(normalizeBindings(saved).leftAlt,37);
   assert.equal(normalizeBindings(saved).dash,32);
   assert.throws(()=>assignBinding(DEFAULT_BINDINGS,'leftAlt',80));
  });

  test('legacy jump preferences migrate to dash without losing remapped controls', () => {
   const saved = {...DEFAULT_BINDINGS, attack:75, jump:32}; delete saved.dash;
   const migrated = normalizeBindings(saved);
   assert.equal(migrated.attack,75); assert.equal(migrated.dash,32);
   assert.equal(migrated.jump,undefined);
  });
});

describe("Controls guide", () => {
  test('guide updates labels and pressed-key tracking after remapping and reset',()=>{
   const keys=['up','attack','special','leftAlt'].map(binding=>({dataset:{binding},classList:{remove(value){assert.equal(value,'is-pressed');}}}));
   const root={querySelectorAll:()=>keys};
   updateControlsGuide(root,{keys:{...DEFAULT_BINDINGS,up:84,attack:75,special:49}});
   assert.deepEqual(keys.map(k=>[k.textContent,k.dataset.code]),[['T','KeyT'],['K','KeyK'],['1','Digit1'],['←','ArrowLeft']]);
   updateControlsGuide(root,{keys:DEFAULT_BINDINGS});
   assert.deepEqual(keys.slice(0,3).map(k=>k.textContent),['W','J','I']);
   assert.equal(bindingEventCode(32),'Space');
  });
});
