const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
// Arrays with stable IDs are compared by object; positional lists remain one edit.
function diffUnsaved(live, draft, path = [], changes = []) {
  if(equal(live,draft))return changes;
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  if(object(live)&&object(draft)) {
    for(const key of new Set([...Object.keys(live),...Object.keys(draft)]))diffUnsaved(live[key],draft[key],[...path,key],changes);
  } else if(Array.isArray(live)&&Array.isArray(draft)&&[...live,...draft].every(v=>object(v)&&typeof v.id==='string') && new Set(live.map(v=>v.id)).size===live.length && new Set(draft.map(v=>v.id)).size===draft.length) {
    const before=live.map(v=>v.id),after=draft.map(v=>v.id);
    for(const id of new Set([...before,...after])) {
      const a=live.find(v=>v.id===id),b=draft.find(v=>v.id===id);
      if(!equal(a,b))changes.push({path:[...path,{id}],before:copy(a),after:copy(b),order:before});
    }
    // Reordering can affect rendering; keep that change explicit and atomic.
    if(!equal(before.filter(id=>after.includes(id)),after.filter(id=>before.includes(id)))) {
      for(let i=changes.length-1;i>=0;i--)if(changes[i].path.length===path.length+1&&equal(changes[i].path.slice(0,-1),path))changes.splice(i,1);
      changes.push({path,before:copy(live),after:copy(draft)});
    }
  } else changes.push({path,before:copy(live),after:copy(draft)});
  return changes;
}
function discardChanges(draft, changes) {
  const result=copy(draft);
  for(const change of changes){
    let parent=result;
    for(const key of change.path.slice(0,-1))parent=parent[key];
    const key=change.path.at(-1);
    if(typeof key==='object') {
      const index=parent.findIndex(v=>v.id===key.id);
      if(change.before===undefined){if(index>=0)parent.splice(index,1);}
      else if(index>=0)parent[index]=copy(change.before);
      else {
        const next=change.order.slice(change.order.indexOf(key.id)+1).find(id=>parent.some(v=>v.id===id));
        parent.splice(next===undefined?parent.length:parent.findIndex(v=>v.id===next),0,copy(change.before));
      }
    }else if(change.before===undefined)delete parent[key];
    else parent[key]=copy(change.before);
  }
  return result;
}
module.exports={diffUnsaved,discardChanges};
