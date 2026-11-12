const { combatNow } = require("./clock");
const { shotTerrain } = require('./attackRuntimes/geometry.js');
const { exposeDamageHitbox } = require('./damageHitboxes.js');
const { snapshotEpoch } = require('./clock');
const model = require('../../characters/sparrowProjectile');
const { participantId, getParticipant } = require('./participants');
const { characterBody } = require('../../physics/characterBody');
const { clampDeliveryRewind } = require('../attackDelivery');
const { requestIdentity, withinRequestRate, unavailableReason, isCharged, spendShot, rememberRequest, enemyShotTargets } = require('./shotRequests.js');

function initialize(room) {
  // Protocol version protects joins from stale clients; combat is always authoritative.
  room.sparrowCombatVersion = model.VERSION;
  snapshotEpoch(room);
  room._sparrow = { active: new Map(), pending: [], requests: new Map(), terminals: [], metrics: [] };
}
function timing(room) {
  return { epoch: room._snapshotEpoch, sentMono: room.combatClock?.mono?.() ?? performance.now(), simMono: room._simulationMono ?? performance.now() };
}
function emit(room, player, action) {
  room.io.to(`game:${room.matchId}`).emit('game:action', {
    playerName: player.name, character: 'sparrow',
    action: { ...action, sparrowCombatVersion: model.VERSION, ownerEcho: true, ...timing(room) },
  });
}
function result(room, p, id, accepted, reason, extra = {}) {
  const action = { type: 'sparrow-result', requestId: id, accepted, reason,
    ammoState: { ...p.ammoState }, revision: p._sparrowResultSeq = (p._sparrowResultSeq || 0) + 1, ...extra };
  emit(room, p, action);
  return action;
}
function request(room, p, data, special = false) {
  const state = room._sparrow, now = combatNow(room);
  const { id, key } = requestIdentity(p, data);
  const previous = state.requests.get(key);
  if (previous) { emit(room, p, previous.action); return previous.action.accepted; }
  if (!withinRequestRate(p, '_sparrowRequestWindow', now)) return false;
  if (!id) { result(room, p, id, false, 'invalid-request'); return false; }
  const shot = model.resolveShot(special ? data.aim : data, special);
  const reason = unavailableReason(room, p, now) || (!shot ? 'invalid-aim' : !isCharged(p, special) ? 'not-ready' : null);
  const accepted = !reason;
  if (accepted) {
    spendShot(room, p, special, now);
    if (special) room.io.to(`game:${room.matchId}`).emit('player:special', { username: p.name, character: 'sparrow', aim: data.aim });
    const startup = model.attackConfig(special).castDelayMs || 0;
    state.pending.push({ ownerId: participantId(p), id, shot, dueTick: room._tickId + Math.ceil(startup / model.STEP_MS),
      viewRewindMs: clampDeliveryRewind('released', data?.viewRewindMs) });
    // Keep public windups available to existing animations and bot perception.
    require('./characterActionRegistry.js').broadcastAction(room, p, {
      type: special ? 'sparrow-windup-special' : 'sparrow-arrow', id, angle: shot.angle, startup,
    }, now);
  }
  const action = result(room, p, id, accepted, reason || 'accepted');
  rememberRequest(state.requests, key, { at: now, action });
  return accepted;
}
function pose(p) {
  const body = characterBody('sparrow', p.flip);
  return { x: p.x, y: p.y, width: body.displayWidth, height: body.displayHeight };
}
function packetFor(attack) {
  return { ...attack.projectile, ownerName: attack.attackerName, ownerId: attack.attackerParticipantId };
}
// Sorted by name so ties resolve the same way on every client.
function targetList(room, owner, viewRewindMs = 0, now = combatNow(room)) {
  return enemyShotTargets(room, owner, viewRewindMs, now, { insetPlayer: model.insetBounds })
    .sort((a, b) => a.name.localeCompare(b.name));
}
function finish(room, attack, contact) {
  const owner = getParticipant(room, attack.attackerParticipantId);
  const target = [...room.players.values()].find(p => p.name === contact.target);
  const struck = target && owner && targetList(room, owner, attack.viewRewindMs).find(p => p.name === target.name);
  const attachment = struck ? model.attachmentPoint(contact, struck.bounds) : contact;
  // Offsets are relative to where the shooter saw the target, so the arrow
  // stays where it visibly struck on every client's displayed actor.
  const anchor = struck?.at || target;
  const terminal = { type: 'sparrow-terminal', id: attack.projectile.id, requestId: attack.clientRequestId,
    ...contact, rotation: Math.atan2(attack.vy, attack.vx),
    targetOffset: target ? { x: attachment.x - anchor.x, y: attachment.y - anchor.y } : null,
    visual: { scale: attack.projectile.scale, embedMs: attack.projectile.embedMs, special: attack.projectile.special },
    movementReportAgeMs: target && !target.isBot && target._lastPositionPacketAt > 0 ? Math.max(0, combatNow(room) - target._lastPositionPacketAt) : null,
    ...timing(room), ownerName: attack.attackerName };
  if (contact.reason === 'target') {
    const outcome = room.handleHit(attack.attackerParticipantId, {
      attacker: attack.attackerName, target: contact.target, attackType: attack.attackType,
      instanceId: attack.projectile.id,
    }, { server: true, sparrowProjectile: attack });
    terminal.appliedDamage = outcome?.appliedDamage || 0;
    terminal.accepted = outcome?.accepted === true;
  }
  room._sparrow.active.delete(attack.projectile.id);
  room._sparrow.terminals.push(terminal);
  if (room._sparrow.terminals.length > 256) room._sparrow.terminals.shift();
  if (owner) emit(room, owner, terminal);
}
// Resolved on first use (circular imports); kept out of the per-tick path.
let botCombat = null;
function tick(room) {
  const started = performance.now(), state = room._sparrow;
  for (const p of room.players.values()) {
    // BotController already advances bot ammunition each fixed step.
    if (!p.isBot && p.char_class === 'sparrow' && p.isAlive) (botCombat ||= require('../combat.js')).advanceAmmo(p, model.STEP_MS);
  }
  const pending = state.pending;
  state.pending = [];
  for (const cast of pending) {
    if (cast.dueTick > room._tickId) { state.pending.push(cast); continue; }
    const owner = getParticipant(room, cast.ownerId);
    if (!owner) continue;
    if (!owner.isAlive || owner.connected === false || !owner.loaded || room.status !== 'active') {
      result(room, owner, cast.id, false, 'cancelled'); continue;
    }
    const projectiles = model.createVolley(pose(owner), cast.shot, `${owner.name}:${cast.id}`, room._simulationMono);
    for (const projectile of projectiles) state.active.set(projectile.id, {
      projectile, clientRequestId: cast.id, attackerName: owner.name, attackerParticipantId: cast.ownerId,
      attackType: cast.shot.special ? 'sparrow-burning-arrow' : 'sparrow-arrow',
      x: projectile.x, y: projectile.y, vx: projectile.vx, vy: projectile.vy, gravity: projectile.gravity,
      collisionRadius: projectile.radius, age: 0, viewRewindMs: cast.viewRewindMs || 0,
    });
    emit(room, owner, { type: 'sparrow-projectiles', requestId: cast.id, projectiles: projectiles.map(p => packetFor(state.active.get(p.id))) });
  }
  for (const attack of state.active.values()) {
    const owner = getParticipant(room, attack.attackerParticipantId);
    if (!owner || owner.connected === false || room.status !== 'active') {
      finish(room, attack, { reason: 'cancelled', x: attack.x, y: attack.y }); continue;
    }
    const nextAge = Math.min(attack.projectile.maxLifetimeMs, Math.max(0, room._simulationMono - attack.projectile.launchMono));
    const next = model.sample(attack.projectile, nextAge);
    exposeDamageHitbox(room, attack.projectile, { kind: 'sweep', a: { x: attack.x, y: attack.y }, b: { x: next.x, y: next.y }, radius: attack.collisionRadius });
    const contact = model.firstContact(attack, next, attack.collisionRadius, shotTerrain(room, owner.team), targetList(room, owner, attack.viewRewindMs));
    Object.assign(attack, next, { age: nextAge });
    if (contact) finish(room, attack, contact);
    else if (nextAge >= attack.projectile.maxLifetimeMs || attack.y >= room.geometry.world.y + room.geometry.world.height) {
      finish(room, attack, { reason: 'expired', x: attack.x, y: attack.y });
    }
  }
  const wall = combatNow(room);
  for (const [key, entry] of state.requests) if (wall - entry.at > 12000) state.requests.delete(key);
  state.metrics.push(performance.now() - started);
  if (state.metrics.length > 240) state.metrics.shift();
}
function bootstrap(room) {
  return { sparrowCombatVersion: room.sparrowCombatVersion, ...timing(room),
    collisionGeometry: { colliders: room.geometry.colliders, world: room.geometry.world },
    projectiles: [...room._sparrow.active.values()].map(packetFor), terminals: room._sparrow.terminals.slice() };
}
function isTrustedContact(room, attack, payload) {
  return attack && room._sparrow.active.get(attack.projectile.id) === attack &&
    payload.instanceId === attack.projectile.id && payload.attacker === attack.attackerName && payload.attackType === attack.attackType;
}
function dispose(room) {
  const state = room._sparrow;
  if (!state) return;
  state.active.clear();
  state.pending.length = 0;
  state.terminals.length = 0;
  state.requests.clear();
}
module.exports = { dispose, initialize, request, tick, bootstrap, timing, isTrustedContact };
