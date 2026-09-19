"""Mechanically pack generated RGBA art; preserve alpha and use nearest sampling."""
from PIL import Image, ImageDraw
from pathlib import Path
import json, shutil
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/team-combat-art'
manifest=json.loads((OUT/'manifest.json').read_text())
previews=[]
for job in manifest:
    name=job['name']; source=OUT/(name+'-source.png')
    if not source.exists(): shutil.copyfile(job['source'],source)
    im=Image.open(source).convert('RGBA'); wizard=name.startswith('wizard'); explosion='explosion' in name
    rows=3 if explosion else 4
    cells=[]
    for n in range(rows*4):
        # Blue ignition frames extend below the nominal generated row division.
        bounds=[0,350,660,957,1254] if name=='wizard-blue' else [round(i*im.height/rows) for i in range(rows+1)]
        cell=im.crop((round(n%4*im.width/4),bounds[n//4],round((n%4+1)*im.width/4),bounds[n//4+1]))
        box=cell.getchannel('A').point(lambda a:255 if a>80 else 0).getbbox()
        assert box, (name,n)
        cells.append(cell.crop(box))
    if wizard:
        cw,ch=156,314; maxw,maxh=124,220
        indices=[min(3,n//4) if n<16 else 4+((n-16)*12//16) for n in range(32)]
        names=[f'fire{n:02}' for n in range(32)]
        target='wizard/fireball-bb'+('-red' if name.endswith('red') else '')
    else:
        cw=ch=64 if explosion else 288; maxw=maxh=cw-(8 if explosion else 32)
        indices=list(range(len(cells))); names=[('explosion' if explosion else 'sprite')+str(n+1) for n in indices]
        target='draven/'+('explosion' if explosion else 'special')+'-bb'+('-red' if name.endswith('red') else '')
    scale=min(maxw/max(c.width for c in cells),maxh/max(c.height for c in cells))
    sheet=Image.new('RGBA',(cw*8,ch*((len(indices)+7)//8)))
    frames=[]
    for n,i in enumerate(indices):
        c=cells[i]; size=(max(1,round(c.width*scale)),max(1,round(c.height*scale)))
        c=c.resize(size,Image.Resampling.NEAREST)
        left=(cw-c.width)//2; top=(ch-24-c.height) if wizard else (ch-c.height)//2
        assert left>=0 and top>=0
        x=n%8*cw;y=n//8*ch
        sheet.alpha_composite(c,(x+left,y+top))
        frames.append(dict(filename=names[n],frame=dict(x=x,y=y,w=cw,h=ch),rotated=False,trimmed=False,spriteSourceSize=dict(x=0,y=0,w=cw,h=ch),sourceSize=dict(w=cw,h=ch)))
    path=ROOT/'public/assets'/target
    sheet.save(str(path)+'.webp',lossless=True,exact=True)
    Path(str(path)+'.json').write_text(json.dumps({'frames':frames,'meta':{'image':path.name+'.webp','size':{'w':sheet.width,'h':sheet.height}}},indent=2)+'\n')
    job['installed']=str(path.relative_to(ROOT))+'.webp'
    preview=sheet.crop((0 if wizard else cw*5, ch*2 if wizard else 0, cw if wizard else cw*6,ch*3 if wizard else ch)).resize((156,314),Image.Resampling.NEAREST) if wizard else sheet.crop((cw*5,0,cw*6,ch)).resize((216,216),Image.Resampling.NEAREST)
    previews.append((name,preview))
    print(name,sheet.size,len(frames))
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
board=Image.new('RGB',(960,700),'#263344');d=ImageDraw.Draw(board)
for n,(name,im) in enumerate(previews):
 x=(n%3)*320;y=(n//3)*350
 d.text((x+12,y+12),name,fill='white');board.paste(im,(x+(320-im.width)//2,y+32),im)
board.save(OUT/'preview.png')
