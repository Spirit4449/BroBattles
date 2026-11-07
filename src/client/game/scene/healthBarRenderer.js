// Keep effects on the existing Graphics object so they follow HUD visibility,
// position, and destruction without separate sprites or running tweens.
import {
  drawPixelFill, drawPixelFrame, drawPixelGlow, drawPixelTicks, drawPixelTrough, shade, snapPixel,
} from "./pixelBar";

const barStates = new WeakMap();
// Damage must read instantly: the bar drops at once and the lost slice only
// blinks briefly. Heals keep a slightly longer glow.
const DAMAGE_FLASH_MS = 140;
const HEAL_FADE_MS = 400;
const BAR_HEIGHT = 9;
const HEALTH_PER_TICK = 165;
const TROUGH_BASE = 0x2a2633;

function blendColor(from, to, amount) {
  const mix = (shift) => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * amount);
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

export function resetHealthBarAnimation(graphics) {
  if (graphics) barStates.delete(graphics);
}

export function drawHealthBar(graphics, { x, y, width, health, maxHealth, color, teamGlowColor, isLocal = false }) {
  const fraction = maxHealth > 0
    ? Math.max(0, Math.min(1, health / maxHealth))
    : 0;
  const now = graphics.scene.time.now;
  let state = barStates.get(graphics);
  if (!state || state.maxHealth !== maxHealth || graphics.visible === false) {
    state = { fraction, maxHealth, chunks: [] };
    barStates.set(graphics, state);
  }
  state.chunks = state.chunks.filter((chunk) =>
    now - chunk.startedAt < (chunk.healing ? HEAL_FADE_MS : DAMAGE_FLASH_MS));
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
  x = snapPixel(x);
  y = snapPixel(y);
  width = snapPixel(width);
  const alive = health > 0;
  // Keep the affiliation halo on the health-bar graphics so it follows the
  // existing HUD visibility, placement, and cleanup, including invisibility.
  if (teamGlowColor !== undefined && alive) {
    drawPixelGlow(graphics, x, y, width, BAR_HEIGHT, teamGlowColor, isLocal ? 1.25 : 1);
  }
  drawPixelFrame(graphics, x, y, width, BAR_HEIGHT);
  // Tint the empty part of the bar with the team hue so a nearly drained bar
  // still shows which side the player is on.
  // The enemy fill is already red, so its trough goes deep and dark to stand
  // apart from it; the green side keeps a lighter tint.
  const redTeam = teamGlowColor !== undefined &&
    ((teamGlowColor >> 16) & 0xff) > ((teamGlowColor >> 8) & 0xff);
  const troughColor = teamGlowColor === undefined
    ? undefined
    : redTeam
      ? shade(blendColor(TROUGH_BASE, teamGlowColor, 0.5), -0.55)
      : blendColor(TROUGH_BASE, shade(teamGlowColor, -0.25), 0.55);
  drawPixelTrough(graphics, x, y, width, BAR_HEIGHT, troughColor);
  if (fraction > 0) {
    drawPixelFill(graphics, x, y, Math.max(1, width * fraction), BAR_HEIGHT, color);
  }
  drawPixelTicks(graphics, x, y, width, BAR_HEIGHT,
    Math.min(12, Math.round(maxHealth / HEALTH_PER_TICK)));

  for (const chunk of state.chunks) {
    const duration = chunk.healing ? HEAL_FADE_MS : DAMAGE_FLASH_MS;
    const progress = Math.max(0, (now - chunk.startedAt) / duration);
    // Fade in hard steps rather than a smooth ramp.
    const alpha = Math.ceil((1 - progress) ** 2 * 3) / 3;
    // Old flashes must never cover health gained/lost by a newer update.
    const start = chunk.healing ? chunk.start : Math.max(fraction, chunk.start);
    const end = chunk.healing ? Math.min(fraction, chunk.end) : chunk.end;
    if (end <= start) continue;
    const chunkX = x + Math.round(width * start);
    const chunkWidth = Math.max(1, Math.round(width * end) - Math.round(width * start));
    if (chunk.healing) {
      graphics.fillStyle(0x7dffb3, alpha * 0.9);
      graphics.fillRect(chunkX, y, chunkWidth, BAR_HEIGHT);
      graphics.fillStyle(0xe2ffed, alpha * 0.85);
      graphics.fillRect(chunkX, y, chunkWidth, 2);
    } else {
      // A dim red blink in the emptied slice: clearly not health any more.
      graphics.fillStyle(0xff4a3a, alpha * 0.55);
      graphics.fillRect(chunkX, y, chunkWidth, BAR_HEIGHT);
    }
  }
}

export function updateHealthBars({ opponentPlayers, teamPlayers, syncPositions = false }) {
  const players = new Set([
    ...Object.values(opponentPlayers || {}),
    ...Object.values(teamPlayers || {}),
  ]);
  for (const wrapper of players) {
    if (syncPositions && wrapper?.updateUIPosition) {
      // Countdown physics runs without network interpolation. Refresh cached
      // HUD anchors and the name before drawing health/super bars.
      wrapper.updateUIPosition();
    } else {
      wrapper?.updateHealthBar?.();
    }
  }
}
