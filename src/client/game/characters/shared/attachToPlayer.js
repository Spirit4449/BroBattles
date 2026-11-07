// One lifecycle for anything drawn on or around a player: it follows the
// sprite every frame, sits at a depth relative to it, and is cleaned up on
// every way it can end (its own lifetime, the player dying or being destroyed,
// scene shutdown, a presentation reset, or a sprite event such as an attack
// being interrupted). Effects describe what to draw; this owns when.
//
//   const fx = attachToPlayer(scene, sprite, {
//     key: "wizard-super",            // a new attachment with this key replaces the old
//     layers: ["floor", "front"],     // graphics created at depths relative to the sprite
//     lifetimeMs: 1800,
//     update(ms, dt, { floor, front }) { ... return false to end early },
//   });
// `fx.detach()` ends it but keeps its objects, for handing them on.

// Depth offsets from the player sprite.
export const PLAYER_LAYERS = { floor: -1.5, behind: -1, front: 2 };

export function playerLayer(scene, sprite, layer = "front") {
  const offset = PLAYER_LAYERS[layer] ?? PLAYER_LAYERS.front;
  return scene.add.graphics().setDepth((sprite.depth || 20) + offset);
}

const isGone = (sprite) => !sprite?.active || sprite.body?.enable === false;

export function attachToPlayer(scene, sprite, {
  key = null,
  layers = [],
  objects = [],
  lifetimeMs = Infinity,
  stage = "postupdate",
  endsWithPlayer = true,
  endOn = [],
  update = null,
  onEnd = null,
} = {}) {
  if (!scene?.events || !sprite) return null;
  const attachments = (sprite._bbAttachments ||= new Map());
  if (key) attachments.get(key)?.destroy();
  const drawn = Object.fromEntries(layers.map((name) => [name, playerLayer(scene, sprite, name)]));
  const owned = [...Object.values(drawn), ...objects];
  let ms = 0;
  let ended = false;
  let keepObjects = false;
  const destroy = () => {
    if (ended) return;
    ended = true;
    scene.events.off(stage, tick);
    scene.events.off("shutdown", destroy);
    scene.events.off("presentation:reset", destroy);
    sprite.off?.("destroy", destroy);
    for (const event of endOn) sprite.off?.(event, destroy);
    if (key && attachments.get(key) === handle) attachments.delete(key);
    onEnd?.();
    if (!keepObjects) for (const object of owned) object?.destroy?.();
  };
  // Stops following and cleans up listeners, but hands the objects over to
  // whoever takes them next (a charged ball becoming a flying one).
  const detach = () => { keepObjects = true; destroy(); };
  const tick = (_time, delta = 16.67) => {
    if (endsWithPlayer && isGone(sprite)) return destroy();
    // Real elapsed time: effects stay in step with the animations and timers
    // they accompany even across a long frame.
    const dt = Math.max(0, Number(delta) || 0);
    ms += dt;
    if (ms >= lifetimeMs) return destroy();
    if (update?.(ms, dt, drawn) === false) destroy();
  };
  const handle = { destroy, detach, get elapsed() { return ms; }, get active() { return !ended; }, layers: drawn };
  if (key) attachments.set(key, handle);
  scene.events.on(stage, tick);
  scene.events.once("shutdown", destroy);
  scene.events.once("presentation:reset", destroy);
  sprite.once?.("destroy", destroy);
  for (const event of endOn) sprite.once?.(event, destroy);
  update?.(0, 0, drawn);
  return handle;
}
