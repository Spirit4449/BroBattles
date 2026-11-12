import { bodyBounds, playerAnchor } from "../characters/shared/rig";
import { getCloudSystem } from "../scene/clouds/cloudLayer";
import { emitPuff } from "../scene/clouds/cloudEmitters";

/** Lay smoke along the fighter's actual flight path after a shockwave hit. */
export function spawnShockwaveHitSmoke(scene, sprite, impulse = {}) {
  if (!sprite?.active) return;
  const centre = playerAnchor(sprite, "centre");
  if (!Number.isFinite(centre?.x) || !Number.isFinite(centre?.y)) return;
  const system = getCloudSystem(scene);
  if (!system) return;
  const vx = Number(impulse.amountX) || 0;
  const vy = Number(impulse.amountY) || 0;
  const speed = Math.hypot(vx, vy);
  let nx = speed ? vx / speed : 0;
  let ny = speed ? vy / speed : -1;
  const width = bodyBounds(sprite)?.width || 50;
  const size = Math.max(12, Math.min(22, width * 0.3));
  let lastX = centre.x;
  let lastY = centre.y;
  function emit(sim, x, y, progress) {
    const dx = x - lastX;
    const dy = y - lastY;
    const distance = Math.hypot(dx, dy);
    if (distance > 0) {
      nx = dx / distance;
      ny = dy / distance;
    }
    lastX = x;
    lastY = y;
    emitPuff(sim, {
      x: x - nx * size,
      y: y - ny * size,
      vx: -nx * 30,
      vy: -ny * 20 - 15,
      size: size * (1 - progress * 0.45),
      lobes: 3,
      layer: "back",
      pop: true,
      opacity: 0.95,
      lifeScale: 1.1,
    });
  }
  emit(system.sim, centre.x, centre.y, 0);
  // Read the rendered body each frame, including interpolated remote players.
  // Distance spacing fills fast movement without piling smoke onto a stopped body.
  system.follow({
    get active() { return sprite.active; },
    get x() { return playerAnchor(sprite, "centre")?.x; },
    get y() { return playerAnchor(sprite, "centre")?.y; },
  }, {
    durationMs: 650,
    spacing: size * 0.8,
    emit,
  });
}
