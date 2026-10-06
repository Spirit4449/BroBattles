const test=require('node:test'),assert=require('node:assert/strict');
const {diffUnsaved,discardChanges}=require('../src/client/editor/unsavedChanges');
const clone=v=>JSON.parse(JSON.stringify(v));
const live={label:'Arena',layout:{platforms:[{id:'a',x:10},{id:'b',x:20}]},spawns:{team1:[{x:1,y:2}]},scenery:{scroll:0.1}};
test('shows net differences across sections, no reverted edits',()=>{
 const draft=clone(live);draft.label='Other';draft.label=live.label;draft.layout.platforms[0].x=40;draft.scenery.scroll=0.2;
 const changes=diffUnsaved(live,draft);assert.equal(changes.length,2);assert.deepEqual(discardChanges(draft,changes),live);
 assert.equal(draft.layout.platforms[0].x,40);
});
test('selective discard restores removed object order and preserves unrelated changes',()=>{
 const draft=clone(live);draft.layout.platforms.shift();draft.label='Renamed';
 const changes=diffUnsaved(live,draft);const restored=discardChanges(draft,changes.filter(c=>c.path.at(-1)?.id==='a'));
 assert.deepEqual(restored.layout,live.layout);assert.equal(restored.label,'Renamed');
});
test('added objects and optional settings can be discarded',()=>{
 const draft=clone(live);draft.layout.platforms.push({id:'c',x:30});draft.setting=true;
 assert.deepEqual(discardChanges(draft,diffUnsaved(live,draft)),live);
});
test('array reordering stays explicit without swallowing other changes',()=>{
 const draft=clone(live);draft.label='Renamed';draft.layout.platforms.reverse();
 const changes=diffUnsaved(live,draft);assert.equal(changes.length,2);assert.deepEqual(discardChanges(draft,changes),live);
});
test('positional spawn lists restore as a unit without index shifts',()=>{
 const draft=clone(live);draft.spawns.team1.unshift({x:3,y:4});
 assert.deepEqual(discardChanges(draft,diffUnsaved(live,draft)),live);
});
