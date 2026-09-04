import { RENDER_LAYERS } from "./renderLayers";

export function findTombstoneGround(x, feetY, objects) {
  if (!Number.isFinite(x) || !Number.isFinite(feetY)) return null;
  let nearest = null;
  let distance = Infinity;
  for (const object of objects || []) {
    const body = object?.body;
    if (!body || body.enable === false || body.checkCollision?.none ||
        body.checkCollision?.up === false) continue;
    if (x < body.left || x > body.right || body.right - body.left < 24) continue;
    const gap = body.top - feetY;
    // A little overlap tolerance accommodates the last network/physics frame.
    if (gap < -8 || gap > 40 || Math.abs(gap) >= distance) continue;
    nearest = object;
    distance = Math.abs(gap);
  }
  return nearest;
}

export function spawnDeathTombstone(scene, payload, player) {
  if (!scene?.add || !payload) return;
  const x = Number(payload.x);
  const y = Number(payload.y);
  const feetOffset = player?.body ? player.body.bottom - player.y : 30;
  const ground = findTombstoneGround(x, y + feetOffset, scene._mapObjects);
  if (!ground) return;

  // Hash the unique death event so its random-looking variant agrees on every client.
  const key = `${payload.username}:${payload.at}`;
  let hash = 0;
  for (const char of key) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  const texture = `tombstone-${(hash >>> 0) % 3 + 1}`;
  if (!scene.textures.exists(texture)) return;
  const stones = scene._deathTombstones || (scene._deathTombstones = new Map());
  if (stones.has(key)) return;

  const stone = scene.add.image(x, ground.body.top + 1, texture)
    .setOrigin(0.5, 1).setDepth(RENDER_LAYERS.GAME_OBJECTS - 1);
  const scale = Math.min(42 / stone.height, (ground.body.right - ground.body.left) / stone.width);
  stone.setScale(scale);
  const halfWidth = stone.displayWidth / 2;
  stone.x = Math.max(ground.body.left + halfWidth,
    Math.min(ground.body.right - halfWidth, x));
  const offsetX = stone.x - ground.body.left;
  const anchor = () => {
    if (!ground.active || !ground.body?.enable) {
      stone.destroy();
      return;
    }
    stone.setPosition(ground.body.left + offsetX, ground.body.top + 1);
  };
  scene.events.on("update", anchor);
  const cleanup = () => stone.destroy();
  scene.events.once("shutdown", cleanup);
  stone.once("destroy", () => {
    scene.events.off("update", anchor);
    scene.events.off("shutdown", cleanup);
    stones.delete(key);
  });
  stones.set(key, stone);
  // Leave memorials for the match, with a bound for long respawning rounds.
  if (stones.size > 32) stones.values().next().value.destroy();
}
