"""Build the lobby character showcase stage art from Lushy map art (requires Pillow).

    python3 scripts/art/export-showcase-stage.py

The map art is 4000-5400px wide, too large to load as lobby textures. This
writes a small backdrop and a single floating platform to public/assets/showcase/,
plus stage.json recording the platform's size and where its walkable surface
starts, so fighters stand on it without hand-tuned offsets.
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'public/assets/lushy'
OUT = ROOT / 'public/assets/showcase'


def surface_y(image):
    """First row where the middle half of the art is almost fully opaque."""
    alpha = image.getchannel('A')
    width, height = image.size
    left, right = width // 4, width * 3 // 4
    for y in range(height):
        row = alpha.crop((left, y, right, y + 1)).tobytes()
        if sum(value > 200 for value in row) >= 0.9 * len(row):
            return y
    raise SystemExit('no walkable surface found')


def piece(name, width):
    image = Image.open(SRC / f'{name}.webp').convert('RGBA')
    image = image.crop(image.getbbox())
    height = round(image.height * width / image.width)
    return image.resize((width, height), Image.LANCZOS)


def save(image, name, **options):
    path = OUT / f'{name}.webp'
    image.save(path, method=6, **options)
    print(f'{name}: {image.width}x{image.height}, {path.stat().st_size / 1024:.0f} KB')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    backdrop = Image.open(SRC / 'gameBg.webp').convert('RGB')
    # Keep the open sky and distant islands; drop the cliff on the far left.
    crop_left = round(backdrop.width * 0.18)
    crop_height = round((backdrop.width - crop_left) / 2.4)
    top = round((backdrop.height - crop_height) * 0.35)
    backdrop = backdrop.crop((crop_left, top, backdrop.width, top + crop_height))
    backdrop = backdrop.resize((1200, 500), Image.LANCZOS)
    save(backdrop, 'backdrop', quality=82)

    stage = {}
    for name, source, width in (('platform', 'base', 1000),):
        image = piece(source, width)
        save(image, name, quality=90, alpha_quality=100)
        stage[name] = {'width': image.width, 'height': image.height, 'surfaceY': surface_y(image)}
    stage['backdrop'] = {'width': backdrop.width, 'height': backdrop.height}
    (OUT / 'stage.json').write_text(json.dumps(stage, indent=2) + '\n')
    print(json.dumps(stage))


if __name__ == '__main__':
    main()
