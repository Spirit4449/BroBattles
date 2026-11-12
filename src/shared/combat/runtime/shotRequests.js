// Server side of the predicted-shot protocols (ninja, sparrow): the client
// fires at once and sends a request id; the server accepts or rejects it once,
// echoes the same result to retries, and resolves flights against targets
// rewound to what the shooter saw. Characters keep their own flight models.
const { isPlaced } = require('../targetable.js');
const { characterBody } = require('../../physics/characterBody');
const { participantId } = require('./participants');
const { poseAt } = require('./lagCompensation.js');
const { combatNow } = require('./clock');
const { getCenterCrateTarget } = require('./attackRuntimes/targets.js');

const MAX_REQUEST_ID_LENGTH = 128;
const REMEMBERED_REQUESTS = 512;
// Bounds rejected requests as well as accepted shots. Silent excess is handled
// by the client's prediction timeout; legitimate fire rates are far lower.
const REQUESTS_PER_SECOND = 20;

// The request id and the key its result is remembered under.
function requestIdentity(p, data) {
  const id = typeof data?.id === 'string' ? data.id.slice(0, MAX_REQUEST_ID_LENGTH) : '';
  return { id, key: `${participantId(p)}:${id}` };
}

// False once the player has sent too many requests this second. `slot` names
// the per-player window so each protocol is limited on its own.
function withinRequestRate(p, slot, now) {
  if (!p[slot] || now - p[slot].at >= 1000) p[slot] = { at: now, count: 0 };
  return ++p[slot].count <= REQUESTS_PER_SECOND;
}

// Why the player cannot act at all right now, or null.
function unavailableReason(room, p, now) {
  if (room.status !== 'active' || !p.isAlive || !p.loaded || p.connected === false) return 'inactive';
  if (Math.max(p._controlLockUntil || 0, p._attackInterruptedUntil || 0) > now) return 'locked';
  return null;
}

// Whether the shot is charged: a full super, or a ready ammo charge.
function isCharged(p, special) {
  return !(special ? p.superCharge < p.maxSuperCharge
    : !p.ammoState || p.ammoState.charges <= 0 || p.ammoState.nextFireInMs > 0);
}

// Spends what an accepted shot costs and tells the room about a spent super.
function spendShot(room, p, special, now) {
  if (special) {
    p.superCharge = 0;
    room.io.to(`game:${room.matchId}`).emit('super-update', { username: p.name, charge: 0, maxCharge: p.maxSuperCharge });
  } else {
    p.ammoState.charges--;
    p.ammoState.nextFireInMs = p.ammoState.cooldownMs;
  }
  p.lastCombatAt = now;
}

// Remembers a result for retries, dropping the oldest past the cap.
function rememberRequest(requests, key, value) {
  requests.set(key, value);
  while (requests.size > REMEMBERED_REQUESTS) requests.delete(requests.keys().next().value);
}

// Bounds of the enemy vault while it still holds coins, or null.
function vaultWithCoins(room, team) {
  const vault = room.gameMode?.getVaultState?.(team);
  if (!vault || !(vault.coins > 0)) return null;
  const w = (vault.width || 150) / 2, h = (vault.height || 180) / 2;
  return { name: `vault:${team}`, bounds: { left: vault.x - w, right: vault.x + w, top: vault.y - h, bottom: vault.y + h } };
}

// Everything the owner's shot can strike: living, placed enemies where the
// shooter saw them (see lagCompensation), then the enemy vault and the centre
// crate. `insetPlayer` lets a protocol shrink player bounds to its own rule.
function enemyShotTargets(room, owner, viewRewindMs = 0, now = combatNow(room), { insetPlayer = null } = {}) {
  const targets = [];
  for (const t of room.players.values()) {
    if (t === owner || t.team === owner.team || !t.isAlive || !isPlaced(t)) continue;
    const at = poseAt(t, viewRewindMs, now), body = characterBody(t.char_class, t.flip);
    const x = at.x + (at._bodyCenterOffsetX ?? body.offsetX), y = at.y + (at._bodyCenterOffsetY ?? body.offsetY);
    const hw = at._bodyHalfWidth ?? body.halfWidth, hh = at._bodyHalfHeight ?? body.halfHeight;
    const bounds = { left: x - hw, right: x + hw, top: y - hh, bottom: y + hh };
    targets.push({ name: t.name, at, bounds: insetPlayer ? insetPlayer(bounds) : bounds,
      movementReportAgeMs: !t.isBot && t._lastPositionPacketAt > 0 ? Math.max(0, now - t._lastPositionPacketAt) : null });
  }
  const vault = vaultWithCoins(room, owner.team === 'team1' ? 'team2' : 'team1');
  if (vault) targets.push(vault);
  const crate = getCenterCrateTarget(room);
  if (crate) targets.push({ name: crate.targetName, bounds: crate.bounds });
  return targets;
}

module.exports = {
  requestIdentity, withinRequestRate, unavailableReason, isCharged, spendShot, rememberRequest, enemyShotTargets,
};
