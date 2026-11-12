const carousels = new WeakMap();
const SPAWN_MS = 360;

export function disposeSkinCarousel(stage) {
  const state = carousels.get(stage);
  if (!state) return;
  state.disposed = true;
  if (state.frame != null) cancelAnimationFrame(state.frame);
  state.canvas?.remove();
  if (state.portrait) state.portrait.style.visibility = state.visibility;
  carousels.delete(stage);
}

export function switchSkinPreview(stage, { src, alt }) {
  if (!stage) return;
  const previous = carousels.get(stage);
  if (previous?.target === src) return;
  // A new choice interrupts both decoding and playback; never queue transitions.
  disposeSkinCarousel(stage);
  const portrait = stage.querySelector('.character-details-preview-image');
  if (!portrait) return;
  if (stage.dataset.showcaseView === 'animations' || stage.dataset.showcaseView === 'fight') {
    portrait.src = src;
    portrait.alt = alt;
    return;
  }
  if (portrait.getAttribute('src') === src) {
    portrait.alt = alt;
    return;
  }
  const state = { target: src, portrait, visibility: portrait.style.visibility, disposed: false };
  carousels.set(stage, state);
  void spawn(stage, state, src, alt);
}

// Fit the source exactly like the portrait's object-fit: contain.
function drawPortrait(context, image, width, height) {
  if (!image.naturalWidth || !image.naturalHeight) return;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
  context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

// Soft full-height light expands sideways; no moving head or scan line.
// Broad dissolve patches stay in place, with only a few large accent shapes.
function drawBeamSpawn(context, layers, width, height, progress) {
  const cell = 20;
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      const phase = ((x / cell * 7 + y / cell * 11) % 19) / 19;
      const start = 0.18 + phase * 0.32;
      const blend = Math.max(0, Math.min(1, (progress - start) / 0.18));
      context.globalAlpha = 1 - blend;
      context.drawImage(layers[0], x, y, cell, cell, x, y, cell, cell);
      context.globalAlpha = blend;
      context.drawImage(layers[1], x, y, cell, cell, x, y, cell, cell);
    }
  }
  context.globalAlpha = 1;
  const intensity = Math.sin(Math.PI * progress) ** 1.5;
  if (intensity <= 0) return;
  const center = width / 2;
  const spread = width * (0.06 + 0.48 * (1 - (1 - progress) ** 3));
  context.save();
  context.globalCompositeOperation = 'lighter';
  context.globalAlpha = intensity;
  const beam = context.createLinearGradient(center - spread, 0, center + spread, 0);
  beam.addColorStop(0, 'rgba(75, 180, 255, 0)');
  beam.addColorStop(0.25, 'rgba(90, 205, 255, 0.12)');
  beam.addColorStop(0.5, 'rgba(185, 245, 255, 0.48)');
  beam.addColorStop(0.75, 'rgba(90, 205, 255, 0.12)');
  beam.addColorStop(1, 'rgba(75, 180, 255, 0)');
  context.fillStyle = beam;
  context.fillRect(center - spread, 0, spread * 2, height);

  // Staggered oversized squares/diamonds read as energy shapes, not debris.
  const shapes = [
    [0.27, 0.31, 30, 0.08, 0],
    [0.73, 0.59, 38, 0.18, Math.PI / 4],
    [0.33, 0.78, 24, 0.30, 0],
    [0.66, 0.23, 28, 0.39, Math.PI / 4],
  ];
  for (const [x, y, size, birth, angle] of shapes) {
    const age = (progress - birth) / 0.43;
    if (age <= 0 || age >= 1) continue;
    // Build outlines from integer blocks instead of rotated antialiased strokes.
    const pixel = Math.max(3, Math.round(size * (0.7 + age * 0.5) / 9));
    const originX = Math.round(width * x) - 4 * pixel;
    const originY = Math.round(height * y) - 4 * pixel;
    context.globalAlpha = Math.sin(Math.PI * age) * 0.30;
    for (let row = -4; row <= 4; row++) {
      for (let col = -4; col <= 4; col++) {
        const distance = angle ? Math.abs(row) + Math.abs(col) : Math.max(Math.abs(row), Math.abs(col));
        if (distance > 4) continue;
        const px = originX + (col + 4) * pixel;
        const py = originY + (row + 4) * pixel;
        if (distance === 4) {
          context.fillStyle = 'rgba(90, 210, 255, 0.14)';
          context.fillRect(px - 2, py - 2, pixel + 4, pixel + 4);
          context.fillStyle = '#b7f4ff';
        } else context.fillStyle = 'rgba(100, 220, 255, 0.08)';
        context.fillRect(px, py, pixel, pixel);
      }
    }
  }
  // A handful of stationary, separately timed pixel stars, not drifting debris.
  const sparkles = [
    [0.40, 0.20, 0.06], [0.77, 0.39, 0.15], [0.23, 0.52, 0.25],
    [0.58, 0.74, 0.34], [0.42, 0.45, 0.44], [0.70, 0.82, 0.55],
  ];
  for (const [x, y, birth] of sparkles) {
    const age = (progress - birth) / 0.28;
    if (age <= 0 || age >= 1) continue;
    const pulse = Math.sin(Math.PI * age);
    const cx = Math.round(width * x);
    const cy = Math.round(height * y);
    const arm = (1 + Math.floor(pulse * 3)) * 2;
    context.globalAlpha = pulse * 0.9;
    context.fillStyle = 'rgba(100, 220, 255, 0.18)';
    context.fillRect(cx - arm - 2, cy - 3, arm * 2 + 6, 8);
    context.fillRect(cx - 3, cy - arm - 2, 8, arm * 2 + 6);
    context.fillStyle = '#b7f4ff';
    context.fillRect(cx - arm, cy, arm * 2 + 2, 2);
    context.fillRect(cx, cy - arm, 2, arm * 2 + 2);
    context.fillStyle = '#ffffff';
    context.fillRect(cx - 1, cy - 1, 4, 4);
  }
  context.restore();
}

