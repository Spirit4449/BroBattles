#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bro-trophy-art-"));

function abs(file) {
  return path.join(ROOT, file);
}

function tmp(name) {
  return path.join(TMP, name);
}

function decodeWebp(file, name) {
  const out = tmp(`${name}.pam`);
  execFileSync("dwebp", ["-pam", "-quiet", abs(file), "-o", out]);
  return readPam(out);
}

function encodeWebp(image, file, name) {
  clearTransparentRgb(image);
  const pam = tmp(`${name}.pam`);
  writePam(image, pam);
  fs.mkdirSync(path.dirname(abs(file)), { recursive: true });
  execFileSync("cwebp", ["-quiet", "-lossless", "-exact", pam, "-o", abs(file)]);
}

function clearTransparentRgb(image) {
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] !== 0) continue;
    image.data[i] = 0;
    image.data[i + 1] = 0;
    image.data[i + 2] = 0;
  }
}

function readPam(file) {
  const buffer = fs.readFileSync(file);
  const headerEnd = buffer.indexOf(Buffer.from("ENDHDR\n"));
  if (headerEnd < 0) throw new Error(`Invalid PAM: ${file}`);
  const header = buffer.subarray(0, headerEnd).toString("ascii");
  const width = Number(header.match(/WIDTH (\d+)/)?.[1]);
  const height = Number(header.match(/HEIGHT (\d+)/)?.[1]);
  const depth = Number(header.match(/DEPTH (\d+)/)?.[1]);
  if (!width || !height || depth !== 4) throw new Error(`Unsupported PAM header: ${file}`);
  return { width, height, data: Buffer.from(buffer.subarray(headerEnd + 7)) };
}

function writePam(image, file) {
  const header = `P7\nWIDTH ${image.width}\nHEIGHT ${image.height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`;
  fs.writeFileSync(file, Buffer.concat([Buffer.from(header, "ascii"), image.data]));
}

function idx(image, x, y) {
  return (y * image.width + x) * 4;
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function setPixel(image, x, y, rgba) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const i = idx(image, x, y);
  image.data[i] = rgba[0];
  image.data[i + 1] = rgba[1];
  image.data[i + 2] = rgba[2];
  image.data[i + 3] = rgba[3];
}

function getPixel(image, x, y) {
  const i = idx(image, x, y);
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
}

