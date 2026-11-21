import { POWERUP_CATALOG } from "../../../shared/powerups";
import { drawSlowAura } from "../characters/gloop/slowStatus";

const collectibleStyles = Object.entries(POWERUP_CATALOG).map(([type, item]) => ({
  type, color: item.color, ...item.visual,
}));
const primaryStyles = [...collectibleStyles.filter(style => style.priority != null)].sort((a, b) => a.priority - b.priority);
const bubbles = collectibleStyles.filter(style => style.bubbleStrength > 0)
  .sort((a, b) => a.bubbleOrder - b.bubbleOrder);

export function activeBubbleStyles(effects) {
  return bubbles.filter(style => effects[style.type] > 0)
    .map(({ type, color, bubbleStrength }) => ({ type, color, strength: bubbleStrength }));
}

export function applyPrimaryStatus(effects, context) {
  const { sprite, nowSec, Phaser } = context;
  const style = primaryStyles.find(entry => effects?.[entry.type] > 0);
  if (style?.apply) return style.apply(context);
  if (style?.tintPulse) {
    const pulse = Math.sin(nowSec * style.tintSpeed + (sprite.x || 0) * 0.01);
    sprite.setTint(style.tintPulse[pulse > 0 ? 0 : 1]);
  } else {
    sprite.clearTint();
  }
  const particle = style?.particle;
  if (!particle) return;
  const { kind, chance, offset: [spread, top, bottom], duration } = particle;
  const velocity = sprite.body?.velocity || {};
  if (kind === "arrow" && !(velocity.y < -35)) return;
  if (Math.random() >= chance) return;
  const x = sprite.x + Phaser.Math.Between(-spread, spread);
  const y = sprite.y + Phaser.Math.Between(top, bottom);
  if (kind === "arrow") {
    const angle = Math.atan2(velocity.y, Math.abs(velocity.x) > 8 ? velocity.x : sprite.flipX ? -24 : 24);
    context.spawnArrowParticle(x, y, style.color, angle + Phaser.Math.FloatBetween(-0.24, 0.24),
      Phaser.Math.Between(...particle.size), duration);
  } else {
    const size = Array.isArray(particle.size) ? Phaser.Math.FloatBetween(...particle.size) : particle.size;
    const spawn = kind === "plus" ? context.spawnPlusParticle : context.spawnTrailParticle;
    spawn(x, y, style.color, size, duration);
  }
}

export function drawBootsAura({ graphics: g, frame, colors, x, r, pulse }) {
  const bootY = frame.bottom - 2;
  g.fillStyle(colors.gravityBoots, 0.22 * pulse);
  g.fillEllipse(x, bootY, Math.max(28, r + 4), 10);
  g.lineStyle(2, colors.gravityBoots, 0.75 * pulse);
  g.strokeEllipse(x, bootY, Math.max(28, r + 4), 10);
}

export function drawFreezeAura({ graphics: g, frame, colors, x, y, r, pulse, nowSec, Phaser }) {
  const freezeColor = colors.freeze || 0x67e8f9;
  const blobPoints = [];
  for (let i = 0; i < 26; i += 1) {
    const angle = (i / 26) * Math.PI * 2;
    const ripple =
      Math.sin(angle * 3 + nowSec * 2.6) * 4.2 +
      Math.sin(angle * 7 - nowSec * 1.8) * 2.1;
    const blobRadius = r + 7 + ripple + pulse * 2;
    blobPoints.push(
      new Phaser.Geom.Point(
        x + Math.cos(angle) * blobRadius,
        y + Math.sin(angle) * blobRadius * 0.92,
      ),
    );
  }
  g.fillStyle(0x38bdf8, 0.17 + 0.05 * pulse);
  g.fillPoints(blobPoints, true);
  g.lineStyle(5, freezeColor, 0.3 + 0.12 * pulse);
  g.strokePoints(blobPoints, true);
  g.lineStyle(2, 0xdffaff, 0.75 * pulse);
  g.strokePoints(blobPoints, true);

  // Faceted crystals protrude from the frozen blob.
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI * 2 + nowSec * 0.12;
    const inner = r + 4;
    const outer = r + 15 + 3 * Math.sin(nowSec * 3 + i);
    const baseX = x + Math.cos(angle) * inner;
    const baseY = y + Math.sin(angle) * inner * 0.92;
    const tipX = x + Math.cos(angle) * outer;
    const tipY = y + Math.sin(angle) * outer * 0.92;
    const sideX = Math.cos(angle + Math.PI / 2) * 4;
    const sideY = Math.sin(angle + Math.PI / 2) * 4;
    g.fillStyle(i % 2 === 0 ? 0xe0faff : freezeColor, 0.82);
    g.fillTriangle(
      baseX + sideX,
      baseY + sideY,
      baseX - sideX,
      baseY - sideY,
      tipX,
      tipY,
    );
  }

  // Three descending arrows make the movement penalty readable at a glance.
  const arrowTop = frame.top - 25 - pulse * 4;
  for (let i = 0; i < 3; i += 1) {
    const ax = x + (i - 1) * 15;
    const ay = arrowTop + Math.sin(nowSec * 5 + i * 0.85) * 3;
    g.fillStyle(freezeColor, 0.9);
    g.fillRect(ax - 2, ay - 9, 4, 10);
    g.fillTriangle(ax - 6, ay, ax + 6, ay, ax, ay + 10);
    g.lineStyle(1, 0xffffff, 0.7);
    g.strokeTriangle(ax - 6, ay, ax + 6, ay, ax, ay + 10);
  }
}

// Character-inflicted auras follow the affected fighter, regardless of their kit.
const auraStyles = [
  { effects: ["gloopHookSlow", "gloopSlimeSlow"], draw: drawSlowAura },
  { effects: ["gravityBoots"], draw: drawBootsAura },
  { effects: ["freeze"], draw: drawFreezeAura },
];

export function drawStatusAuras(context) {
  for (const style of auraStyles) {
    if (style.effects.some(type => context.effects[type] > 0)) style.draw(context);
  }
}
