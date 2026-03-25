// effects.js
// Shared lightweight VFX helpers (dust / smoke puffs for running)

const dustPool = [];
const dustPoolMax = 120;
const markerPool = new Set();

export function spawnDust(scene, x, y, tint = 0xbbbbbb) {
  let g = dustPool.find((o) => !o.active);
  if (!g) {
    g = scene.add.graphics();
    dustPool.push(g);
  }
  g.active = true;
  g.clear();
  g.setDepth(1); // behind players (player depth assumed >1 for main sprite)
  const baseSize = Phaser.Math.Between(6, 10);
  // Slightly higher starting alpha range for better visibility
  const alphaStart = Phaser.Math.FloatBetween(0.45, 0.65);
  const puffColor = Phaser.Display.Color.IntegerToColor(tint);
  // Outer soft ring
  g.fillStyle(puffColor.color, alphaStart * 0.6);
  g.fillCircle(0, 0, baseSize);
  // Inner denser core
  g.fillStyle(puffColor.color, alphaStart);
  g.fillCircle(0, 0, baseSize * 0.55);
  g.x = x + Phaser.Math.Between(-4, 4);
  g.y = y + Phaser.Math.Between(-2, 2);
  const rise = Phaser.Math.Between(10, 22);
  const driftX = Phaser.Math.Between(-12, 12);
  const scaleTarget = Phaser.Math.FloatBetween(1.2, 1.6);
  const duration = Phaser.Math.Between(380, 520);
  g.scale = 1;
  g.alpha = alphaStart;
  scene.tweens.add({
    targets: g,
    x: g.x + driftX,
    y: g.y - rise,
    alpha: 0,
    scale: scaleTarget,
    duration,
    ease: "Cubic.easeOut",
    onComplete: () => {
      g.active = false;
      g.alpha = 1;
      g.scale = 1;
      g.clear();
    },
  });
  if (dustPool.length > dustPoolMax) {
    const old = dustPool.find((o) => !o.active);
    if (old) {
      old.destroy();
      const idx = dustPool.indexOf(old);
      if (idx >= 0) dustPool.splice(idx, 1);
    }
  }
}

export function spawnWallKickCloud(
  scene,
  x,
  y,
  direction = 1,
  tint = 0xd9d9d9,
) {
  if (!scene || !scene.add) return;
  const puffs = Phaser.Math.Between(2, 6);
  const push = direction >= 0 ? 1 : -1;

  for (let i = 0; i < puffs; i++) {
    const g = scene.add.graphics();
    g.setDepth(4);
    g.fillStyle(tint, Phaser.Math.FloatBetween(0.62, 0.84));
    const r = Phaser.Math.Between(6, 12);
    g.fillCircle(0, 0, r);
    g.x = x + Phaser.Math.Between(-4, 4);
    g.y = y + Phaser.Math.Between(-5, 5);

    scene.tweens.add({
      targets: g,
      x: g.x - push * Phaser.Math.Between(18, 34),
      y: g.y - Phaser.Math.Between(8, 20),
      alpha: 0,
      scaleX: Phaser.Math.FloatBetween(1.25, 1.9),
      scaleY: Phaser.Math.FloatBetween(1.25, 1.9),
      duration: Phaser.Math.Between(250, 380),
      ease: "Cubic.easeOut",
      onComplete: () => g.destroy(),
    });
  }

  // Sharp impulse streak at the wall contact point to sell kickback.
  const streak = scene.add.graphics();
  streak.setDepth(4);
  streak.fillStyle(0xffffff, 0.65);
  const w = Phaser.Math.Between(12, 18);
  const h = Phaser.Math.Between(4, 6);
  streak.fillRoundedRect(-w / 2, -h / 2, w, h, 2);
  streak.x = x;
  streak.y = y;
  streak.rotation = push > 0 ? Math.PI : 0;
  scene.tweens.add({
    targets: streak,
    x: x - push * Phaser.Math.Between(20, 32),
    alpha: 0,
    scaleX: 2,
    duration: 160,
    ease: "Sine.easeOut",
    onComplete: () => streak.destroy(),
  });
}

export function prewarmDust(scene, count = 6) {
  for (let i = 0; i < count; i++) {
    spawnDust(scene, -9999, -9999);
  }
  dustPool.forEach((g) => {
    g.active = false;
    g.clear();
  });
}

