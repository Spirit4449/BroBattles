"""Extract curated poses from the approved videos (requires Pillow, NumPy, ffmpeg).

Run from the repository root. Review artifacts go in output/thorg-video-import.
The 128px logical canvas preserves physics; trimmed art may extend outside it
for raised weapons and the full-length corpse. No per-frame fit-to-box scaling.
"""
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public/assets/thorg'
OUT = ROOT / 'output/thorg-video-import'
OUT.mkdir(parents=True, exist_ok=True)
SPECS = {
    'idle': ('idle', [0, 18, 30, 42], 106 / 496, 4),
    'running': ('run', [0, 3, 6, 9, 12, 16, 20, 23], 106 / 496, 16),
    'throw': ('attack3', [10, 11, 12, 14, 16, 18, 19, 20, 22, 40, 43, 46], 106 / 428, 0),
    'jumping': ('jump3', [0, 2, 4, 6, 8, 11, 14, 17], 106 / 428, 24),
    'falling': ('fall3', [0, 12, 24, 37], 106 / 428, 8),
    'powerup': ('special', [0, 2, 4, 6, 8, 10, 12], 106 / 432, 18),
    'dying': ('dead', [2, 10, 21, 32, 42, 48, 54, 59], 106 / 496, 28 / 3),
}

# Measured grip and distal mace-tip coordinates on 320x180 previews of attack3.
# The imported art and shared combat track use the same fixed sampling transform.
ATTACK_ANCHORS = [
    ((137, 130), (163, 66)),
    ((129, 123), (117, 55)), ((128, 119), (87, 66)),
    ((122, 132), (65, 116)), ((147, 144), (89, 146)),
    ((210, 135), (271, 104)), ((209, 108), (241, 62)),
    ((169, 103), (158, 35)), ((117, 110), (79, 70)),
    ((146, 143), (94, 171)), ((158, 142), (207, 146)),
    ((149, 139), (215, 94)),
]
sweep = json.loads((ROOT / 'src/shared/characters/thorg.json').read_text())['stats']['tuning']['attack']['sweep']
attack_durations = [sweep['windupMs']] + [sweep['strikeMs'] / 8] * 8 + [sweep['recoveryMs'] / 3] * 3


def decode(name):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i',
        str(ASSETS / f'thorg_{name}.mp4'), '-map', '0:v:0',
        '-vf', 'scale=1280:720:flags=neighbor',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    return np.frombuffer(raw, np.uint8).reshape(-1, 720, 1280, 3)


def cutout(rgb, preserve_sweep=False):
    a = rgb.astype(np.int16)
    r, g, b = a.transpose(2, 0, 1)
    # Hard alpha keeps the original pixel-art edges. Remove green spill from
    # retained compression-edge pixels without touching the warm art palette.
    green = (g > 85) & (g > r + 25) & (g > b + 25)
    a[:, :, 1] = np.where((g > r + 8) & (g > b + 8), np.maximum(r, b), g)
    rgba = np.dstack((a.astype(np.uint8), np.where(green, 0, 255).astype(np.uint8)))
    rgba[green, :3] = 0
    if preserve_sweep:
        # The white sweep was blended over green in the video. A binary green
        # key erases its translucent parts; reconstruct their white alpha matte.
        background = np.median(rgb[:32, :32].reshape(-1, 3), axis=0)
        red_alpha = (r - background[0]) / max(1, 255 - background[0])
        blue_alpha = (b - background[2]) / max(1, 255 - background[2])
        opacity = np.clip(np.minimum(red_alpha, blue_alpha), 0, 1)
        sweep_pixels = green & (opacity > 0.06)
        rgba[sweep_pixels, :3] = 255
        rgba[sweep_pixels, 3] = np.round(opacity[sweep_pixels] * 255).astype(np.uint8)
    return Image.fromarray(rgba)


entries = []
manifest = {'animations': {}, 'logicalSize': 128, 'footBaseline': 118}
for prefix, (video, indices, scale, fps) in SPECS.items():
    assert len(indices) <= (12 if prefix == "throw" else 8), f"Too many frames: {prefix}"
    source = decode(video)
    poses = []
    hashes = set()
    for index in indices:
        im = cutout(source[index], preserve_sweep=video == 'attack3')
        box = im.getbbox()
        # Body center comes from the initial standing reference, not the mace.
        center = 620 if video in ('idle', 'dead', 'run') else 626
        baseline = box[3] if video in ('jump3', 'fall3') else 720
        # Sample the same pixel grid every time; resizing individual tight
        # crops would change rounding and introduce false texture motion.
        im = im.resize((round(1280 * scale), round(720 * scale)), Image.Resampling.NEAREST)
        box = im.getbbox()
        cropped = im.crop(box)
        x = 64 - round(center * scale) + box[0]
        y = 118 - round(baseline * scale) + box[1]
        digest = hashlib.sha256(cropped.tobytes()).hexdigest()
        if digest in hashes:
            raise ValueError(f'Duplicate selected pose: {prefix} frame {index}')
        hashes.add(digest)
        name = f'{prefix}{len(poses):02}'
        poses.append(name)
        entries.append({'name': name, 'image': cropped, 'x': x, 'y': y,
                        'video': video, 'sourceFrame': index, 'embedded': True})
    manifest['animations'][prefix] = {'frames': poses, 'sourceFrames': indices,
                                      'fps': fps, 'source': f'thorg_{video}.mp4'}

