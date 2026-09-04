// Keep effects on the existing Graphics object so they follow HUD visibility,
// position, and destruction without separate sprites or running tweens.
const barStates = new WeakMap();
const FADE_MS = 650;

export function resetHealthBarAnimation(graphics) {
  if (graphics) barStates.delete(graphics);
}

export function drawHealthBar(graphics, { x, y, width, health, maxHealth, color }) {
  const fraction = maxHealth > 0
    ? Math.max(0, Math.min(1, health / maxHealth))
    : 0;
  const now = graphics.scene.time.now;
  let state = barStates.get(graphics);
  if (!state || state.maxHealth !== maxHealth || graphics.visible === false) {
    state = { fraction, maxHealth, chunks: [] };
    barStates.set(graphics, state);
  }
  state.chunks = state.chunks.filter((chunk) => now - chunk.startedAt < FADE_MS);
  if (fraction !== state.fraction) {
    state.chunks.push({
      start: Math.min(fraction, state.fraction),
      end: Math.max(fraction, state.fraction),
      healing: fraction > state.fraction,
      startedAt: now,
    });
    // Bound the draw work even during rapid damage/healing updates.
    if (state.chunks.length > 16) state.chunks.shift();
    state.fraction = fraction;
  }

  graphics.clear();
  graphics.fillStyle(0x595959, 1);
  graphics.fillRect(x, y, width, 9);
  graphics.lineStyle(3, 0x000000, 1);
  graphics.strokeRoundedRect(x, y, width, 9, 3);
  graphics.fillStyle(color, 1);
  if (fraction > 0) graphics.fillRoundedRect(x, y, width * fraction, 9, 3);

  for (const chunk of state.chunks) {
    const progress = Math.max(0, (now - chunk.startedAt) / FADE_MS);
    const alpha = (1 - progress) ** 2;
    // Old flashes must never cover health gained/lost by a newer update.
    const start = chunk.healing ? chunk.start : Math.max(fraction, chunk.start);
    const end = chunk.healing ? Math.min(fraction, chunk.end) : chunk.end;
    if (end <= start) continue;
    const chunkX = x + width * start;
    const chunkWidth = width * (end - start);
    const glow = chunk.healing ? 0x7dffb3 : 0xff785d;
    // Layer translucent halos for a soft glow in both Canvas and WebGL.
    for (let spread = 3; spread >= 1; spread--) {
      graphics.fillStyle(glow, alpha * (chunk.healing ? 0.075 : 0.025));
      graphics.fillRoundedRect(
        chunkX - spread, y - spread, chunkWidth + spread * 2, 9 + spread * 2, spread,
      );
    }
    if (chunk.healing) {
      graphics.fillStyle(glow, alpha * 0.9);
      graphics.fillRect(chunkX, y, chunkWidth, 9);
      graphics.fillStyle(0xe2ffed, alpha * 0.85);
      graphics.fillRect(chunkX, y + 1, chunkWidth, 2);
    } else {
      // Leave the spent area empty immediately; only its outline lingers.
      graphics.lineStyle(1, glow, alpha * 0.35);
      graphics.strokeRect(chunkX, y + 1, chunkWidth, 7);
    }
  }
}
