// Logical coordinates match the transcribed portrait. Parts are disjoint in
// rest pose; the renderer samples each layer independently when posed.
const {size, palette, rows}=require('./pixels.cjs');
const JOINTS={neck:[27,33],leftShoulder:[20,34],leftWrist:[17,46],rightShoulder:[31,35],grip:[41,39],waist:[28,44],ground:63,staff:[40,40]};
function owner(x,y){
 if(y<29&&x>=33){
  if(x<=39&&y<=14)return 'shardLeft';
  if(x>=48)return 'shardRight';
  if(x>=40&&y<=20)return 'crystal';
  return 'flame';
 }
 if(x>=37&&y>=29){if(x>=39&&y>=37&&y<=41)return 'grip';return 'staff';}
 if(y<=32)return 'hood';
 if(y>=33&&y<=50&&x<=(y>=48?18:y>=45?20:22)){if(y>=45)return 'leftHand';return 'leftSleeve';}
 if(x>=32&&y<=43)return 'rightSleeve';
 if(y>=44)return 'robe';
 return 'torso';
}
const ORDER=['robe','torso','hood','leftSleeve','leftHand','rightSleeve','staff','grip','flame','crystal','shardLeft','shardRight'];
const PARTS=Object.fromEntries(ORDER.map(name=>[name,rows.map((r,y)=>[...r].map((ch,x)=>owner(x,y)===name?ch:'.').join(''))]));
module.exports={SIZE:size,PALETTE:palette,ROWS:rows,PARTS,ORDER,JOINTS,owner};