function drawLine(image, x0, y0, x1, y1, rgba) {
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  while (true) {
    setPixel(image, x, y, rgba);
    if (x === x1 && y === y1) break;
    const e2 = err * 2;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function fillRect(image, x, y, width, height, rgba) {
  for (let yy = y; yy < y + height; yy++) {
    for (let xx = x; xx < x + width; xx++) setPixel(image, xx, yy, rgba);
  }
}

function quietCardInterior(sourceFile, outputFile, theme) {
  const image = decodeWebp(sourceFile, theme.name);
  const rect = theme.rect;
  const panelMask = Buffer.alloc(image.width * image.height);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const bevel = 22;
      const rx = x - rect.x;
      const ry = y - rect.y;
      const lx = rect.w - 1 - rx;
      const by = rect.h - 1 - ry;
      const inBevel =
        (rx + ry >= bevel) &&
        (lx + ry >= bevel) &&
        (rx + by >= bevel) &&
        (lx + by >= bevel);
      if (!inBevel) continue;
      const i = idx(image, x, y);
      const a = image.data[i + 3];
      if (a < 8) continue;
      panelMask[y * image.width + x] = 1;
      const vertical = (y - rect.y) / rect.h;
      const horizontal = Math.abs((x - rect.x) / rect.w - 0.5) * 2;
      const glint = ((x * 17 + y * 31) % 23 === 0) ? 5 : 0;
      image.data[i] = clamp(mix(theme.top[0], theme.bottom[0], vertical) - horizontal * 6 + glint);
      image.data[i + 1] = clamp(mix(theme.top[1], theme.bottom[1], vertical) - horizontal * 6 + glint);
      image.data[i + 2] = clamp(mix(theme.top[2], theme.bottom[2], vertical) - horizontal * 4 + glint);
      image.data[i + 3] = 255;
    }
  }
  drawPanelBorder(image, panelMask, theme.border);

  const cx = rect.x + Math.floor(rect.w / 2);
  const cy = rect.y + Math.floor(rect.h * 0.42);
  if (theme.name === "arena-crown") {
    drawLine(image, cx - 58, cy, cx + 58, cy, [41, 35, 24, 255]);
    drawLine(image, cx - 42, cy - 28, cx - 18, cy + 28, [55, 44, 23, 255]);
    drawLine(image, cx + 42, cy - 28, cx + 18, cy + 28, [55, 44, 23, 255]);
    fillRect(image, cx - 21, cy + 34, 42, 3, [58, 44, 20, 255]);
    for (const [px, py] of [[cx - 50, cy - 72], [cx + 50, cy - 72], [cx, cy - 92]]) {
      fillRect(image, px - 2, py - 2, 5, 5, [64, 49, 18, 255]);
    }
  } else {
    const green = [20, 67, 45, 255];
    for (let n = 0; n < 9; n++) {
      const x = rect.x + 42 + n * 32;
      const y = rect.y + 76 + (n % 3) * 92;
      drawLine(image, x, y, x + 28, y, green);
      drawLine(image, x + 28, y, x + 28, y + 26, green);
      fillRect(image, x + 25, y + 23, 7, 7, [26, 89, 54, 255]);
    }
    drawLine(image, cx - 66, cy + 8, cx, cy - 54, [18, 69, 54, 255]);
    drawLine(image, cx, cy - 54, cx + 66, cy + 8, [18, 69, 54, 255]);
  }
  encodeWebp(image, outputFile, theme.name);
}

function drawPanelBorder(image, panelMask, color) {
  for (let y = 1; y < image.height - 1; y++) {
    for (let x = 1; x < image.width - 1; x++) {
      if (!panelMask[y * image.width + x]) continue;
      const edge =
        !panelMask[y * image.width + x - 1] ||
        !panelMask[y * image.width + x + 1] ||
        !panelMask[(y - 1) * image.width + x] ||
        !panelMask[(y + 1) * image.width + x];
      if (edge) setPixel(image, x, y, color);
    }
  }
}

function recolorNinja(sourceFile, outputFile) {
  const image = decodeWebp(sourceFile, "ninja-sovereign-sheet");
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = idx(image, x, y);
      const r = image.data[i];
      const g = image.data[i + 1];
      const b = image.data[i + 2];
      const a = image.data[i + 3];
      if (a < 8) continue;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const bright = (r + g + b) / 3;
      if (bright < 35) {
        image.data[i] = clamp(r * 0.55);
        image.data[i + 1] = clamp(g * 0.52);
        image.data[i + 2] = clamp(b * 0.72 + 10);
      } else if (r > g * 1.2 && r > b * 1.2) {
        image.data[i] = clamp(72 + bright * 0.18);
        image.data[i + 1] = clamp(32 + bright * 0.05);
        image.data[i + 2] = clamp(132 + bright * 0.28);
      } else if (r > 54 && r < 150 && g > 34 && g < 108 && b < 96 && r >= g) {
        image.data[i] = clamp(126 + bright * 0.35);
        image.data[i + 1] = clamp(82 + bright * 0.22);
        image.data[i + 2] = clamp(56 + bright * 0.14);
      } else if (max - min < 36 && bright > 72) {
        if (bright > 150) {
          image.data[i] = clamp(176 + bright * 0.22);
          image.data[i + 1] = clamp(138 + bright * 0.2);
          image.data[i + 2] = clamp(58 + bright * 0.08);
        } else {
          image.data[i] = clamp(40 + bright * 0.22);
          image.data[i + 1] = clamp(38 + bright * 0.2);
          image.data[i + 2] = clamp(56 + bright * 0.22);
        }
      } else if (r > 120 && g > 78 && b < 76) {
        image.data[i] = clamp(208 + bright * 0.08);
        image.data[i + 1] = clamp(166 + bright * 0.1);
        image.data[i + 2] = clamp(50 + bright * 0.08);
      } else {
        image.data[i] = clamp(r * 0.78);
        image.data[i + 1] = clamp(g * 0.78);
        image.data[i + 2] = clamp(b * 0.9 + 8);
      }
    }
  }
  decorateFrames(image, abs("public/assets/ninja/animations.json"), drawNinjaCrown);
  encodeWebp(image, outputFile, "ninja-sovereign-sheet-out");
  writeBodyFromFrame(image, abs("public/assets/ninja/animations.json"), "idle00", "public/assets/ninja/skins/ninja-arena-sovereign/body.webp", "ninja-sovereign-body");
}

