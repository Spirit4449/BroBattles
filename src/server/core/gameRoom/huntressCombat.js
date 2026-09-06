const { randomUUID } = require('node:crypto');
const model = require('../../../shared/huntressProjectile');
const { participantId, getParticipant } = require('./participants');
const { characterBody } = require('../../../shared/duelGeometry');

function initialize(room) {
  // Room-scoped: never change authority in the middle of a match.
  room.huntressCombatVersion = process.env.BB_HUNTRESS_COMBAT_V2 === '1' ? model.VERSION : 1;
  room._snapshotEpoch ??= randomUUID();
  room._huntress = { active: new Map(), pending: [], requests: new Map(), terminals: [], metrics: [] };
}
function enabled(room) { return room.huntressCombatVersion === model.VERSION; }
function timing(room) {
  return { epoch: room._snapshotEpoch, sentMono: performance.now(), simMono: room._simulationMono ?? performance.now() };
}
function emit(room, player, action) {
  room.io.to(`game:${room.matchId}`).emit('game:action', {
    playerName: player.name, character: 'huntress',
    action: { ...action, huntressCombatVersion: model.VERSION, ownerEcho: true, ...timing(room) },
  });
}
function result(room, p, id, accepted, reason, extra = {}) {
  const action = { type: 'huntress-result', requestId: id, accepted, reason,
    ammoState: { ...p.ammoState }, revision: p._huntressResultSeq = (p._huntressResultSeq || 0) + 1, ...extra };
  emit(room, p, action);
  return action;
}
function request(room, p, data, special = false) {
  const state = room._huntress, now = Date.now();
  const id = typeof data?.id === 'string' ? data.id.slice(0, 128) : '';
  const key = `${participantId(p)}:${id}`;
  const previous = state.requests.get(key);
  if (previous) { emit(room, p, previous.action); return previous.action.accepted; }
  // Bound rejected requests as well as accepted casts. Silent excess is handled
  // by the prediction timeout; legitimate fire rates are much lower than this.
  if (!p._huntressRequestWindow || now - p._huntressRequestWindow.at >= 1000) p._huntressRequestWindow = { at: now, count: 0 };
  if (++p._huntressRequestWindow.count > 20) return false;
  if (!id) { result(room, p, id, false, 'invalid-request'); return false; }
  const shot = model.resolveShot(special ? data.aim : data, special);
  let reason;
  if (room.status !== 'active' || !p.isAlive || !p.loaded || p.connected === false) reason = 'inactive';
  else if (p._controlLockUntil > now) reason = 'locked';
  else if (!shot) reason = 'invalid-aim';
  else if (special ? p.superCharge < p.maxSuperCharge : !p.ammoState || p.ammoState.charges <= 0 || p.ammoState.nextFireInMs > 0) reason = 'not-ready';
  const accepted = !reason;
  if (accepted) {
    if (special) {
      p.superCharge = 0;
      room.io.to(`game:${room.matchId}`).emit('super-update', { username: p.name, charge: 0, maxCharge: p.maxSuperCharge });
      room.io.to(`game:${room.matchId}`).emit('player:special', { username: p.name, character: 'huntress', aim: data.aim });
    } else {
      p.ammoState.charges--;
      p.ammoState.nextFireInMs = p.ammoState.cooldownMs;
    }
    p.lastCombatAt = now;
    const startup = model.attackConfig(special).castDelayMs || 0;
    state.pending.push({ ownerId: participantId(p), id, shot, dueTick: room._tickId + Math.ceil(startup / model.STEP_MS) });
    // Keep public windups available to existing animations and bot perception.
    require('./characterActionRegistry').broadcastAction(room, p, {
      type: special ? 'huntress-windup-special' : 'huntress-arrow', id, angle: shot.angle, startup,
    }, now);
  }
  const action = result(room, p, id, accepted, reason || 'accepted');
  state.requests.set(key, { at: now, action });
  while (state.requests.size > 512) state.requests.delete(state.requests.keys().next().value);
  return accepted;
}
function pose(p) {
  const body = characterBody('huntress', p.flip);
  return { x: p.x, y: p.y, width: body.displayWidth, height: body.displayHeight };
}
function packetFor(attack) {
  return { ...attack.projectile, ownerName: attack.attackerName, ownerId: attack.attackerParticipantId };
}
function targetList(room, owner) {
  const targets = [];
  for (const p of room.players.values()) {
    if (!p.isAlive || !p.loaded || p.connected === false || p === owner || p.team === owner.team) continue;
    const body = characterBody(p.char_class, p.flip);
    const x = p.x + (p._bodyCenterOffsetX ?? body.offsetX), y = p.y + (p._bodyCenterOffsetY ?? body.offsetY);
    const hw = p._bodyHalfWidth ?? body.halfWidth, hh = p._bodyHalfHeight ?? body.halfHeight;
    targets.push({ name: p.name, bounds: model.insetBounds({ left: x - hw, right: x + hw, top: y - hh, bottom: y + hh }) });
  }
  const enemyTeam = owner.team === 'team1' ? 'team2' : 'team1';
  const vault = room.gameMode?.getVaultState?.(enemyTeam);
  if (vault && vault.health > 0) targets.push({ name: `vault:${enemyTeam}`, bounds: {
    left: vault.x - (vault.width || 150) / 2, right: vault.x + (vault.width || 150) / 2,
    top: vault.y - (vault.height || 180) / 2, bottom: vault.y + (vault.height || 180) / 2,
  } });
  return targets.sort((a, b) => a.name.localeCompare(b.name));
}
function finish(room, attack, contact) {
  const owner = getParticipant(room, attack.attackerParticipantId);
  const target = [...room.players.values()].find(p => p.name === contact.target);
  const targetBounds = target && owner && targetList(room, owner).find(p => p.name === target.name)?.bounds;
  const attachment = targetBounds ? model.attachmentPoint(contact, targetBounds) : contact;
  const terminal = { type: 'huntress-terminal', id: attack.projectile.id, requestId: attack.clientRequestId,
    ...contact, rotation: Math.atan2(attack.vy, attack.vx),
    targetOffset: target ? { x: attachment.x - target.x, y: attachment.y - target.y } : null,
    visual: { scale: attack.projectile.scale, embedMs: attack.projectile.embedMs, special: attack.projectile.special },
    movementReportAgeMs: target && !target.isBot && target._lastPositionPacketAt > 0 ? Math.max(0, Date.now() - target._lastPositionPacketAt) : null,
    ...timing(room), ownerName: attack.attackerName };
  if (contact.reason === 'target') {
    const outcome = room.handleHit(attack.attackerParticipantId, {
      attacker: attack.attackerName, target: contact.target, attackType: attack.attackType,
      instanceId: attack.projectile.id,
    }, { server: true, huntressProjectile: attack });
    terminal.appliedDamage = outcome?.appliedDamage || 0;
    terminal.accepted = outcome?.accepted === true;
  }
  room._huntress.active.delete(attack.projectile.id);
  room._huntress.terminals.push(terminal);
  if (room._huntress.terminals.length > 256) room._huntress.terminals.shift();
  if (owner) emit(room, owner, terminal);
}
function tick(room) {
  if (!enabled(room)) return;
  const started = performance.now(), state = room._huntress;
  for (const p of room.players.values()) {
    // BotController already advances bot ammunition each fixed step.
    if (!p.isBot && p.char_class === 'huntress' && p.isAlive) require('../bots/combat').advanceAmmo(p, model.STEP_MS);
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
      attackType: cast.shot.special ? 'huntress-burning-arrow' : 'huntress-arrow',
      x: projectile.x, y: projectile.y, vx: projectile.vx, vy: projectile.vy, gravity: projectile.gravity,
      collisionRadius: projectile.radius, age: 0,
    });
    emit(room, owner, { type: 'huntress-projectiles', requestId: cast.id, projectiles: projectiles.map(p => packetFor(state.active.get(p.id))) });
  }
  for (const attack of state.active.values()) {
    const owner = getParticipant(room, attack.attackerParticipantId);
    if (!owner?.isAlive || owner.connected === false || room.status !== 'active') {
      finish(room, attack, { reason: 'cancelled', x: attack.x, y: attack.y }); continue;
    }
    const nextAge = Math.min(attack.projectile.maxLifetimeMs, Math.max(0, room._simulationMono - attack.projectile.launchMono));
    const next = model.sample(attack.projectile, nextAge);
    const contact = model.firstContact(attack, next, attack.collisionRadius, room.geometry.colliders, targetList(room, owner));
    Object.assign(attack, next, { age: nextAge });
    if (contact) finish(room, attack, contact);
    else if (nextAge >= attack.projectile.maxLifetimeMs || attack.y >= room.geometry.world.y + room.geometry.world.height) {
      finish(room, attack, { reason: 'expired', x: attack.x, y: attack.y });
    }
  }
  const wall = Date.now();
  for (const [key, entry] of state.requests) if (wall - entry.at > 12000) state.requests.delete(key);
  state.metrics.push(performance.now() - started);
  if (state.metrics.length > 240) state.metrics.shift();
}
function bootstrap(room) {
  return { huntressCombatVersion: room.huntressCombatVersion, ...timing(room),
    collisionGeometry: enabled(room) ? { colliders: room.geometry.colliders, world: room.geometry.world } : undefined,
    projectiles: [...room._huntress.active.values()].map(packetFor), terminals: room._huntress.terminals.slice() };
}
function isTrustedContact(room, attack, payload) {
  return enabled(room) && attack && room._huntress.active.get(attack.projectile.id) === attack &&
    payload.instanceId === attack.projectile.id && payload.attacker === attack.attackerName && payload.attackType === attack.attackType;
}
module.exports = { initialize, enabled, request, tick, bootstrap, timing, isTrustedContact };
