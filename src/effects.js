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

// Note: character-specific effects (like Draven's fire trail) live in
// their own files under src/characters/<char>/effects.js.