export function spawnHealthMarker(scene, x, y, delta, opts = {}) {
  if (!scene || !scene.add) return null;
  if (!Number.isFinite(delta) || delta === 0) return null;
  const rounded = Math.round(delta);
  if (rounded === 0) return null;
  const positive = rounded > 0;
  const color = positive ? "#23d88c" : "#ff5c5c";
  const strokeColor = positive ? "#0a3f28" : "#5a0a0a";
  const label = `${positive ? "+" : "-"}${Math.abs(rounded)}`;
  const depth = typeof opts.depth === "number" ? opts.depth : 12;
  const fontSize = opts.fontSize || "13px";
  const marker = scene.add.text(x, y, label, {
    fontFamily: "Poppins, 'Arial Black', sans-serif",
    fontSize,
    fontStyle: "400",
    color,
    stroke: strokeColor,
    strokeThickness: 6,
    padding: { x: 10, y: 4 },
  });
  marker.setOrigin(0.5);
  marker.setDepth(depth);
  marker.setShadow(0, 4, "rgba(0,0,0,0.35)", 4, true, true);
  markerPool.add(marker);
  const float = opts.floatDistance || 38;
  const duration = opts.duration || 620;
  scene.tweens.add({
    targets: marker,
    y: y - float,
    alpha: 0.2,
    scale: 1.18,
    duration,
    ease: "Cubic.easeOut",
    onComplete: () => {
      markerPool.delete(marker);
      marker.destroy();
    },
  });
  return marker;
}

export function spawnDamageImpact(scene, sprite, opts = {}) {
  if (!scene?.add || !sprite?.active) return;

  const body = sprite.body;
  const cx = Number(body?.center?.x) || sprite.x;
  const cy = Number(body?.center?.y) || sprite.y;
  const top = Number(body?.top) || cy - (sprite.height || 80) * 0.5;
  const bottom = Number(body?.bottom) || cy + (sprite.height || 80) * 0.5;
  const left = Number(body?.left) || cx - (sprite.width || 60) * 0.5;
  const right = Number(body?.right) || cx + (sprite.width || 60) * 0.5;
  const color = opts.color || 0xff4d6d;
  const glowColor = opts.glowColor || 0xff9aa2;
  const depth = typeof opts.depth === "number" ? opts.depth : 24;

  const flash = scene.add.ellipse(
    cx,
    cy,
    Math.max(34, right - left + 18),
    Math.max(44, bottom - top + 18),
    color,
    0.22,
  );
  flash.setDepth(depth);
  flash.setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: flash,
    alpha: 0,
    scaleX: 1.35,
    scaleY: 1.35,
    duration: 140,
    ease: "Quad.easeOut",
    onComplete: () => flash.destroy(),
  });

  const ring = scene.add.circle(
    cx,
    cy,
    Math.max(18, (right - left) * 0.36),
    color,
    0.14,
  );
  ring.setDepth(depth);
  ring.setStrokeStyle(4, glowColor, 0.95);
  ring.setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: ring,
    alpha: 0,
    scaleX: 1.6,
    scaleY: 1.6,
    duration: 190,
    ease: "Cubic.easeOut",
    onComplete: () => ring.destroy(),
  });

  const particleCount = Phaser.Math.Between(6, 10);
  for (let i = 0; i < particleCount; i++) {
    const p = scene.add.circle(
      Phaser.Math.Between(left, right),
      Phaser.Math.Between(top, bottom),
      Phaser.Math.Between(3, 6),
      i % 3 === 0 ? glowColor : color,
      Phaser.Math.FloatBetween(0.72, 0.95),
    );
    p.setDepth(depth);
    p.setBlendMode(Phaser.BlendModes.ADD);
    const angle = Phaser.Math.FloatBetween(-Math.PI, Math.PI);
    const speed = Phaser.Math.Between(26, 58);
    scene.tweens.add({
      targets: p,
      x: p.x + Math.cos(angle) * speed,
      y: p.y + Math.sin(angle) * speed,
      alpha: 0,
      scaleX: Phaser.Math.FloatBetween(0.8, 1.8),
      scaleY: Phaser.Math.FloatBetween(0.8, 1.8),
      duration: Phaser.Math.Between(140, 220),
      ease: "Cubic.easeOut",
      onComplete: () => p.destroy(),
    });
  }

  for (let i = 0; i < 3; i++) {
    const g = scene.add.graphics();
    g.setDepth(depth);
    g.fillStyle(glowColor, 0.88 - i * 0.18);
    const w = Phaser.Math.Between(18, 26);
    const h = Phaser.Math.Between(4, 6);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 2);
    g.x = cx + Phaser.Math.Between(-8, 8);
    g.y = cy + Phaser.Math.Between(-10, 10);
    g.rotation = Phaser.Math.FloatBetween(-1.1, 1.1);
    g.setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: g,
      x: g.x + Phaser.Math.Between(-26, 26),
      y: g.y + Phaser.Math.Between(-26, 26),
      alpha: 0,
      scaleX: 1.8,
      duration: 150,
      ease: "Sine.easeOut",
      onComplete: () => g.destroy(),
    });
  }
}

