// Remote and authoritative copies of the same action can both arrive. Returns
// true the first time `id` is seen in `bucket` within `ttlMs` for this scene.
// Missing IDs are never deduplicated.
export function consumeOnce(scene, bucket, id, ttlMs = 5000) {
  const key = String(id || "").trim();
  if (!key || !scene) return true;
  scene._bbSeenPackets ||= new Map();
  let seen = scene._bbSeenPackets.get(bucket);
  if (!seen) scene._bbSeenPackets.set(bucket, (seen = new Map()));
  const now = Date.now();
  for (const [seenKey, seenAt] of seen) {
    if (now - seenAt > ttlMs) seen.delete(seenKey);
  }
  if (seen.has(key)) return false;
  seen.set(key, now);
  return true;
}
