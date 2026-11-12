"""Draw chat reaction SVGs on a shared 16px grid. Run from any directory."""
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / 'public/assets/chat-reactions'
PALETTE = {'X':'#101426', 'g':'#efad37', 'Y':'#ffd45a', 'L':'#fff09b',
           's':'#cb7a29', 'B':'#3d91eb', 'b':'#2055a3', 'W':'#f7f9ff',
           'r':'#ec454e', 'R':'#ff7980', 'd':'#ac283b', 't':'#84e5ff', 'o':'#ff8137'}

def grid(rows):
    return [list(row.ljust(16, '.')) for row in rows]

def face():
    return grid(['................','.....XXXXXX.....','...XXLLLLLLXX...',
                 '..XLLYYYYYYYYX..','.XLYYYYYYYYYYgX.', '.XLYYYYYYYYYYgX.',
                 '.XYYYYYYYYYYYgX.', '.XYYYYYYYYYYYgX.', '.XYYYYYYYYYYYgX.',
                 '.XYYYYYYYYYYYgX.', '.XYYYYYYYYYYYgX.', '.XgYYYYYYYYYgsX.',
                 '..XggYYYYYggsX..', '...XXggggssXX...', '.....XXXXXX.....', '................'])

def rect(a,x,y,w,h,c):
    for yy in range(y,y+h):
        for xx in range(x,x+w):
            a[yy][xx]=c

thumb = grid(['................','.......XXX......','......XLLYX.....','......XLYYX.....',
              '......XLYgX.....','.....XLYYgXXXXX.', '....XLYYYYYYYgX.', '.XXXXYYYYYYYYgX.',
              '.XBBXYYYYYYYYgX.', '.XBLXYYYYYYYYgX.', '.XBBXYYYYYYYYgX.', '.XBBXgYYYYYYgsX.',
              '.XbbXggggggssX..', '.XXXXXXXXXXXX...', '................', '................'])
heart = grid(['................','................','..XXXX....XXXX..','.XRRrrX..XrrrrdX',
              '.XRWWrrXXrrrrrdX','.XRWrrrrrrrrrrdX','.XrrrrrrrrrrrrdX','..XrrrrrrrrrrdX.',
              '..XrrrrrrrrrrdX.','...XrrrrrrrrdX..','....XrrrrrrdX...','.....XddddX.....',
              '......XXXX......','................','................','................'])
fire = grid(['................','........XX......','.......XoX......','......XroX......',
             '......XroXX.....','....XXroooX.....','...XrrooooX.X...', '..XrroooooXXrX..',
             '..XroooYooorrX..','.XrrooYYYooorrX.','.XrooYYLYYooorX.','.XrooYLLLYooorX.',
             '..XooYLLLYoorX..','...XooYYYoorX...','....XXrrddXX....','......XXXX......'])
laugh=face()
# Inward squinting eyes and a broad toothy grin, without blue tears.
# All expression pixels stay inside the shared round face silhouette.
for x, direction in ((4,1),(11,-1)):
    rect(laugh,x,5,1,1,'X')
    rect(laugh,x+direction,6,1,1,'X')
    rect(laugh,x,7,1,1,'X')
rect(laugh,4,9,8,2,'X')
rect(laugh,5,9,6,1,'W')
rect(laugh,5,11,6,1,'X')
rect(laugh,6,11,4,1,'r')
rect(laugh,6,12,4,1,'X')

cry=face()
# Raised inner brows, streaming blue tears, and a small downturned mouth.
rect(cry,5,4,1,1,'X');rect(cry,4,5,1,1,'X')
rect(cry,10,4,1,1,'X');rect(cry,11,5,1,1,'X')
rect(cry,3,7,3,1,'X');rect(cry,10,7,3,1,'X')
for x in (4,10):
    rect(cry,x,8,2,5,'B');rect(cry,x,8,1,5,'t');rect(cry,x,8,2,1,'W')
rect(cry,7,10,2,1,'X')
rect(cry,6,11,1,1,'X');rect(cry,9,11,1,1,'X')

# Expression changes must never alter the matching circular outlines.
assert [[c != '.' for c in row] for row in laugh] == [[c != '.' for c in row] for row in cry]

OUT.mkdir(parents=True,exist_ok=True)
for name,a in {'like':thumb,'dislike':list(reversed(thumb)),'heart':heart,'laugh':laugh,'cry':cry,'fire':fire}.items():
    assert len(a)==16 and all(len(row)==16 for row in a), name
    # Merge adjacent horizontal cells for tiny assets with exact square edges.
    parts=[]
    for y,row in enumerate(a):
        x=0
        while x<16:
            c=row[x];end=x+1
            while end<16 and row[end]==c:end+=1
            if c!='.':parts.append(f'<path fill="{PALETTE[c]}" d="M{x} {y}h{end-x}v1H{x}z"/>')
            x=end
    (OUT / f'{name}.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges">'+''.join(parts)+'</svg>\n')
