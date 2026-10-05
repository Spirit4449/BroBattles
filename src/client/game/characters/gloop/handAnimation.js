// Eight authored poses share a registered wrist. Prepare once per texture manager.
// The source exporter bakes a neutral checker into RGB; color-key neutral pixels
// while uploading, retaining the saturated teal/blue artwork and navy outline.
export const HAND_TEXTURE = 'gloop-hand-grip';
export const HAND_FRAME_SIZE = 128;
export function prepareHandAnimation(scene) {
  if (scene.textures.exists(HAND_TEXTURE)) return true;
  if (!scene.textures.exists('gloop-hand-grip-source')) return false;
  const source = scene.textures.get('gloop-hand-grip-source').getSourceImage();
  const texture = scene.textures.createCanvas(HAND_TEXTURE, HAND_FRAME_SIZE * 8, HAND_FRAME_SIZE);
  const ctx = texture.context;
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < 8; i++) {
    const cellW = source.width / 4, cellH = source.height / 2;
    ctx.drawImage(source, (i % 4) * cellW, Math.floor(i / 4) * cellH,
      cellW, cellH, i * HAND_FRAME_SIZE, 0, HAND_FRAME_SIZE, HAND_FRAME_SIZE);
  }
  const pixels = ctx.getImageData(0, 0, texture.width, texture.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) < 38 && r > 65) pixels.data[i + 3] = 0;
  }
  ctx.putImageData(pixels, 0, 0);
  // Keep neighboring fingertips out of each cell's transparent left gutter.
  for (let i = 0; i < 8; i++) ctx.clearRect(i * HAND_FRAME_SIZE, 0, 5, HAND_FRAME_SIZE);
  for (let i = 0; i < 8; i++) texture.add(i, 0, i * HAND_FRAME_SIZE, 0, HAND_FRAME_SIZE, HAND_FRAME_SIZE);
  texture.refresh();
  return true;
}

export function handPose(phase, age, elapsed, duration) {
  // Unfurl on launch, curl on contact, relax again just before returning home.
  if (phase === 'catch') {
    const releaseAt = Math.max(100, duration - 110);
    return elapsed < releaseAt ? Math.min(7, Math.floor(elapsed / 16))
      : Math.max(0, 7 - Math.floor((elapsed - releaseAt) / 16));
  }
  if (phase === 'return') return Math.min(5, Math.floor(elapsed / 28));
  return Math.max(0, 7 - Math.floor(age / 18));
}
