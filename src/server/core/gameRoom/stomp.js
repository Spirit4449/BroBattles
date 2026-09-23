const { participantId, applyParticipantKnockback } = require('./participants');
const { characterBody } = require('../../../shared/duelGeometry');
const { isDetachedProjectile } = require('./attackRuntimes/projectileLifecycle');
const STOMP_RADIUS = 110;
const STOMP_INTERRUPT_MS = 300;

// Called only after map collision has established support, never from a client event.
function resolveStomp(room, player, now = Date.now()) {
  if (!player._stompPendingUntil) return false;
  if (!player.isAlive || now > player._stompPendingUntil ||
      now < Math.max(player._knockbackUntil || 0, player._controlLockUntil || 0) || player.vy < -20) {
    player._stompPendingUntil = 0;
    return false;
  }
  if (!player.grounded) return false;
  player._stompPendingUntil = 0;
  const shape = characterBody(player.char_class, player.flip);
  const x = player.x + shape.offsetX, y = player.y + shape.offsetY + shape.halfHeight;
  const interrupted = [];
  for (const target of room.players.values()) {
    if (target === player || !target.isAlive || target.connected === false || !target.loaded ||
        (player.team && target.team === player.team)) continue;
    const body = characterBody(target.char_class, target.flip);
    const tx = target.x + body.offsetX, ty = target.y + body.offsetY;
    // Distance to the body lets a fighter standing beside the impact be hit at their feet.
    const dx = Math.max(0, Math.abs(tx - x) - body.halfWidth);
    const dy = Math.max(0, Math.abs(ty - y) - body.halfHeight);
    const distance = Math.hypot(dx, dy);
    if (distance > STOMP_RADIUS) continue;
    const id = participantId(target);
    target._attackInterruptSeq = (target._attackInterruptSeq || 0) + 1;
    target._attackInterruptedUntil = now + STOMP_INTERRUPT_MS;
    target._knockbackUntil = Math.max(target._knockbackUntil || 0, now + STOMP_INTERRUPT_MS);
    target._stompPendingUntil = 0;
    target._dashUntil = 0;
    target._botActionUntil = 0;
    target._visibleAttack = null;
    if (target.effects) target.effects.dravenInfernoUntil = 0;
    target.animation = 'falling';
    // Released projectiles continue; attached swings and unreleased casts are interrupted.
    room._activeAttacks = (room._activeAttacks || []).filter(a =>
      a.attackerParticipantId !== id || isDetachedProjectile(a));
    if (room._huntress) room._huntress.pending = room._huntress.pending.filter(c => c.ownerId !== id);
    if (room._ninja) room._ninja.pending = room._ninja.pending.filter(c => c.owner !== id);
    const strength = 1 - 0.35 * distance / STOMP_RADIUS;
    applyParticipantKnockback(room, target, { source: player.name, cause: 'stomp', radial: true,
      amountX: (Math.sign(tx - x) || (player.flip ? -1 : 1)) * 299 * strength,
      amountY: -182 * strength });
    interrupted.push(target.name);
  }
  room.io.to(`game:${room.matchId}`).emit('player:stomp', {
    username: player.name, dashSeq: player.dashSeq, x, y, radius: STOMP_RADIUS, interrupted,
  });
  return true;
}
module.exports = { resolveStomp, STOMP_RADIUS, STOMP_INTERRUPT_MS };
