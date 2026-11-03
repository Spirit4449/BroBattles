// Rasterize detailed art at native resolution; add one outline after deforming.
const fs=require('node:fs');
const path=require('node:path');
const sharp=require('../../spritesheet-generator/node_modules/sharp');
const root=path.resolve(__dirname,'../..'),work=path.join(root,'output/gloop-hq'),assets=path.join(root,'public/assets/gloop');
function bounds(data,W,x,y,w,h){let l=w,t=h,r=-1,b=-1;for(let j=0;j<h;j++)for(let i=0;i<w;i++)if(data[((y+j)*W+x+i)*4+3]>200){l=Math.min(l,i);t=Math.min(t,j);r=Math.max(r,i);b=Math.max(b,j);}if(r<0)throw Error('Empty pose');return {left:x+l,top:y+t,width:r-l+1,height:b-t+1};}
const isBody=(d,i)=>d[i+3]>180&&Math.max(d[i],d[i+1],d[i+2])>60;
async function main(){
 const atlas=JSON.parse(fs.readFileSync(path.join(work,'before.json')));
 const raw=await sharp(path.join(assets,'body.webp')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 // Use the canonical portrait, not the earlier generated approximation.
 // Strip baked black outlines BEFORE resizing/warping; draw a uniform new edge last.
 for(let i=0;i<raw.data.length;i+=4)if(!isBody(raw.data,i))raw.data[i+3]=0;
 const c=bounds(raw.data,raw.info.width,0,0,raw.info.width,raw.info.height);
 const sourceMaster=await sharp(raw.data,{raw:raw.info}).extract(c).resize(192,128,{fit:'fill',kernel:'nearest'}).raw().toBuffer();
 // Shorten only the crown's top tier by one native sprite pixel.
 // Four master rows correspond to about one row in the 31px resting body.
 const master=Buffer.from(sourceMaster);
 master.fill(0,0,192*4*4);
 for(const [group,prefix] of ['dashright','dashdiagonal','dashup'].entries())for(let i=0;i<3;i++)atlas.frames.push({filename:prefix+'0'+i,frame:{x:(group*3+i)*128,y:640,w:128,h:128},rotated:false,trimmed:false,spriteSourceSize:{x:0,y:0,w:128,h:128},sourceSize:{w:128,h:128}});
 const layers=[];
 for(const f of atlas.frames.filter(f=>f.frame.h===128)){
  const run=f.filename.startsWith('run'),idle=f.filename.startsWith('idle'),attack=f.filename.startsWith('attack'),fall=f.filename.startsWith('fall'),jump=f.filename.startsWith('jump'),wall=f.filename==='wall00',duck=f.filename==='duck00';
  const dash=f.filename.startsWith('dash');
  const dashUp=f.filename.startsWith('dashup'),dashDiagonal=f.filename.startsWith('dashdiagonal');
  const n=Number(f.filename.replace(/\D/g,'')),phase=run?2*Math.PI*n/10:Math.PI*n/7;
  let w,h,left,top;
  if(run||idle){w=Math.round(47+(run?3.5:0.7)*Math.sin(phase));h=run?Math.round(47*31/w):Math.round(31-0.6*Math.sin(phase));left=Math.floor((128-w)/2);top=127-h;}
  else{
   // All states deform the same volume and keep the same foot registration.
   if(attack){w=[47,49,47,44,45,48,49,48,47][n];h=Math.round(47*31/w);}
   if(fall){w=[44,43,41][n];h=[32,33,35][n];}
   if(jump){w=[40,41,42,43,44][n];h=[36,35,34,33,32][n];}
   if(dash){
    // Preserve upright artwork; trade width for height rather than enlarging it.
    w=dashUp?[41,34,40][n]:dashDiagonal?[43,43,43][n]:[50,55,49][n];
    h=dashUp?[34,40,35][n]:dashDiagonal?[32,32,32][n]:[27,24,28][n];
   }
   if(duck){w=51;h=26;}
   if(wall){w=43;h=33;}
   left=wall?79-w:Math.floor((128-w)/2);top=127-h;
  }
  const pixels=Buffer.alloc(128*128*4),mask=new Uint8Array(128*128);
  for(let yy=0;yy<h;yy++)for(let xx=-8;xx<w+10;xx++){
   const v=yy/Math.max(1,h-1),u=xx/Math.max(1,w-1);
   // The crown rolls forward while the lower goo trails, instead of scaling as a rigid dome.
   const throwShift=attack?[0,-2,2,6,5,2,-1,0,0][n]:0;
   const sway=run?(1.5+2.8*Math.sin(phase))*(1-v)**1.5-0.7*Math.sin(phase-0.6)*v**3:dash?(dashUp?0:(dashDiagonal?[3,8,3][n]:[1.5,4,1.5][n]))*(1-v)**1.5:throwShift*(0.75*(1-v)+0.65*Math.sin(Math.PI*v))*(1-v);
   // Round the underside in flight; keep wall contact on the right side only.
   const roundness=wall?2.5:0;
   const across=Math.min(1,Math.abs(2*u-1));
   const underside=roundness*(1-Math.sqrt(1-across*across))*v**3;
   const ripple=run?0.9*Math.sin(phase+u*Math.PI*2)*Math.sin(Math.PI*u)**2:
    attack?[0,-0.5,0.5,1,-0.8,0.5,-0.3,0.1,0][n]*Math.sin(2*Math.PI*u)*(1-v):0;
   let su=(xx-sway)/Math.max(1,w-1),sv=(yy-ripple+underside)/Math.max(1,h-1);
   // Compression travels through the jelly rather than affecting every row at once.
   const swell=dash?(dashUp?[-0.03,-0.10,-0.04][n]:[0.02,0.08,0.03][n]):jump?[-0.03,-0.02,-0.01,0,0][n]:attack?[0,0.02,-0.02,0.08,0.05,-0.03,0.02,-0.01,0][n]:0;
   su=0.5+(su-0.5)/(1+swell*Math.sin(2*Math.PI*v));
   if(wall){if(xx<0||xx>=w)continue;su*=0.84;}
   // During descent the upper surface trails slightly; retain a rounded,
   // fuller leading underside instead of flattening into an airborne pancake.
   if(fall)su=0.5+(su-0.5)/(1-(0.03+0.02*n)*(1-v));
   if(su<0||su>1)continue;
   if(jump||fall||dash){
    // Morph the dome into a genuine ellipse, column by column. The old
    // corner lift left a long flat base; this curves the whole underside.
    const column=Math.min(191,Math.round(su*191));
    let first=0;while(first<128&&master[(first*192+column)*4+3]<180)first++;
    if(first===128)continue;
    const blend=dash?(dashUp?0.75:dashDiagonal?0.5:0.35):1;
    const radius=Math.sqrt(Math.max(0,1-(2*su-1)**2));
    const ellipseTop=(h-1)*(1-radius)/2,ellipseBottom=(h-1)*(1+radius)/2;
    // Takeoff stretches along the vertical impulse. Its lower half lags
    // slightly, then relaxes without introducing lateral forces or oscillation.
    const taper=jump?[0.035,0.025,0.015,0.005,0][n]:0;
    const upper=(1-blend)*first/127*(h-1)+blend*ellipseTop;
    const lower=(1-blend)*(h-1)+blend*ellipseBottom;
    const airborneY=yy-taper*(h-1)*Math.sin(Math.PI*su)**2*(1-v);
    if(airborneY<upper||airborneY>lower||lower-upper<0.01)continue;
    sv=first/127+(airborneY-upper)/(lower-upper)*(1-first/127);
   }
   if(sv<0||sv>1)continue;
   const sx=Math.min(191,Math.round(su*191)),sy=Math.min(127,Math.round(sv*127)),si=(sy*192+sx)*4;
   let inside=master[si+3]>180;
   if(!inside)continue;
   const x=left+xx,y=top+yy;if(x<1||x>126||y<1||y>126)continue;
   const di=(y*128+x)*4;mask[y*128+x]=1;
   // A narrow flat palette retains body.webp's small square facets and bubbles.
   for(let k=0;k<3;k++)pixels[di+k]=master[si+k];
   if(master[si+3]<180){pixels[di]=40;pixels[di+1]=180;pixels[di+2]=183;}
   pixels[di+3]=255;
  }
  // Four-neighbour one-native-pixel contour, identical for idle, run, and throw.
  const outlined=Buffer.from(pixels);
  for(let y=1;y<127;y++)for(let x=1;x<127;x++)if(mask[y*128+x])for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
   const j=(y+dy)*128+x+dx;if(!mask[j]){outlined[j*4]=0;outlined[j*4+1]=0;outlined[j*4+2]=0;outlined[j*4+3]=255;}
  }
  const input=await sharp(outlined,{raw:{width:128,height:128,channels:4}}).png().toBuffer();layers.push({input,left:f.frame.x,top:f.frame.y});
  await sharp(input).resize(512,512,{kernel:'nearest'}).png().toFile(path.join(work,f.filename+'.png'));
 }
 atlas.meta.size={w:1280,h:768};atlas.meta.image='spritesheet.webp';
 await sharp({create:{width:1280,height:768,channels:4,background:'#00000000'}}).composite(layers).webp({lossless:true}).toFile(path.join(assets,'spritesheet.webp'));
 fs.writeFileSync(path.join(assets,'animations.json'),JSON.stringify(atlas)+'\n');
 await sharp(path.join(assets,'spritesheet.webp')).flatten({background:'#686c78'}).png().toFile(path.join(work,'preview-v4.png'));
 console.log('Packed detailed native-resolution poses with uniform 1px contour.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
