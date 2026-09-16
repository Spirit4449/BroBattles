const test=require('node:test'),assert=require('node:assert/strict');
const {diffUnsaved,discardChanges}=require('../src/editor/unsavedChanges');
const clone=v=>JSON.parse(JSON.stringify(v));
const live={label:'Arena',variants:{'1v1':{platforms:[{id:'a',x:10},{id:'b',x:20}],spawns:[{x:1,y:2}]},'2v2':{width:100}}};
test('shows net differences across variants, no reverted edits',()=>{
 const draft=clone(live);draft.label='Other';draft.label=live.label;draft.variants['1v1'].platforms[0].x=40;draft.variants['2v2'].width=200;
 const changes=diffUnsaved(live,draft);assert.equal(changes.length,2);assert.deepEqual(discardChanges(draft,changes),live);
 assert.equal(draft.variants['1v1'].platforms[0].x,40);
});
test('selective discard restores removed object order and preserves unrelated changes',()=>{
 const draft=clone(live);draft.variants['1v1'].platforms.shift();draft.label='Renamed';
 const changes=diffUnsaved(live,draft);const restored=discardChanges(draft,changes.filter(c=>c.path.at(-1)?.id==='a'));
 assert.deepEqual(restored.variants,live.variants);assert.equal(restored.label,'Renamed');
});
test('added objects and optional settings can be discarded',()=>{
 const draft=clone(live);draft.variants['1v1'].platforms.push({id:'c',x:30});draft.setting=true;
 assert.deepEqual(discardChanges(draft,diffUnsaved(live,draft)),live);
});
test('array reordering stays explicit without swallowing other changes',()=>{
 const draft=clone(live);draft.label='Renamed';draft.variants['1v1'].platforms.reverse();
 const changes=diffUnsaved(live,draft);assert.equal(changes.length,2);assert.deepEqual(discardChanges(draft,changes),live);
});
test('positional spawn lists restore as a unit without index shifts',()=>{
 const draft=clone(live);draft.variants['1v1'].spawns.unshift({x:3,y:4});
 assert.deepEqual(discardChanges(draft,diffUnsaved(live,draft)),live);
});
