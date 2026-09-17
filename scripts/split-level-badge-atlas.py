#!/usr/bin/env python3
"""Split a supplied level atlas into final lossless transparent WebP badges."""

from collections import deque
from pathlib import Path
import subprocess
import sys


WIDTH = 1983
HEIGHT = 793
CANVAS = 397
ALPHA_THRESHOLD = 8


def decode_rgba(source: Path) -> bytes:
    return subprocess.check_output(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "pipe:1",
        ]
    )


def connected_components(raw: bytes):
    alpha = memoryview(raw)[3::4]
    labels = [-1] * (WIDTH * HEIGHT)
    components = []

    for start, value in enumerate(alpha):
        if value < ALPHA_THRESHOLD or labels[start] >= 0:
            continue
        label = len(components)
        labels[start] = label
        queue = deque([start])
        pixels = []

        while queue:
            index = queue.popleft()
            pixels.append(index)
            y, x = divmod(index, WIDTH)
            neighbors = []
            if x:
                neighbors.append(index - 1)
            if x + 1 < WIDTH:
                neighbors.append(index + 1)
            if y:
                neighbors.append(index - WIDTH)
            if y + 1 < HEIGHT:
                neighbors.append(index + WIDTH)
            for neighbor in neighbors:
                if labels[neighbor] < 0 and alpha[neighbor] >= ALPHA_THRESHOLD:
                    labels[neighbor] = label
                    queue.append(neighbor)

        components.append(pixels)

    return labels, components


def write_badge(raw: bytes, pixels, destination: Path):
    coordinates = [divmod(index, WIDTH) for index in pixels]
    min_y = min(y for y, _ in coordinates)
    max_y = max(y for y, _ in coordinates)
    min_x = min(x for _, x in coordinates)
    max_x = max(x for _, x in coordinates)
    art_width = max_x - min_x + 1
    art_height = max_y - min_y + 1
    if art_width > CANVAS or art_height > CANVAS:
        raise ValueError(f"Artwork does not fit {CANVAS}px canvas: {destination.name}")

    offset_x = (CANVAS - art_width) // 2
    offset_y = (CANVAS - art_height) // 2
    output = bytearray(CANVAS * CANVAS * 4)
    for source_index, (source_y, source_x) in zip(pixels, coordinates):
        target_x = source_x - min_x + offset_x
        target_y = source_y - min_y + offset_y
        source_offset = source_index * 4
        target_offset = (target_y * CANVAS + target_x) * 4
        output[target_offset : target_offset + 4] = raw[source_offset : source_offset + 4]

    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-s",
            f"{CANVAS}x{CANVAS}",
            "-i",
            "pipe:0",
            "-frames:v",
            "1",
            "-c:v",
            "libwebp",
            "-lossless",
            "1",
            str(destination),
        ],
        input=output,
        check=True,
    )


def main():
    source = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)
    raw = decode_rgba(source)
    labels, components = connected_components(raw)

    centers = [
        (round((column + 0.5) * WIDTH / 5), round((row + 0.5) * HEIGHT / 2))
        for row in range(2)
        for column in range(5)
    ]
    for level, (center_x, center_y) in enumerate(centers, start=1):
        destination = output_dir / f"{level}.webp"
        # Level 4 was repaired as a standalone image because its point and the
        # level 9 flame touch in the generated atlas. Preserve that clean asset.
        if level == 4 and destination.exists():
            continue

        label = labels[center_y * WIDTH + center_x]
        if label < 0:
            raise ValueError(f"No badge artwork found at level {level} center")
        pixels = components[label]

        # The generated level 4 point and level 9 flame touch across the atlas
        # row boundary. Separate them at the transparent visual seam.
        if level == 4:
            clean_pixels = []
            for index in pixels:
                y = index // WIDTH
                source_offset = index * 4
                red, green, blue = raw[source_offset : source_offset + 3]
                purple_overlap = (
                    y > 315
                    and red > 25
                    and blue > red * 1.3
                    and blue > green * 1.3
                )
                if y <= 357 and not purple_overlap:
                    clean_pixels.append(index)
            pixels = clean_pixels
        elif level == 9:
            pixels = [index for index in pixels if index // WIDTH >= 373]

        write_badge(raw, pixels, destination)


if __name__ == "__main__":
    main()
