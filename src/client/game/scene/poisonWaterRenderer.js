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
  const worldHeight =
    Number(scene.physics?.world?.bounds?.height) ||
    Number(scene.game.config.height) ||
    1000;
  const worldH = (Number(scene.physics?.world?.bounds?.y) || 0) + worldHeight;
  if (scene._poisonWaterY == null) scene._smoothPoisonY = worldH + 60;
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

    // Chunky pixel-art water: everything snaps to a PX grid, flat palette steps,
    // dithered band edges, square bubbles. No gradients or round strokes.
    const PX = 4;
    const amp = 7;
    // Standing wave: the surface bobs in place instead of travelling sideways.
    const waveY = (x) =>
      py +
      amp * Math.sin(x * 0.011 + 1.3) * Math.cos(t * 1.7) +
      amp * 0.4 * Math.sin(x * 0.024) * Math.cos(t * 1.1);
    const snap = (v) => Math.round(v / PX) * PX;

    // One flat translucent body, a lighter top strip and a bright rim. No bands.
    const BODY = 0x2f7d1e;
    const cols = Math.ceil(W / PX);
    for (let c = 0; c < cols; c++) {
      const x = c * PX;
      const top = snap(waveY(x + PX / 2));
      g.fillStyle(BODY, 0.78);
      g.fillRect(x, top, PX, BOTTOM - top);
      // Checkerboard-dithered lighter pixels just under the rim.
      g.fillStyle(0x62b32c, 0.78);
      g.fillRect(x, top + PX, PX, PX);
      if ((c & 1) === 0) g.fillRect(x, top + 2 * PX, PX, PX);
      g.fillStyle(0xbdea5c, 1);
      g.fillRect(x, top, PX, PX);
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
      if (alpha < 0.25) continue;
      // Square pixel bubble: light outline with a darker hollow and one glint pixel.
      const size = b.r > 2.4 ? 3 * PX : b.r > 1.9 ? 2 * PX : PX;
      const bx = snap(bX);
      const by = snap(b.y);
      g.fillStyle(0xd9f99d, 0.85);
      g.fillRect(bx, by, size, size);
      if (size > 2 * PX) {
        g.fillStyle(0x3f8e22, 0.9);
        g.fillRect(bx + PX, by + PX, size - 2 * PX, size - 2 * PX);
      }
      if (size > PX) {
        g.fillStyle(0xffffff, 1);
        g.fillRect(bx, by, PX, PX);
      }
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
