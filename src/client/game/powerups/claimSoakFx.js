import { addPixelCircle, addPixelEllipse } from "../scene/fx/pixelShapes";
import { RENDER_LAYERS } from "../scene/renderLayers";

// A claimed powerup is drawn into its collector like liquid: the orb leaves
// the pickup as a gooey stream, splashes on the body, the body fills with the
// powerup's colour and drains downward as it soaks in, and the last droplets
// are pulled into the core. `tweenClaimEffect(username, objects, config,
// onComplete)` owns cancellation, so a reset clears a half-played claim.
export const CLAIM_SOAK = Object.freeze({
  streamMs: 300,
  dropletCount: 8,
  soakMs: 460,
  soakAlpha: 0.82,
  pullMs: 280,
  pullDroplets: 12,
});

export function spawnClaimSoak({ scene, Phaser, tweenClaimEffect, username, collector, frameFor, from, color, iconKey, onArrive }) {
  const fxDepth = RENDER_LAYERS.PLAYER_HUD + 2;
  const side = Math.random() < 0.5 ? -1 : 1;

  // Head blob, its bright core, and a tapering tail of droplets.
  const head = addPixelEllipse(scene, from.x, from.y, 26, 22, color, 0.9);
  const headCore = addPixelEllipse(scene, from.x, from.y, 12, 9, 0xffffff, 0.75);
  const droplets = [];
  for (let i = 0; i < CLAIM_SOAK.dropletCount; i += 1) {
    const radius = Math.max(1.6, 7.5 - i * 0.8);
    const droplet = addPixelCircle(scene, from.x, from.y, radius, i % 3 === 1 ? 0xffffff : color, 0.8);
    droplet.setBlendMode(Phaser.BlendModes.ADD);
    droplet.setDepth(fxDepth - 0.02);
    droplets.push(droplet);
  }
  head.setBlendMode(Phaser.BlendModes.ADD).setDepth(fxDepth);
  headCore.setBlendMode(Phaser.BlendModes.ADD).setDepth(fxDepth + 0.01);
  let icon = null;
  if (iconKey) {
    icon = scene.add.image(from.x, from.y, iconKey);
    const maxDim = Math.max(icon.width || 1, icon.height || 1);
    icon.setScale(40 / maxDim).setDepth(fxDepth + 0.02);
  }
  const iconScale = icon?.scaleX || 1;

  const pathAt = (t, target) => {
    const midX = (from.x + target.x) / 2;
    const midY = (from.y + target.y) / 2;
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const bend = Math.min(46, length * 0.35) * side;
    const cx = midX - (dy / length) * bend;
    const cy = midY + (dx / length) * bend - Math.min(34, length * 0.25);
    const u = 1 - t;
    return {
      x: u * u * from.x + 2 * u * t * cx + t * t * target.x,
      y: u * u * from.y + 2 * u * t * cy + t * t * target.y,
    };
  };

  const travel = { t: 0 };
  const parts = [head, headCore, ...droplets, icon].filter(Boolean);
  tweenClaimEffect(username, parts, {
    targets: travel,
    t: 1,
    duration: CLAIM_SOAK.streamMs,
    ease: "Cubic.easeIn",
    onUpdate: () => {
      if (!collector.active || !head.active) return;
      const target = frameFor(collector);
      const t = travel.t;
      const p = pathAt(t, target);
      const ahead = pathAt(Math.min(1, t + 0.04), target);
      const angle = Math.atan2(ahead.y - p.y, ahead.x - p.x);
      // The blob stretches as it speeds up and thins as it nears the body.
      const stretch = 1 + t * 0.9;
      const thin = 1 - t * 0.45;
      head.setPosition(p.x, p.y).setRotation(angle).setScale(stretch * thin, thin);
      headCore.setPosition(p.x, p.y).setRotation(angle).setScale(stretch * thin, thin);
      if (icon) {
        icon.setPosition(p.x, p.y);
        icon.setScale(iconScale * (1 - t * 0.78));
        icon.setAlpha(1 - Math.max(0, t - 0.55) * 2.2);
      }
      droplets.forEach((droplet, i) => {
        const lag = (i + 1) * 0.055;
        const dt = Phaser.Math.Clamp(t - lag, 0, 1);
        const d = pathAt(dt, target);
        const wobble = Math.sin(t * 14 + i * 1.7) * (1 - dt) * 3;
        droplet.setPosition(d.x + wobble, d.y - wobble * 0.5);
        droplet.setScale(1 - dt * 0.5);
        droplet.setAlpha(t > lag ? 0.82 - i * 0.07 : 0);
      });
    },
  }, () => {
    if (!collector.active) return;
    spawnSoakArrival({ scene, Phaser, tweenClaimEffect, username, collector, frameFor, color, side });
    onArrive?.();
  });
}

