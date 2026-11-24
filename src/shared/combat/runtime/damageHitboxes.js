// Publish the same geometry used by damage checks, before filtering targets.
// Samples live briefly so attacks ending between snapshots remain inspectable.
const SAMPLE_TTL_MS = 120;
function exposeDamageHitbox(room, source, shape, now = Date.now(), part = 'body') {
  if (!room?.matchData?.editorDebugHitboxes) return;
  const owner = source.attackerName || source.ownerName || '';
  const id = `${owner}:${source.instanceId || source.id}:${part}`;
  room.damageHitboxes ||= new Map();
  room.damageHitboxes.set(id, { id, owner, ...shape, expiresAt: now + SAMPLE_TTL_MS });
}
function damageHitboxSnapshot(room, now = Date.now()) {
  if (!room?.matchData?.editorDebugHitboxes) return undefined;
  const shapes = [];
  for (const [id, shape] of room.damageHitboxes || []) {
    if (shape.expiresAt <= now) room.damageHitboxes.delete(id);
    else shapes.push(shape);
  }
  return shapes;
}
module.exports = { exposeDamageHitbox, damageHitboxSnapshot, SAMPLE_TTL_MS };