async function spawn(stage, state, src, alt) {
  const outgoing = state.portrait;
  const incoming = outgoing.cloneNode(false);
  incoming.src = src;
  incoming.alt = alt;
  try { await incoming.decode(); } catch {
    if (!incoming.naturalWidth) {
      if (!state.disposed) disposeSkinCarousel(stage);
      return;
    }
  }
  if (state.disposed || !stage.isConnected) return;
  const finish = () => {
    outgoing.replaceWith(incoming);
    disposeSkinCarousel(stage);
  };
  const rect = outgoing.getBoundingClientRect();
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || !rect.width || !rect.height) {
    finish();
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'character-skin-pixel';
  canvas.setAttribute('aria-hidden', 'true');
  // One small canvas instead of hundreds of filtered DOM images/compositor layers.
  // Pin the overlay to the image's layout box, outside grid sizing. A second
  // intrinsic-size grid item can shift the portrait while the effect is active.
  const width = outgoing.offsetWidth;
  const height = outgoing.offsetHeight;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.left = `${outgoing.offsetLeft}px`;
  canvas.style.top = `${outgoing.offsetTop}px`;
  canvas.style.filter = getComputedStyle(outgoing).filter;
  const context = canvas.getContext('2d');
  if (!context) { finish(); return; }
  const layers = [outgoing, incoming].map(image => {
    const layer = document.createElement('canvas');
    layer.width = canvas.width;
    layer.height = canvas.height;
    drawPortrait(layer.getContext('2d'), image, layer.width, layer.height);
    return layer;
  });
  state.canvas = canvas;
  stage.appendChild(canvas);
  outgoing.style.visibility = 'hidden';
  const started = performance.now();
  const render = now => {
    if (state.disposed) return;
    if (!stage.isConnected) { disposeSkinCarousel(stage); return; }
    const progress = Math.min(1, (now - started) / SPAWN_MS);
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawBeamSpawn(context, layers, canvas.width, canvas.height, progress);
    if (progress >= 1) finish();
    else state.frame = requestAnimationFrame(render);
  };
  render(started);
}
