// Plays a character's idle loop from its game spritesheet on a canvas, sized
// and planted the way the lobby shows Bros. Shared by "Meet the Bros" and the
// cosmetics showcase (skins ship their own sheets).
const sheets = new Map();
const MIN_FPS = 5;

function loadImage(src) {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; });
}

// Most sheets are untrimmed, so measure the pixels each idle frame actually
// draws (in source-box coordinates) to give every Bro a similar size.
function drawnBounds(image, frames) {
  const scratch = document.createElement('canvas');
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  const box = { left: Infinity, top: Infinity, right: -Infinity };
  for (const item of frames) {
    const { x, y, w, h } = item.frame;
    scratch.width = w; scratch.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
    const alpha = ctx.getImageData(0, 0, w, h).data;
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      if (alpha[(py * w + px) * 4 + 3] < 24) continue;
      const sx = item.spriteSourceSize.x + px, sy = item.spriteSourceSize.y + py;
      if (sx < box.left) box.left = sx;
      if (sx + 1 > box.right) box.right = sx + 1;
      if (sy < box.top) box.top = sy;
    }
  }
  return Number.isFinite(box.left) ? box : { left: 0, top: 0, right: frames[0].sourceSize.w };
}

export function loadIdleSheet(sheetUrl, atlasUrl) {
  const key = `${sheetUrl}|${atlasUrl}`;
  if (!sheets.has(key)) {
    sheets.set(key, Promise.all([loadImage(sheetUrl), fetch(atlasUrl).then(response => response.json())]).then(([image, atlas]) => {
      const frames = atlas.frames.filter(item => /^idle\d+$/.test(item.filename)).sort((a, b) => a.filename.localeCompare(b.filename));
      if (!frames.length) throw new Error('No idle frames');
      return { image, frames, bounds: drawnBounds(image, frames) };
    }));
  }
  return sheets.get(key);
}

export function createSpriteLoop(canvas, { reducedMotion = false, fill = 0.68 } = {}) {
  const ctx = canvas.getContext('2d');
  let current = null, raf = 0, running = false, started = 0, shown = -1;

  function draw(index) {
    const { sheet, feet } = current;
    const item = sheet.frames[index];
    const { bounds } = sheet;
    // Feet come from the game's rig and sit on the canvas floor; the larger
    // drawn dimension fills the same share of the canvas for every Bro.
    const scale = canvas.height * fill / Math.max(feet[1] - bounds.top, (bounds.right - bounds.left) * 1.1);
    const offsetX = canvas.width / 2 - feet[0] * scale;
    const offsetY = canvas.height - feet[1] * scale;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet.image, item.frame.x, item.frame.y, item.frame.w, item.frame.h,
      Math.round(offsetX + item.spriteSourceSize.x * scale), Math.round(offsetY + item.spriteSourceSize.y * scale),
      Math.round(item.frame.w * scale), Math.round(item.frame.h * scale));
    shown = index;
  }
  // Frames come from one clock, so they keep an even rhythm at any refresh rate.
  function tick(now) {
    raf = 0;
    if (!running || !current) return;
    // A frame timestamp can predate a switch, so never go below frame 0.
    const index = Math.floor(Math.max(0, now - started) * current.fps / 1000) % current.sheet.frames.length;
    if (index !== shown) draw(index);
    raf = requestAnimationFrame(tick);
  }
  return {
    show(sheet, { fps, feet }) {
      current = { sheet, feet, fps: Math.max(MIN_FPS, fps || MIN_FPS) };
      started = performance.now();
      draw(0);
      if (running && !raf && !reducedMotion) raf = requestAnimationFrame(tick);
    },
    clear() { current = null; ctx.clearRect(0, 0, canvas.width, canvas.height); },
    setRunning(value) {
      running = value && !reducedMotion;
      if (running && !raf && current) raf = requestAnimationFrame(tick);
      if (!running && raf) { cancelAnimationFrame(raf); raf = 0; }
    },
  };
}
