const {SIZE,PALETTE,PARTS,ORDER}=require('./parts.cjs');
const CANVAS=72, OFFSET=4;
// Inverse sampling only, snapped to the logical grid. No bilinear filtering or
// rotation of the face/hand: their clusters must remain intact.
function compose(pose={}){
 const out=Array(CANVAS*CANVAS).fill('.');
 for(const name of ORDER){const map=pose[name]||((x,y)=>[x,y]);const rows=PARTS[name];
  for(let y=0;y<CANVAS;y++)for(let x=0;x<CANVAS;x++){
   const [u,v]=map(x-OFFSET+.5,y-OFFSET+.5);let sx=Math.floor(u),sy=Math.floor(v);
   const ch=rows[sy]?.[sx];if(ch&&ch!=='.')out[y*CANVAS+x]=ch;
  }
 }
 // Close only newly enclosed pinholes. Do not grow a global outline: the
 // original's 1px contour and intentional negative spaces are preserved.
 const original=out.slice();
 for(let y=1;y<CANVAS-1;y++)for(let x=1;x<CANVAS-1;x++){
  let i=y*CANVAS+x;if(original[i]!=='.')continue;
  const ns=[original[i-1],original[i+1],original[i-CANVAS],original[i+CANVAS]];
  if(ns.every(c=>c!=='.')&&ns.filter(c=>c!=='A').length>=3)out[i]=ns.find(c=>c!=='A');
 }
 return out;
}
function pixels(chars){const b=Buffer.alloc(chars.length*4);chars.forEach((c,i)=>{if(PALETTE[c]){b.set(PALETTE[c],i*4);b[i*4+3]=255}});return b;}
module.exports={compose,pixels,CANVAS,OFFSET};
