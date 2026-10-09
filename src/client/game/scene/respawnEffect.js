import { RENDER_LAYERS } from './renderLayers';
import { playPlayerSound } from '../audio/playerAudio';

// World-space arrival cue: never tween the fighter or delay their controls.
export function spawnRespawnEffect(scene, sprite) {
  if (!scene?.add || !scene?.tweens || !sprite || sprite.active === false) return;
  const body = sprite.body;
  const x = body?.center?.x ?? sprite.x;
  const bottom = body?.bottom ?? sprite.y;
  if (!Number.isFinite(x) || !Number.isFinite(bottom)) return;
  // Optional audio can still be loading when a player first respawns.
  if (scene.cache?.audio?.exists('sfx-respawn')) {
    playPlayerSound(scene, sprite, 'sfx-respawn', { volume: 0.5 });
  }
  const width = Math.max(36, Number(body?.width) || 48);
  const height = Math.max(60, Number(body?.height) || 80);
  const cyan = 0x74e8ff;
  const white = 0xf1fcff;
  const objects = new Set();
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    scene.events?.off('shutdown', cleanup);
    sprite.off?.('destroy', cleanup);
    for (const object of objects) {
      scene.tweens.killTweensOf(object);
      object.destroy();
    }
    objects.clear();
  };
  scene.events?.once('shutdown', cleanup);
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
  // A tall translucent beam collapses into a bright central filament.
  animate(scene.add.rectangle(x, bottom - height * 0.8, width * 1.7,
    height * 1.7, cyan, 0.18), behind,
  { scaleX: 0.08, alpha: 0, duration: 520 });
  animate(scene.add.rectangle(x, bottom - height * 0.8, 5,
    height * 1.7, white, 0.85), behind,
  { scaleY: 0.2, alpha: 0, duration: 360 });
  for (let i = 0; i < 2; i++) {
    const ring = scene.add.ellipse(x, bottom, width * 1.25, 16, cyan, 0);
    ring.setStrokeStyle(i ? 2 : 4, i ? white : cyan, 0.9);
    animate(ring, front, {
      scaleX: 2.5, scaleY: 2, alpha: 0, duration: 550,
      delay: i * 100,
    });
  }
  // Staggered pixel motes rise around the body, leaving its silhouette readable.
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI * 2 / 12;
    const sx = x + Math.cos(angle) * width * 0.65;
    const sy = bottom - 5 - (i % 3) * height * 0.18;
    animate(scene.add.rectangle(sx, sy, i % 3 ? 3 : 5, i % 3 ? 3 : 5,
      i % 3 ? cyan : white, 0.9), front, {
      x: sx + Math.cos(angle) * 12,
      y: sy - height * 0.8, alpha: 0, scaleX: 0.3, scaleY: 0.3,
      duration: 460 + (i % 3) * 70, delay: (i % 4) * 35,
    });
  }
  return cleanup;
}
