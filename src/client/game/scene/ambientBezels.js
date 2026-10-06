// Ambient bezels, like YouTube's ambient mode: when the arena cannot fill the
// window, the space around it continues the live frame. The strip of the frame
// nearest each edge is mirrored outward (so colours match at the seam), darkened
// with distance and blurred, and the arena's own edge fades into it.

// Chrome keeps 2D canvases of at least 256×256 pixels on the GPU, so copying
// the WebGL frame into them never reads pixels back to the CPU.
const SAMPLE_WIDTH = 480;
const MIN_SAMPLE_AREA = 256 * 256;
const SAMPLE_INTERVAL_MS = 50;
// Each sample blends over the last, so colour changes glide instead of flicker.
const SAMPLE_BLEND = 0.4;
// Share of the bezel depth taken from the frame edge before mirroring; lower
// stretches the edge colours further.
const MIRROR_SOURCE = 0.6;
const EDGE_SHADE = 'rgba(8, 4, 12, 0.55)';
const CLEAR_SHADE = 'rgba(8, 4, 12, 0)';
// The arena edge fades over this share of its size, within limits (CSS px).
const FEATHER = { share: 0.04, min: 16, max: 56 };

function mirrorEdges(ctx, frame, r, size) {
  const fw = frame.width, fh = frame.height;
  const gaps = { top: r.y, bottom: size.height - r.y - r.h, left: r.x, right: size.width - r.x - r.w };
  const bandY = (g) => Math.max(1, Math.min(g * MIRROR_SOURCE, r.h) * (fh / r.h));
  const bandX = (g) => Math.max(1, Math.min(g * MIRROR_SOURCE, r.w) * (fw / r.w));
  const draw = (gap, place) => { if (gap > 0.5) { ctx.save(); place(gap); ctx.restore(); } };
  draw(gaps.top, (g) => { ctx.translate(r.x, r.y); ctx.scale(1, -1); ctx.drawImage(frame, 0, 0, fw, bandY(g), 0, 0, r.w, g); });
  draw(gaps.bottom, (g) => { ctx.translate(r.x, r.y + r.h); ctx.scale(1, -1); ctx.drawImage(frame, 0, fh - bandY(g), fw, bandY(g), 0, -g, r.w, g); });
  draw(gaps.left, (g) => { ctx.translate(r.x, r.y); ctx.scale(-1, 1); ctx.drawImage(frame, 0, 0, bandX(g), fh, 0, 0, g, r.h); });
  draw(gaps.right, (g) => { ctx.translate(r.x + r.w, r.y); ctx.scale(-1, 1); ctx.drawImage(frame, fw - bandX(g), 0, bandX(g), fh, -g, 0, g, r.h); });
  // Darken with distance from the arena, leaving the seam itself untouched.
  const shade = (x0, y0, x1, y1, rect) => {
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, CLEAR_SHADE);
    gradient.addColorStop(1, EDGE_SHADE);
    ctx.fillStyle = gradient;
    ctx.fillRect(...rect);
  };
  if (gaps.top > 0.5) shade(0, r.y, 0, 0, [0, 0, size.width, r.y]);
  if (gaps.bottom > 0.5) shade(0, r.y + r.h, 0, size.height, [0, r.y + r.h, size.width, gaps.bottom]);
  if (gaps.left > 0.5) shade(r.x, 0, 0, 0, [0, 0, r.x, size.height]);
  if (gaps.right > 0.5) shade(r.x + r.w, 0, size.width, 0, [r.x + r.w, 0, gaps.right, size.height]);
}

// Fade the arena's edges that border a bezel.
function featherMask(rect, gaps) {
  const vertical = gaps.top > 1 || gaps.bottom > 1;
  const horizontal = gaps.left > 1 || gaps.right > 1;
  if (!vertical && !horizontal) return '';
  const length = vertical ? rect.height : rect.width;
  const f = Math.round(Math.max(FEATHER.min, Math.min(FEATHER.max, length * FEATHER.share)));
  const [start, end] = vertical ? [gaps.top > 1, gaps.bottom > 1] : [gaps.left > 1, gaps.right > 1];
  return `linear-gradient(${vertical ? 'to bottom' : 'to right'}, ${start ? 'transparent 0' : '#000 0'}, #000 ${start ? f : 0}px, #000 calc(100% - ${end ? f : 0}px), ${end ? 'transparent 100%' : '#000 100%'})`;
}

export function installAmbientBezels(game) {
  const host = document.getElementById('game-bg');
  if (!host || !game?.canvas) return null;
  const display = document.createElement('canvas');
  display.className = 'ambient-canvas';
  display.setAttribute('aria-hidden', 'true');
  host.replaceChildren(display);
  const work = document.createElement('canvas');
  const displayCtx = display.getContext('2d', { alpha: false });
  const workCtx = work.getContext('2d', { alpha: false });
  let lastSample = -Infinity;
  let primed = false;
  let mask = '';

  const setMask = (value) => {
    if (value === mask) return;
    mask = value;
    game.canvas.style.maskImage = value;
    game.canvas.style.webkitMaskImage = value;
  };

  const sample = () => {
    const now = performance.now();
    if (now - lastSample < SAMPLE_INTERVAL_MS) return;
    lastSample = now;
    const rect = game.canvas.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!(rect.width > 0 && rect.height > 0 && vw > 0 && vh > 0)) return;
    const gaps = { top: rect.top, bottom: vh - rect.bottom, left: rect.left, right: vw - rect.right };
    const active = Object.values(gaps).some((g) => g > 1);
    host.classList.toggle('ambient-active', active);
    setMask(active ? featherMask(rect, gaps) : '');
    if (!active) { primed = false; return; }

    const width = Math.max(SAMPLE_WIDTH, Math.ceil(Math.sqrt(MIN_SAMPLE_AREA * vw / vh)));
    const height = Math.max(1, Math.round(width * vh / vw));
    for (const canvas of [display, work]) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        primed = false;
      }
    }
    const k = width / vw;
    const r = { x: rect.left * k, y: rect.top * k, w: rect.width * k, h: rect.height * k };
    // Runs straight after Phaser renders, while the WebGL drawing buffer is intact.
    workCtx.fillStyle = '#0b0710';
    workCtx.fillRect(0, 0, width, height);
    workCtx.drawImage(game.canvas, r.x, r.y, r.w, r.h);
    mirrorEdges(workCtx, game.canvas, r, { width, height });
    displayCtx.globalAlpha = primed ? SAMPLE_BLEND : 1;
    displayCtx.drawImage(work, 0, 0);
    primed = true;
  };
  const resample = () => { lastSample = -Infinity; };

  game.events.on(Phaser.Core.Events.POST_RENDER, sample);
  game.scale.on(Phaser.Scale.Events.RESIZE, resample);
  window.addEventListener('resize', resample);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    game.events.off(Phaser.Core.Events.POST_RENDER, sample);
    game.scale.off(Phaser.Scale.Events.RESIZE, resample);
    window.removeEventListener('resize', resample);
    host.classList.remove('ambient-active');
    setMask('');
    display.remove();
  });
  return { resample };
}
