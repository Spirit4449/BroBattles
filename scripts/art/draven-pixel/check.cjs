// Artifact invariants; no game assets or tests are changed.
const assert=require('node:assert/strict');
const {ROWS,PALETTE}=require('./parts.cjs');
const {compose,pixels,CANVAS,OFFSET}=require('./render.cjs');
const {idlePose,FRAME_COUNT}=require('./idle.cjs');
const rest=compose();
for(let y=0;y<64;y++)for(let x=0;x<64;x++)assert.equal(rest[(y+OFFSET)*CANVAS+x+OFFSET],ROWS[y][x]);
assert.deepEqual(compose(idlePose(0)),compose(idlePose(FRAME_COUNT)));
const unique=new Set();
for(let f=0;f<FRAME_COUNT;f++){
 const a=compose(idlePose(f));unique.add(a.join(''));
 for(let y=0;y<CANVAS;y++)for(let x=0;x<CANVAS;x++){
  const c=a[y*CANVAS+x];assert(c==='.'||PALETTE[c]);
  if(x===0||y===0||x===CANVAS-1||y===CANVAS-1)assert.equal(c,'.','frame clipped');
 }
 const b=pixels(a);for(let i=3;i<b.length;i+=4)assert(b[i]===0||b[i]===255);
 // Deliberate floating shards are multi-pixel; an isolated pixel is a defect.
 for(let y=1;y<CANVAS-1;y++)for(let x=1;x<CANVAS-1;x++)if(a[y*CANVAS+x]!=='.'){
  let neighbors=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&a[(y+dy)*CANVAS+x+dx]!=='.')neighbors++;
  assert(neighbors>0,`stray pixel in frame ${f} at ${x},${y}`);
 }
}
assert.equal(unique.size,8);
console.log('PASS: exact logical rest assembly; eight unique frames; periodic pose; no clipping, antialiasing, unknown colors, or isolated pixels.');