function recolorGloop(sourceFile, outputFile) {
  const image = decodeWebp(sourceFile, "gloop-amethyst-sheet");
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = idx(image, x, y);
      const r = image.data[i];
      const g = image.data[i + 1];
      const b = image.data[i + 2];
      const a = image.data[i + 3];
      if (a < 18) {
        image.data[i] = 0;
        image.data[i + 1] = 0;
        image.data[i + 2] = 0;
        image.data[i + 3] = 0;
        continue;
      }
      if ((r > 112 && g > 165 && b > 120 && g > r + 22) || (r > 150 && Math.abs(r - g) < 28 && Math.abs(g - b) < 28)) {
        image.data[i] = 0;
        image.data[i + 1] = 0;
        image.data[i + 2] = 0;
        image.data[i + 3] = 0;
        continue;
      }
      const bright = (r + g + b) / 3;
      const localX = x % 128;
      const localY = y % 128;
      const facet = ((Math.floor(localX / 9) + Math.floor(localY / 11)) % 3) / 2;
      image.data[i] = clamp(35 + bright * 0.12 + facet * 22);
      image.data[i + 1] = clamp(155 + bright * 0.36 + facet * 28);
      image.data[i + 2] = clamp(198 + bright * 0.34 + facet * 36);
      if (localX > 45 && localX < 86 && localY > 34 && localY < 74) {
        image.data[i] = clamp(100 + bright * 0.34);
        image.data[i + 1] = clamp(75 + bright * 0.18);
        image.data[i + 2] = clamp(214 + bright * 0.25);
      }
      image.data[i + 3] = a > 210 ? 255 : clamp(a + 32);
    }
  }
  decorateFrames(image, abs("public/assets/gloop/animations.json"), drawCrystalFacets);
  encodeWebp(image, outputFile, "gloop-amethyst-sheet-out");
  writeBodyFromFrame(image, abs("public/assets/gloop/animations.json"), "idle00", "public/assets/gloop/skins/gloop-amethyst/body.webp", "gloop-amethyst-body");
}

function decorateFrames(image, atlasFile, draw) {
  const atlas = JSON.parse(fs.readFileSync(atlasFile, "utf8"));
  for (const frame of atlas.frames) {
    if (frame.frame.h <= 1 || frame.frame.w <= 1) continue;
    const box = visibleBounds(image, frame.frame);
    if (!box) continue;
    draw(image, frame.frame, box, frame.filename);
  }
}

