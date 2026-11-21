import { RENDER_LAYERS } from './renderLayers';
import { RESPAWN_GLOW, ensureSoftGlow } from './fx/glowTextures';
import { playPlayerSound } from '../audio/playerAudio';

// World-space arrival cue: never tween the fighter or delay their controls.
export function spawnRespawnEffect(scene, sprite, { silent = false } = {}) {
  if (!scene?.add || !scene?.tweens || !sprite || sprite.active === false) return;
  const body = sprite.body;
  const x = body?.center?.x ?? sprite.x;
  const bottom = body?.bottom ?? sprite.y;
  if (!Number.isFinite(x) || !Number.isFinite(bottom)) return;
  // Optional audio can still be loading when a player first respawns.
  if (!silent && scene.cache?.audio?.exists('sfx-respawn')) {
    playPlayerSound(scene, sprite, 'sfx-respawn', { volume: 0.22 });
  }
  const width = Math.max(36, Number(body?.width) || 48);
  const height = Math.max(60, Number(body?.height) || 80);
  const cyan = 0x11dfff;
  const white = 0xd9fbff;
  const blue = 0x087dff;
  const objects = new Set();
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    scene.events?.off('shutdown', cleanup);
    sprite.off?.('combat:reset', cleanup);
    sprite.off?.('destroy', cleanup);
    for (const object of objects) {
      scene.tweens.killTweensOf(object);
      object.destroy();
    }
    objects.clear();
  };
  scene.events?.once('shutdown', cleanup);
  sprite.once?.('combat:reset', cleanup);
  sprite.once?.('destroy', cleanup);
  const animate = (object, depth, config) => {
    objects.add(object);
    object.setDepth(depth);
    scene.tweens.add({
      targets: object,
      ease: 'Cubic.easeOut',
      ...config,
      onComplete: () => {
        objects.delete(object);
        object.destroy();
        if (!objects.size) cleanup();
      },
    });
  };
  const behind = RENDER_LAYERS.PLAYER - 1;
  const front = RENDER_LAYERS.PLAYER + 1;
  // Match the lobby arrival: soft blue column, bright core, floor flare
  // and thin rising streaks. Each layer is anchored to the arrival point.
  const beamHeight = height * 2.6;
  if (ensureSoftGlow(scene, RESPAWN_GLOW)) {
    const glow = (y, w, h, tint, alpha) => scene.add.image(x, y, RESPAWN_GLOW)
      .setDisplaySize(w, h).setTint(tint).setAlpha(alpha);
    animate(glow(bottom - beamHeight * 0.42, width * 2.1, beamHeight, cyan, 0.78), behind,
      { scaleX: '*=0.45', y: bottom - beamHeight * 0.55, alpha: 0, duration: 860 });
    animate(glow(bottom, width * 2, height * 0.32, blue, 0.95), front,
      { scaleX: '*=1.4', scaleY: '*=1.4', alpha: 0, duration: 670 });
  }
  const core = scene.add.rectangle(x, bottom - beamHeight / 2, width * 0.11, beamHeight, white, 0.85);
  animate(core, behind,
    { scaleX: 0.2, scaleY: 0.2, y: bottom - beamHeight * 0.76, alpha: 0, duration: 720 });

  const ring = scene.add.ellipse(x, bottom, width * 1.3, height * 0.17, cyan, 0);
  ring.setStrokeStyle(2, white, 0.75);
  animate(ring, front, { scaleX: 1.7, scaleY: 1.45, alpha: 0, duration: 760 });

  for (let i = 0; i < 9; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const sx = x + side * width * (0.14 + i * 0.045);
    const sy = bottom - height * (0.28 + (i % 3) * 0.21);
    const streak = i % 3 === 0;
    animate(scene.add.rectangle(sx, sy, streak ? 2 : 4,
      streak ? height * 0.72 : 7, [cyan, blue, white][i % 3], 0.8), front, {
      x: sx + side * width * 0.14,
      y: sy - height * 0.68,
      alpha: 0,
      scaleY: 0.28,
      duration: 470 + (i % 3) * 60,
      delay: i * 29,
    });
  }
  return cleanup;
}