export function spawnDeathBurst(scene, sprite, opts = {}) {
  if (!scene?.add || !sprite) return;

  const body = sprite.body;
  const cx = Number(body?.center?.x) || Number(sprite.x) || 0;
  const cy = Number(body?.center?.y) || Number(sprite.y) || 0;
  const color = opts.color || 0xff8fb1;
  const glowColor = opts.glowColor || 0xffd3df;
  const depth = typeof opts.depth === "number" ? opts.depth : 26;

  const core = scene.add.circle(cx, cy, 26, color, 0.24);
  core.setDepth(depth);
  core.setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: core,
    alpha: 0,
    scaleX: 2.2,
    scaleY: 2.2,
    duration: 260,
    ease: "Cubic.easeOut",
    onComplete: () => core.destroy(),
  });

  const halo = scene.add.circle(cx, cy, 40, glowColor, 0.12);
  halo.setDepth(depth);
  halo.setStrokeStyle(5, glowColor, 0.95);
  halo.setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: halo,
    alpha: 0,
    scaleX: 1.8,
    scaleY: 1.8,
    duration: 340,
    ease: "Cubic.easeOut",
    onComplete: () => halo.destroy(),
  });

  for (let i = 0; i < 12; i++) {
    const spark = scene.add.circle(
      cx,
      cy,
      Phaser.Math.Between(3, 6),
      i % 3 === 0 ? glowColor : color,
      Phaser.Math.FloatBetween(0.72, 0.96),
    );
    spark.setDepth(depth);
    spark.setBlendMode(Phaser.BlendModes.ADD);
    const angle = (Math.PI * 2 * i) / 12 + Phaser.Math.FloatBetween(-0.12, 0.12);
    const speed = Phaser.Math.Between(44, 96);
    scene.tweens.add({
      targets: spark,
      x: cx + Math.cos(angle) * speed,
      y: cy + Math.sin(angle) * speed,
      alpha: 0,
      scaleX: Phaser.Math.FloatBetween(0.8, 1.6),
      scaleY: Phaser.Math.FloatBetween(0.8, 1.6),
      duration: Phaser.Math.Between(220, 320),
      ease: "Cubic.easeOut",
      onComplete: () => spark.destroy(),
    });
  }

  for (let i = 0; i < 5; i++) {
    const streak = scene.add.graphics();
    streak.setDepth(depth);
    streak.fillStyle(glowColor, 0.9 - i * 0.1);
    const w = Phaser.Math.Between(18, 28);
    const h = Phaser.Math.Between(4, 6);
    streak.fillRoundedRect(-w / 2, -h / 2, w, h, 2);
    streak.x = cx;
    streak.y = cy;
    streak.rotation = Phaser.Math.FloatBetween(-Math.PI, Math.PI);
    streak.setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: streak,
      x: cx + Math.cos(streak.rotation) * Phaser.Math.Between(52, 88),
      y: cy + Math.sin(streak.rotation) * Phaser.Math.Between(52, 88),
      alpha: 0,
      scaleX: 1.9,
      duration: Phaser.Math.Between(200, 280),
      ease: "Sine.easeOut",
      onComplete: () => streak.destroy(),
    });
  }
}

export function triggerDamageScreenPulse(scene, opts = {}) {
  if (!scene) return;
  const vigEl = document.getElementById("water-vignette");
  if (!vigEl) return;

  scene._damageVignetteUntil = Date.now() + (opts.durationMs || 220);
  scene._damageVignetteAlpha = opts.alpha || 0.74;
  vigEl.classList.add("water-danger-active");

  try {
    scene._damageVignetteTween?.stop?.();
  } catch (_) {}
  scene._damageVignetteTween = null;

  const pulseState = { alpha: scene._damageVignetteAlpha };
  vigEl.style.opacity = String(pulseState.alpha);
  scene._damageVignetteTween = scene.tweens?.add?.({
    targets: pulseState,
    alpha: 0,
    duration: opts.durationMs || 220,
    ease: "Quad.easeOut",
    onUpdate: () => {
      vigEl.style.opacity = String(pulseState.alpha);
    },
    onComplete: () => {
      if (
        (scene._poisonWaterY ?? Infinity) >
        (Number(scene.scale?.height) || Number(scene.game?.config?.height) || 1000) + 10
      ) {
        vigEl.classList.remove("water-danger-active");
      }
      if ((scene._damageVignetteUntil || 0) <= Date.now()) {
        vigEl.style.opacity = "0";
      }
      scene._damageVignetteTween = null;
    },
  });
}

// Note: character-specific effects (like Draven's fire trail) live in
// their own files under src/characters/<char>/effects.js.