# Reuse the final jump pose as falling00, so the handoff is pixel-exact.
jump = next(e for e in entries if e['name'] == 'jumping07')
fall = next(e for e in entries if e['name'] == 'falling00')
fall.update({k: jump[k] for k in ('image', 'x', 'y', 'video', 'sourceFrame')})
manifest['animations']['falling']['transition'] = 'falling00 reuses jumping07'

# Match the idle helmet's 52px horn span, not the overall pose bounding box.
# Raised hands/weapons must not shrink the body. Keep the original green masters
# in the asset tree so reimports cannot silently restore the superseded poses.
HELD_POSES = [
    ('duck00', 'duck', 52 / 540, 625),
    ('sliding00', 'wall-slide', 58 / 512, 625),
]
for name, asset, scale, center in HELD_POSES:
    source_file = 'thorg_duck.png' if asset == 'duck' else 'thorg_slide.png'
    source_path = ASSETS / source_file
    source = Image.open(source_path).convert('RGBA')
    im = cutout(np.asarray(source.convert('RGB')))
    # Preserve erased/transparent source pixels; RGB conversion alone can
    # reveal old artwork that the artist already removed with an alpha mask.
    rgba = np.asarray(im).copy()
    rgba[:, :, 3] = np.minimum(rgba[:, :, 3], np.asarray(source)[:, :, 3])
    rgba[rgba[:, :, 3] == 0, :3] = 0
    im = Image.fromarray(rgba)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.NEAREST)
    box = im.getbbox()
    canvas = Image.new('RGBA', (192, 128))
    canvas.paste(im, (96 - round(center * scale), 118 - box[3]))
    # Base sprites face right: the wall-contact hand must be on the right.
    if asset == 'wall-slide':
        canvas = ImageOps.mirror(canvas)
    canvas.save(ASSETS / f'{asset}.webp', lossless=True, exact=True)
    entries.append({'name': name, 'image': canvas, 'x': -32, 'y': 0,
                    'embedded': True, 'sourceAsset': source_file,
                    'importScale': scale, 'sourceMirrored': asset == 'wall-slide'})

tile = 256
atlas = Image.new('RGBA', (tile * 8, tile * ((len(entries) + 7) // 8)))
frames = []
review = Image.new('RGB', atlas.size, '#303947')
draw = ImageDraw.Draw(review)
for n, entry in enumerate(entries):
    im = entry['image']
    ax, ay = n % 8 * tile, n // 8 * tile
    assert im.width < tile and im.height < tile
    atlas.paste(im, (ax, ay))
    row = {'filename': entry['name'], 'frame': {'x': ax, 'y': ay, 'w': im.width, 'h': im.height},
           'rotated': False, 'trimmed': True,
           'spriteSourceSize': {'x': entry['x'], 'y': entry['y'], 'w': im.width, 'h': im.height},
           'sourceSize': {'w': 128, 'h': 128}, 'bbEmbeddedWeapon': entry['embedded']}
    if 'sourceAsset' in entry:
        row['sourceAsset'] = entry['sourceAsset']
        row['importScale'] = entry['importScale']
        row['sourceMirrored'] = entry['sourceMirrored']
    if 'sourceFrame' in entry:
        row['sourceVideo'] = f"thorg_{entry['video']}.mp4"
        row['sourceFrame'] = entry['sourceFrame']
    frames.append(row)
    review.paste(im, (ax + 64 + entry['x'], ay + 64 + entry['y']), im)
    draw.text((ax + 8, ay + 234), entry['name'], fill='white')

atlas.save(ASSETS / 'spritesheet.webp', lossless=True, exact=True)
(ASSETS / 'animations.json').write_text(json.dumps({'frames': frames, 'meta': {
    'image': 'spritesheet.webp', 'size': {'w': atlas.width, 'h': atlas.height},
    'scale': '1', 'bbVideoFrames': True}}, separators=(',', ':')) + '\n')
(OUT / 'selection.json').write_text(json.dumps(manifest, indent=2) + '\n')
review.save(OUT / 'selected-poses.png')
for prefix, spec in manifest['animations'].items():
    selected = [e for e in entries if e['name'] in spec['frames']]
    previews = []
    for e in selected:
        canvas = Image.new('RGB', (256, 256), '#303947')
        canvas.paste(e['image'], (64 + e['x'], 64 + e['y']), e['image'])
        previews.append(canvas.resize((512, 512), Image.Resampling.NEAREST))
    durations = attack_durations if prefix == 'throw' else [round(1000/spec['fps'])] * len(previews)
    previews[0].save(OUT / f'{prefix}.gif', save_all=True, append_images=previews[1:],
                     duration=durations, loop=0, disposal=2)

attack_entries = [e for e in entries if e['name'].startswith('throw')]
track = []
factor = SPECS['throw'][2]
for index, (grip, tip) in enumerate(ATTACK_ANCHORS):
    def world_point(point):
        # Same rounding as the atlas placement, then source pixels -> world units.
        return [round((round(point[0]*4*factor)-round(626*factor))*.7, 3),
                round((118-round(720*factor)+round(point[1]*4*factor)-64)*.7, 3)]
    track.append({'frame': attack_entries[index]['name'], 'sourceFrame': SPECS['throw'][1][index],
                  'durationMs': attack_durations[index], 'grip': world_point(grip),
                  'tip': world_point(tip), 'radius': 7})
(ROOT / 'src/shared/thorgAttackFrames.json').write_text(json.dumps(track, indent=2) + '\n')
print(json.dumps({k: len(v['frames']) for k, v in manifest['animations'].items()}))
