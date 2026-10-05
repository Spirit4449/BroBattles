// gameScene/poisonWaterRenderer.js

export function renderPoisonWater(scene, { player, dead }) {
  if (!scene?._poisonGraphics) return;

  const g = scene._poisonGraphics;
  g.clear();
  const damagePulseActive = (scene._damageVignetteUntil || 0) > Date.now();
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
  scene._smoothPoisonY += poisonDelta * poisonLerp;
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

    const basePts = [{ x: 0, y: BOTTOM }];
    for (let x = 0; x <= W; x += 8) basePts.push({ x, y: waveY(x) });
    basePts.push({ x: W, y: BOTTOM });
    g.fillStyle(0x166534, 0.48);
    g.fillPoints(basePts, true);

    const midPts = [{ x: 0, y: BOTTOM }];
    for (let x = 0; x <= W; x += 8) midPts.push({ x, y: waveY(x) + 16 });
    midPts.push({ x: W, y: BOTTOM });
    g.fillStyle(0x16a34a, 0.27);
    g.fillPoints(midPts, true);

    g.lineStyle(3, 0x4ade80, 0.95);
    g.beginPath();
    for (let x = 0; x <= W; x += 8) {
      x === 0 ? g.moveTo(x, waveY(x)) : g.lineTo(x, waveY(x));
    }
    g.strokePath();

    g.fillStyle(0xd1fae5, 0.85);
    for (let x = 20; x < W; x += 55) {
      const wy = waveY(x);
      const r = 1.8 + 1.4 * Math.abs(Math.sin(t * 1.3 + x * 0.05));
      g.fillCircle(x + 8 * Math.sin(t * 0.9 + x * 0.03), wy - r * 0.3, r);
    }

    for (const b of scene._poisonBubbles || []) {
      const range = BOTTOM - 20 - (py + amp + 8);
      if (range <= 0) continue;
      const elapsed = (t + b.phase * 4) % (range / b.speed);
      const bY = BOTTOM - 20 - elapsed * b.speed;
      if (bY < py + amp || bY > BOTTOM - 5) continue;
      const bX = b.x + b.drift * Math.sin(t * 0.7 + b.phase);
      const alpha = Math.min(0.6, (bY - py) / 35) * 0.9;
      g.fillStyle(0x86efac, alpha);
      g.fillCircle(bX, bY, b.r);
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
        const showDanger = (!!inWater && !dead) || damagePulseActive;
        vigEl.style.background = spectatorVignette
          ? "radial-gradient(ellipse at center, transparent 34%, rgba(15, 23, 42, 0.72) 100%)"
          : "radial-gradient(ellipse at center, transparent 38%, rgba(185, 28, 28, 0.68) 100%)";
        vigEl.classList.toggle("water-danger-active", showDanger);
        if (damagePulseActive) {
          vigEl.style.opacity = "0.72";
        } else if (spectatorVignette) {
          vigEl.style.opacity = "0.42";
        } else if (!inWater || dead) {
          vigEl.style.opacity = "0";
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
      if (damagePulseActive) {
        vigEl.classList.add("water-danger-active");
        vigEl.style.opacity = "0.72";
      } else if (spectatorVignette) {
        vigEl.classList.remove("water-danger-active");
        vigEl.style.opacity = "0.42";
      } else {
        vigEl.classList.remove("water-danger-active");
        vigEl.style.opacity = "0";
      }
    }
  }
}
