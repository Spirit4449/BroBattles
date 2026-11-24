const { ATTACK_REPLAY_WINDOW_MS } = require("../matchConfig.js");
const { SOCKET_EVENTS } = require("../../net/socketEvents.js");
const { combatNow } = require("./clock");
const { shotTerrain } = require('./attackRuntimes/geometry.js');
const { exposeDamageHitbox } = require('./damageHitboxes.js');
const { snapshotEpoch } = require('./clock');
const model = require('../../characters/sparrowProjectile');
const lightBolt = require('../../characters/sparrowLightBolt');
const { participantId, getParticipant } = require('./participants');
const { characterBody } = require('../../physics/characterBody');
const { clampDeliveryRewind } = require('../attackDelivery');
const { traceShotGaps } = require('./shotTrace.js');
const { requestIdentity, withinRequestRate, unavailableReason, isCharged, spendShot, rememberRequest, enemyShotTargets } = require('./shotRequests.js');

function initialize(room) {
  // Protocol version protects joins from stale clients; combat is always authoritative.
  room.sparrowCombatVersion = model.VERSION;
  snapshotEpoch(room);
  room.sparrowCombatState = { active: new Map(), bolts: new Map(), pending: [], requests: new Map(), terminals: [], metrics: [] };
}
function timing(room) {
  return { epoch: room.snapshotEpoch, sentMono: room.combatClock?.mono?.() ?? performance.now(), simMono: room.simulationMono ?? performance.now() };
}
function emit(room, player, action) {
  room.broadcast(SOCKET_EVENTS.GAME_ACTION, {
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
// True while Sparrow's Seraph aim phase holds her: no arrows until the bolt flies.
function inSeraph(p, now) {
  return (Number(p?.effects?.sparrowSeraphUntil) || 0) > 0 && !p.effects.sparrowSeraphFired &&
    Number(p.effects.sparrowSeraphStartedAt) <= now;
}
function request(room, p, data) {
  const state = room.sparrowCombatState, now = combatNow(room);
  const { id, key } = requestIdentity(p, data);
  const previous = state.requests.get(key);
  if (previous) { emit(room, p, previous.action); return previous.action.accepted; }
  if (!withinRequestRate(p, '_sparrowRequestWindow', now)) return false;
  if (!id) { result(room, p, id, false, 'invalid-request'); return false; }
  const shot = model.resolveShot(data);
  const reason = unavailableReason(room, p, now) || (inSeraph(p, now) ? 'locked' : null) ||
    (!shot ? 'invalid-aim' : !isCharged(p, false) ? 'not-ready' : null);
  const accepted = !reason;
  if (accepted) {
    spendShot(room, p, false, now);
    room.gameMode?.onAttackAccepted?.(p, data, false);
    const startup = model.attackConfig().castDelayMs || 0;
    state.pending.push({ ownerId: participantId(p), id, shot, dueTick: room.tickId + Math.ceil(startup / model.STEP_MS),
      viewRewindMs: clampDeliveryRewind('released', data?.viewRewindMs), viewRewindRequestedMs: Number(data?.viewRewindMs) || 0 });
    // Keep public windups available to existing animations and bot perception.
    require('./characterActionRegistry.js').broadcastAction(room, p, {
      type: 'sparrow-arrow', id, angle: shot.angle, startup,
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
// viewRewindMs: the shot's rewind, which victims add to their projectile lead.
function packetFor(attack) {
  return { ...attack.projectile, ownerName: attack.attackerName, ownerId: attack.attackerParticipantId, viewRewindMs: attack.viewRewindMs || 0 };
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
    visual: { scale: attack.projectile.scale, embedMs: attack.projectile.embedMs },
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
  room.sparrowCombatState.active.delete(attack.projectile.id);
  room.sparrowCombatState.terminals.push(terminal);
  if (room.sparrowCombatState.terminals.length > 256) room.sparrowCombatState.terminals.shift();
  if (owner) emit(room, owner, terminal);
}
// The Seraph light bolt: fired once per super, it flies straight at very high
// speed and pierces everything, striking each enemy, vault and crate on its
// path once. Targets are tested where the shooter saw them, like arrows.
function fireBolt(room, p, { requestId, angle, viewRewindMs = 0, auto = false }) {
  const state = room.sparrowCombatState;
  const id = `${p.name}:bolt:${requestId}`;
  const bolt = lightBolt.createBolt({ ...pose(p), flip: p.flip }, angle, id, room.simulationMono);
  const attack = { projectile: bolt, bolt: true, clientRequestId: requestId, attackerName: p.name,
    attackerParticipantId: participantId(p), attackType: 'sparrow-light-bolt', x: bolt.x, y: bolt.y,
    collisionRadius: bolt.radius, age: 0, struck: new Set(), viewRewindMs: clampDeliveryRewind('released', viewRewindMs) };
  state.bolts.set(id, attack);
  emit(room, p, { type: 'sparrow-bolt', requestId, auto, bolt: { ...bolt, ownerName: p.name } });
  return attack;
}
function strike(room, attack, owner, contact) {
  const outcome = room.handleHit(attack.attackerParticipantId, {
    attacker: attack.attackerName, target: contact.target, attackType: attack.attackType, instanceId: attack.projectile.id,
  }, { server: true, sparrowProjectile: attack });
  if (owner) emit(room, owner, { type: 'sparrow-bolt-hit', id: attack.projectile.id, requestId: attack.clientRequestId,
    target: contact.target, x: contact.x, y: contact.y, appliedDamage: outcome?.appliedDamage || 0, ownerName: attack.attackerName });
}
function tickBolts(room) {
  const state = room.sparrowCombatState;
  if (!state.bolts) return;
  for (const [id, attack] of state.bolts) {
    const owner = getParticipant(room, attack.attackerParticipantId);
    if (!owner || owner.connected === false || room.status !== 'active') { state.bolts.delete(id); continue; }
    const bolt = attack.projectile;
    const age = Math.min(bolt.durationMs, Math.max(0, room.simulationMono - bolt.launchMono));
    const from = { x: attack.x, y: attack.y }, to = lightBolt.sampleBolt(bolt, age);
    exposeDamageHitbox(room, { attackerName: attack.attackerName, id: bolt.id }, { kind: 'sweep', a: from, b: to, radius: attack.collisionRadius });
    const contacts = [];
    for (const target of targetList(room, owner, attack.viewRewindMs)) {
      if (attack.struck.has(target.name)) continue;
      const t = model.sweep(from, to, target.bounds, attack.collisionRadius);
      if (t !== null) contacts.push({ t, target: target.name, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    }
    contacts.sort((a, b) => a.t - b.t || a.target.localeCompare(b.target));
    for (const contact of contacts) { attack.struck.add(contact.target); strike(room, attack, owner, contact); }
    Object.assign(attack, to, { age });
    if (age >= bolt.durationMs) state.bolts.delete(id);
  }
}
// Resolved on first use (circular imports); kept out of the per-tick path.
let botCombat = null;
function tick(room) {
  const started = performance.now(), state = room.sparrowCombatState;
  for (const p of room.players.values()) {
    // BotController already advances bot ammunition each fixed step.
    if (!p.isBot && p.char_class === 'sparrow' && p.isAlive) (botCombat ||= require('../combat.js')).advanceAmmo(p, model.STEP_MS);
  }
  const pending = state.pending;
  state.pending = [];
  for (const cast of pending) {
    if (cast.dueTick > room.tickId) { state.pending.push(cast); continue; }
    const owner = getParticipant(room, cast.ownerId);
    if (!owner) continue;
    if (!owner.isAlive || owner.connected === false || !owner.loaded || room.status !== 'active') {
      result(room, owner, cast.id, false, 'cancelled'); continue;
    }
    const projectiles = model.createVolley(pose(owner), cast.shot, `${owner.name}:${cast.id}`, room.simulationMono);
    for (const projectile of projectiles) state.active.set(projectile.id, {
      projectile, clientRequestId: cast.id, attackerName: owner.name, attackerParticipantId: cast.ownerId,
      attackType: 'sparrow-arrow',
      x: projectile.x, y: projectile.y, vx: projectile.vx, vy: projectile.vy, gravity: projectile.gravity,
      collisionRadius: projectile.radius, age: 0, viewRewindMs: cast.viewRewindMs || 0, viewRewindRequestedMs: cast.viewRewindRequestedMs || 0,
    });
    emit(room, owner, { type: 'sparrow-projectiles', requestId: cast.id, projectiles: projectiles.map(p => packetFor(state.active.get(p.id))) });
  }
  for (const attack of state.active.values()) {
    const owner = getParticipant(room, attack.attackerParticipantId);
    if (!owner || owner.connected === false || room.status !== 'active') {
      finish(room, attack, { reason: 'cancelled', x: attack.x, y: attack.y }); continue;
    }
    const nextAge = Math.min(attack.projectile.maxLifetimeMs, Math.max(0, room.simulationMono - attack.projectile.launchMono));
    const next = model.sample(attack.projectile, nextAge);
    exposeDamageHitbox(room, { attackerName: attack.attackerName, id: attack.projectile.id }, { kind: 'sweep', a: { x: attack.x, y: attack.y }, b: { x: next.x, y: next.y }, radius: attack.collisionRadius });
    const targets = targetList(room, owner, attack.viewRewindMs);
    if (room.netTrace) traceShotGaps(room, { pid: attack.projectile.id, attacker: owner, a: { x: attack.x, y: attack.y }, b: next,
      radius: attack.collisionRadius, age: nextAge, rewindMs: attack.viewRewindMs, targets });
    const contact = model.firstContact(attack, next, attack.collisionRadius, shotTerrain(room, owner.team), targets);
    Object.assign(attack, next, { age: nextAge });
    if (contact) finish(room, attack, contact);
    else if (nextAge >= attack.projectile.maxLifetimeMs || attack.y >= room.geometry.world.y + room.geometry.world.height) {
      finish(room, attack, { reason: 'expired', x: attack.x, y: attack.y });
    }
  }
  tickBolts(room);
  const wall = combatNow(room);
  for (const [key, entry] of state.requests) if (wall - entry.at > ATTACK_REPLAY_WINDOW_MS) state.requests.delete(key);
  state.metrics.push(performance.now() - started);
  if (state.metrics.length > 240) state.metrics.shift();
}
function bootstrap(room) {
  return { sparrowCombatVersion: room.sparrowCombatVersion, ...timing(room),
    collisionGeometry: { colliders: room.geometry.colliders, world: room.geometry.world },
    projectiles: [...room.sparrowCombatState.active.values()].map(packetFor), terminals: room.sparrowCombatState.terminals.slice() };
}
function isTrustedContact(room, attack, payload) {
  const state = room.sparrowCombatState;
  return attack && (attack.bolt ? state.bolts : state.active).get(attack.projectile.id) === attack &&
    payload.instanceId === attack.projectile.id && payload.attacker === attack.attackerName && payload.attackType === attack.attackType;
}
function cancelCasts(room, player, { releasedSupers = false } = {}) {
  const state = room.sparrowCombatState;
  if (!state) return;
  const owner = participantId(player);
  state.pending = state.pending.filter(cast => {
    if (cast.ownerId !== owner) return true;
    result(room, player, cast.id, false, 'cancelled');
    return false;
  });
  if (!releasedSupers || !state.bolts) return;
  for (const [id, attack] of state.bolts) if (attack.attackerParticipantId === owner) state.bolts.delete(id);
}
function dispose(room) {
  const state = room.sparrowCombatState;
  if (!state) return;
  state.active.clear();
  state.bolts?.clear();
  state.pending.length = 0;
  state.terminals.length = 0;
  state.requests.clear();
}
module.exports = { dispose, cancelCasts, initialize, request, tick, bootstrap, timing, isTrustedContact, fireBolt, emit };
