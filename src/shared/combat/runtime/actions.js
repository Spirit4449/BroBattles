const { getParticipant } = require('./participants');
const characterCombat = require('./characterCombatRegistry');
const { activateSpecial } = require('./abilityRuntimeManager');
const { combatNow } = require('./clock');
function requestSpecial(room, id, payload = {}) {
    const p = getParticipant(room, id);
    const special = characterCombat.requestSpecial(room, p, payload);
    if (special?.handled) return special.result;
    if (!p || !p.isAlive || !p.loaded || room.status !== 'active') return false;
    const now = combatNow(room);
    if (Math.max(p._controlLockUntil || 0, p._attackInterruptedUntil || 0) > now || p.superCharge < p.maxSuperCharge) return false;
    p.superCharge = 0; p.lastCombatAt = now;
    const aimPayload = payload?.aim || null;
    activateSpecial(room, p, now, aimPayload, { id: payload?.id, viewRewindMs: payload?.viewRewindMs });
    room.io.to(`game:${room.matchId}`).emit('super-update', { username: p.name, charge: 0, maxCharge: p.maxSuperCharge });
    if (p.char_class !== 'gloop') room.io.to(`game:${room.matchId}`).emit('player:special', {
      username: p.name, character: p.char_class, origin: { x: p.x, y: p.y }, flip: !!p.flip, aim: aimPayload,
    });
    return true;
}
module.exports = { requestSpecial };
