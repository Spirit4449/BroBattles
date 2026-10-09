// gameScene/poisonWaterRenderer.js

export function renderPoisonWater(scene, { player, dead }) {
  if (!scene?._poisonGraphics) return;

  const now = scene.time.now;
  // Advance particles independently of the changing water depth. Cap tab-resume gaps.
  const dt = scene._poisonLastFrame == null ? 0 :
    Math.max(0, Math.min(0.05, (now - scene._poisonLastFrame) / 1000));
  scene._poisonLastFrame = now;
  const g = scene._poisonGraphics;
  g.clear();
  const damagePulseActive = !!scene._damageVignetteTween;
  const spectatorVignette = !!scene._spectatorVignette;

  // Smooth-lerp toward server-sent Y so 500ms updates don't cause visible jumps
  const worldH =
    Number(scene.physics?.world?.bounds?.height) ||
    Number(scene.game.config.height) ||
    1000;
  if (scene._smoothPoisonY == null)
    scene._smoothPoisonY = scene._poisonWaterY ?? worldH + 60;
  const poisonTargetY = scene._poisonWaterY ?? worldH + 60;
  const poisonDelta = poisonTargetY - scene._smoothPoisonY;
  const poisonLerp = Math.abs(poisonDelta) > 60 ? 0.2 : 0.07;
  scene._smoothPoisonY += poisonDelta * (1 - Math.pow(1 - poisonLerp, dt * 60));
  const py = scene._smoothPoisonY;

  if (py < worldH + 10) {
    const W =
      Number(scene.physics?.world?.bounds?.width) ||
      Number(scene.game.config.width) ||
      1300;
    const BOTTOM = worldH + 40;
    const t = scene.time.now / 1000;

    const amp = 7;
    const waveY = (x) =>
      py +
      amp * Math.sin(x * 0.011 + t * 1.7) +
      amp * 0.4 * Math.sin(x * 0.024 - t * 1.1);

    // Reuse the same sampled surface for the dense poison body and luminous rim.
    const surface = [];
    for (let x = 0; x < W; x += 8) surface.push({ x, y: waveY(x) });
    surface.push({ x: W, y: waveY(W) });
    g.fillStyle(0x286b12, 0.78);
    g.fillPoints([{ x: 0, y: BOTTOM }, ...surface, { x: W, y: BOTTOM }], true);

    // Acid-green bands brighten the surface above the dense murky body.
    for (let band = 0; band < 8; band++) {
      const top = band * 9;
      const bottom = top + 9;
      g.fillStyle(0x84cc16, 0.32 * (1 - band / 8));
      g.fillPoints([
        ...surface.map(p => ({ x: p.x, y: p.y + top })),
        ...surface.slice().reverse().map(p => ({ x: p.x, y: p.y + bottom })),
      ], true);
    }
    for (const [width, color, alpha] of [
      [12, 0x84cc16, 0.12], [6, 0xa3e635, 0.24], [2, 0xd9f99d, 0.95],
    ]) {
      g.lineStyle(width, color, alpha);
      g.beginPath();
      surface.forEach((p, i) => i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y));
      g.strokePath();
    }

    for (const b of scene._poisonBubbles || []) {
      const floor = BOTTOM - 10;
      const range = floor - (py + amp + 8);
      if (range <= 0) { b.y = null; continue; }
      if (b.y == null) {
        b.y = floor - ((b.phase * 0.618) % 1) * range;
      } else {
        b.y -= b.speed * dt;
      }
      const bX = b.x + b.drift * Math.sin(t * 1.1 + b.phase);
      const depth = b.y - waveY(bX);
      if (depth < -b.r * 2) {
        b.y = floor;
        continue;
      }
      const alpha = Math.max(0, Math.min(1, depth / 18, (floor - b.y) / 20));
      // Soft translucent centers, a fine rim, and a small reflected highlight.
      g.fillStyle(0xa3e635, alpha * 0.22);
      g.fillCircle(bX, b.y, b.r * 1.6);
      g.lineStyle(1, 0xd9f99d, alpha * 0.6);
      g.strokeCircle(bX, b.y, b.r * 1.6);
      g.fillStyle(0xf7fee7, alpha * 0.75);
      g.fillCircle(bX - b.r * 0.45, b.y - b.r * 0.55, b.r * 0.4);
    }

    const cssDiv = document.getElementById("poison-water-bg");
    if (cssDiv) {
      const canvasH = scene.game.canvas.clientHeight || 650;
      const frac = Math.max(0, Math.min(1, (worldH - py) / worldH));
      cssDiv.style.height = Math.floor(frac * canvasH) + "px";
      cssDiv.style.display = "block";

      const vigEl = document.getElementById("water-vignette");
      if (vigEl) {
        const inWater = player && player.y >= py;
        const showDanger = !!inWater && !dead && !damagePulseActive;
        vigEl.style.background = spectatorVignette
          ? "radial-gradient(ellipse at center, transparent 34%, rgba(15, 23, 42, 0.72) 100%)"
          : "radial-gradient(ellipse at center, transparent 38%, rgba(185, 28, 28, 0.68) 100%)";
        vigEl.classList.toggle("water-danger-active", showDanger);
        // The hit tween owns opacity until its single fade completes.
        if (!damagePulseActive) {
          if (spectatorVignette) {
            vigEl.style.opacity = "0.42";
          } else if (!inWater || dead) {
            vigEl.style.opacity = "0";
          }
        }
      }
    }
  } else {
    const cssDiv = document.getElementById("poison-water-bg");
    if (cssDiv) cssDiv.style.display = "none";
    const vigEl = document.getElementById("water-vignette");
    if (vigEl) {
      vigEl.style.background = spectatorVignette
        ? "radial-gradient(ellipse at center, transparent 34%, rgba(15, 23, 42, 0.72) 100%)"
        : "radial-gradient(ellipse at center, transparent 38%, rgba(185, 28, 28, 0.68) 100%)";
      vigEl.classList.remove("water-danger-active");
      if (!damagePulseActive) {
        vigEl.style.opacity = spectatorVignette ? "0.42" : "0";
      }
    }
  }
}