function spawnSoakArrival({ scene, Phaser, tweenClaimEffect, username, collector, frameFor, color, side }) {
  const frame = frameFor(collector);
  soakSilhouette({ scene, Phaser, tweenClaimEffect, username, sprite: collector, color });

  // A flattened splat on the body where the stream lands.
  const splat = addPixelEllipse(scene, frame.x - side * 6, frame.y, 34, 14, color, 0.7);
  const splatCore = addPixelEllipse(scene, frame.x - side * 6, frame.y, 18, 7, 0xffffff, 0.45);
  [splat, splatCore].forEach((part) => part.setBlendMode(Phaser.BlendModes.ADD).setDepth(RENDER_LAYERS.PLAYER_HUD + 2));
  const splash = { t: 0 };
  tweenClaimEffect(username, [splat, splatCore], {
    targets: splash,
    t: 1,
    duration: 220,
    ease: "Quad.easeOut",
    onUpdate: () => {
      const f = frameFor(collector);
      const s = splash.t;
      [splat, splatCore].forEach((part) => {
        part.setPosition(f.x - side * 6 * (1 - s), f.y);
        part.setScale(1 + s * 0.7, 1 - s * 0.6);
        part.setAlpha((1 - s) * 0.8);
      });
    },
  });

  // Droplets flung around the body are drawn back in and vanish into the core.
  const pull = [];
  for (let i = 0; i < CLAIM_SOAK.pullDroplets; i += 1) {
    const angle = (i / CLAIM_SOAK.pullDroplets) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.2, 0.2);
    const reach = frame.radius * Phaser.Math.FloatBetween(1.35, 1.95);
    const droplet = addPixelCircle(scene, frame.x, frame.y, Phaser.Math.FloatBetween(2, 3.6), i % 3 === 0 ? 0xffffff : color, 0.9);
    droplet.setBlendMode(Phaser.BlendModes.ADD).setDepth(RENDER_LAYERS.PLAYER_HUD + 2);
    pull.push({ droplet, angle, reach, delay: Phaser.Math.FloatBetween(0, 0.3), spin: Phaser.Math.FloatBetween(0.5, 1.1) * side });
  }
  const pullState = { t: 0 };
  tweenClaimEffect(username, pull.map((p) => p.droplet), {
    targets: pullState,
    t: 1,
    duration: CLAIM_SOAK.pullMs,
    onUpdate: () => {
      const f = frameFor(collector);
      for (const p of pull) {
        const local = Phaser.Math.Clamp((pullState.t - p.delay) / (1 - p.delay), 0, 1);
        // Burst out briefly, then accelerate inward on a slight spiral.
        const out = Math.sin(Math.min(1, local * 3.2) * Math.PI * 0.5);
        const inward = local * local * local;
        const distance = p.reach * (0.55 + out * 0.45) * (1 - inward);
        const a = p.angle + inward * p.spin;
        p.droplet.setPosition(f.x + Math.cos(a) * distance, f.y + Math.sin(a) * distance * 0.85);
        p.droplet.setScale(1 - inward * 0.7);
        p.droplet.setAlpha(local > 0 ? 0.9 * (1 - inward * 0.85) : 0);
      }
    },
  });
}

// A coloured copy of the fighter's frame laid over it. The colour drains from
// the head down to the feet, so the powerup reads as soaking into the body.
function soakSilhouette({ scene, Phaser, tweenClaimEffect, username, sprite, color }) {
  if (!scene?.add?.sprite || !sprite?.texture?.key) return;
  if (sprite.visible === false || !((sprite.alpha ?? 1) > 0.05)) return;
  const ghost = scene.add.sprite(sprite.x, sprite.y, sprite.texture.key, sprite.frame?.name);
  ghost.setOrigin(sprite.originX ?? 0.5, sprite.originY ?? 0.5);
  ghost.setDepth((Number(sprite.depth) || 0) + 1);
  // A light wash of the powerup colour leads the soak, so it never reads as the white hit flash.
  const light = Phaser.Display.Color.Interpolate.ColorWithColor(
    Phaser.Display.Color.ValueToColor(color), Phaser.Display.Color.ValueToColor(0xffffff), 100, 45);
  const lightColor = Phaser.Display.Color.GetColor(light.r, light.g, light.b);
  ghost.setTintFill(lightColor, lightColor, color, color);
  const soak = { t: 0 };
  const follow = () => {
    if (!sprite.active || !ghost.active) return;
    ghost.setPosition(sprite.x, sprite.y);
    ghost.setFlip(sprite.flipX, sprite.flipY);
    ghost.setScale(sprite.scaleX ?? 1, sprite.scaleY ?? 1);
    ghost.setRotation(sprite.rotation || 0);
    if (sprite.frame?.name !== ghost.frame?.name) ghost.setFrame(sprite.frame.name);
    const t = soak.t;
    const base = CLAIM_SOAK.soakAlpha * (sprite.alpha ?? 1);
    // Top switches to the powerup colour first, then drains ahead of the feet.
    const top = base * Math.max(0, 1 - t * 1.9);
    const bottom = base * Math.max(0, 1 - Math.max(0, t - 0.2) * 1.25);
    const topColor = t < 0.25 ? lightColor : color;
    ghost.setTintFill(topColor, topColor, color, color);
    ghost.setAlpha(top, top, bottom, bottom);
  };
  follow();
  tweenClaimEffect(username, [ghost], {
    targets: soak,
    t: 1,
    duration: CLAIM_SOAK.soakMs,
    ease: "Sine.easeIn",
    onUpdate: follow,
  });
}