function visibleBounds(image, frame) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = frame.y; y < frame.y + frame.h; y++) {
    for (let x = frame.x; x < frame.x + frame.w; x++) {
      if (getPixel(image, x, y)[3] < 24) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function drawNinjaCrown(image, frame, box) {
  const cx = Math.round((box.minX + box.maxX) / 2);
  const y = Math.max(frame.y + 1, box.minY - 4);
  const gold = [235, 187, 46, 255];
  const shade = [84, 54, 20, 255];
  fillRect(image, cx - 5, y + 7, 11, 2, shade);
  fillRect(image, cx - 5, y + 6, 11, 2, gold);
  for (const spike of [-4, 0, 4]) {
    setPixel(image, cx + spike, y + 2, gold);
    fillRect(image, cx + spike - 1, y + 3, 3, 2, gold);
    fillRect(image, cx + spike - 1, y + 5, 3, 1, gold);
    setPixel(image, cx + spike, y + 4, [250, 223, 92, 255]);
  }
  setPixel(image, cx, y + 6, [77, 215, 240, 255]);
}

function drawCrystalFacets(image, frame, box, name) {
  const color = name.includes("attack") ? [198, 252, 255, 255] : [140, 245, 255, 255];
  const left = Math.max(frame.x, box.minX + 8);
  const right = Math.min(frame.x + frame.w - 1, box.maxX - 8);
  const top = Math.max(frame.y, box.minY + 7);
  const bottom = Math.min(frame.y + frame.h - 1, box.maxY - 7);
  drawLine(image, left, bottom - 4, Math.round((left + right) / 2), top, color);
  drawLine(image, Math.round((left + right) / 2), top, right, bottom - 5, [101, 218, 255, 255]);
  drawLine(image, left + 9, top + 9, right - 10, top + 14, [109, 87, 226, 255]);
}

function writeBodyFromFrame(sheet, atlasFile, frameName, outputFile, name) {
  const atlas = JSON.parse(fs.readFileSync(atlasFile, "utf8"));
  const frame = atlas.frames.find((entry) => entry.filename === frameName)?.frame;
  if (!frame) throw new Error(`Missing frame ${frameName}`);
  const box = visibleBounds(sheet, frame);
  if (!box) throw new Error(`Frame ${frameName} has no visible pixels`);
  const padding = 8;
  const crop = {
    x: Math.max(frame.x, box.minX - padding),
    y: Math.max(frame.y, box.minY - padding),
    w: Math.min(frame.x + frame.w - 1, box.maxX + padding) - Math.max(frame.x, box.minX - padding) + 1,
    h: Math.min(frame.y + frame.h - 1, box.maxY + padding) - Math.max(frame.y, box.minY - padding) + 1,
  };
  const size = 1000;
  const out = { width: size, height: size, data: Buffer.alloc(size * size * 4) };
  const scale = Math.floor(Math.min(size * 0.78 / crop.w, size * 0.78 / crop.h));
  const drawW = crop.w * scale;
  const drawH = crop.h * scale;
  const ox = Math.floor((size - drawW) / 2);
  const oy = Math.floor((size - drawH) / 2);
  for (let y = 0; y < drawH; y++) {
    for (let x = 0; x < drawW; x++) {
      const sx = crop.x + Math.floor(x / scale);
      const sy = crop.y + Math.floor(y / scale);
      setPixel(out, ox + x, oy + y, getPixel(sheet, sx, sy));
    }
  }
  encodeWebp(out, outputFile, name);
}

quietCardInterior("public/assets/player-cards/arena-crown.webp", "public/assets/player-cards/arena-crown.webp", {
  name: "arena-crown",
  rect: { x: 84, y: 184, w: 344, h: 612 },
  top: [11, 17, 27],
  bottom: [6, 10, 18],
  border: [34, 28, 18, 255],
});
quietCardInterior("public/assets/player-cards/slime-circuit.webp", "public/assets/player-cards/slime-circuit.webp", {
  name: "slime-circuit",
  rect: { x: 84, y: 154, w: 344, h: 682 },
  top: [6, 18, 20],
  bottom: [5, 12, 16],
  border: [14, 55, 39, 255],
});
recolorNinja("public/assets/ninja/spritesheet.webp", "public/assets/ninja/skins/ninja-arena-sovereign/spritesheet.webp");
recolorGloop("public/assets/gloop/spritesheet.webp", "public/assets/gloop/skins/gloop-amethyst/spritesheet.webp");

console.log("Regenerated trophy player cards and trophy skin spritesheets.");
