// Where every live attack will deal damage over the next second, for bots.
//
// Each combat runtime already publishes the exact geometry it tests for hits
// (exposeDamageHitbox). Instead of mirroring every attack's motion here, the
// forecast steps copies of the room's attack state through the real runtimes
// in a sandbox where nobody is an enemy, and records those published shapes.
// A new attack, projectile or super is forecast as soon as its runtime
// publishes its hitbox; nothing here needs to know how it moves.
const { tickActiveAttacks, registerAttackFromAction } = require('../../../shared/combat/runtime/attackRuntimeManager.js');
const { participantId, getParticipant } = require('../../../shared/combat/runtime/participants.js');
const characterCombat = require('../../../shared/combat/runtime/characterCombatRegistry.js');
const { tickActiveAbilities } = require('../../../shared/combat/runtime/abilityRuntimeManager.js');
const { combatNow } = require('../../../shared/combat/runtime/clock.js');
const { FIXED_DT_MS } = require('../../../shared/gameConstants');
const { normalizeAngleDelta } = require('../../../shared/combat/attackDelivery');

const FORECAST_MS = 1000;
const STEP_S = FIXED_DT_MS / 1000;
// Every sandbox player shares one team, so no runtime finds a target to hit.
const NEUTRAL_TEAM = '__forecast__';

// Attack state is plain data; anything that is not (functions, handles) is
// shared rather than copied, and the runtimes never write through it.
function copy(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Map) {
    const out = new Map(); seen.set(value, out);
    for (const [k, v] of value) out.set(k, copy(v, seen));
    return out;
  }
  if (value instanceof Set) {
    const out = new Set(); seen.set(value, out);
    for (const v of value) out.add(copy(v, seen));
    return out;
  }
  const out = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value)); seen.set(value, out);
  for (const key of Object.keys(value)) out[key] = copy(value[key], seen);
  return out;
}

function sandboxPlayer(p) {
  return { ...p, team: NEUTRAL_TEAM, isBot: true, connected: p.connected, loaded: p.loaded,
    effects: copy(p.effects), ammoState: copy(p.ammoState), _visibleAttack: null };
}

function sandboxRoom(room, start) {
  let clock = start;
  const players = new Map([...room.players].map(([key, p]) => [key, sandboxPlayer(p)]));
  const sandbox = {
    status: 'active', geometry: room.geometry, players, tickId: room.tickId || 0,
    simulationMono: Number(room.simulationMono) || 0, FIXED_DT_MS: room.FIXED_DT_MS || FIXED_DT_MS,
    attacksAdvancedTick: room.attacksAdvancedTick,
    matchData: { ...room.matchData, editorDebugHitboxes: true }, damageHitboxes: new Map(),
    combatClock: { now: () => clock, mono: () => clock }, combatRandom: () => 0.5,
    activeAttacks: copy(room.activeAttacks || []),
    ninjaCombatVersion: room.ninjaCombatVersion, sparrowCombatVersion: room.sparrowCombatVersion,
    broadcast() {}, emit() {}, handleHit: () => null, applyPowerupToPlayer() {},
    io: { to: () => ({ emit() {}, compress() { return this; } }) },
    onCombatError: (error) => { sandbox.error = error; },
  };
  for (const key of ['ninjaCombatState', 'sparrowCombatState']) {
    if (!room[key]) continue;
    const state = copy(room[key]);
    state.requests = new Map(); state.terminals = []; if (state.metrics) state.metrics = [];
    sandbox[key] = state;
  }
  // Windups waiting to release (room.scheduleAction with a `release`) are
  // registered in the sandbox when they fall due, as the room would.
  const releases = [];
  for (const scheduled of room._scheduledActions || []) {
    if (!scheduled.release) continue;
    const owner = participantId(scheduled.release.player);
    releases.push({ at: scheduled.at, owner, action: scheduled.release.action() });
  }
  sandbox.advance = () => {
    clock += sandbox.FIXED_DT_MS;
    sandbox.tickId++;
    sandbox.simulationMono += sandbox.FIXED_DT_MS;
    for (let i = releases.length - 1; i >= 0; i--) {
      if (releases[i].at > clock) continue;
      const [release] = releases.splice(i, 1), player = getParticipant(sandbox, release.owner);
      if (player) registerAttackFromAction(sandbox, player, release.action, clock);
    }
    // The room's own order (gameRoom/simulation.js): releases, abilities, attacks, combat.
    tickActiveAbilities(sandbox, clock);
    tickActiveAttacks(sandbox, clock);
    characterCombat.tick(sandbox);
  };
  return sandbox;
}

// Shapes are keyed `${attacker}:${instance}:${part}` by exposeDamageHitbox;
// every part of one attack instance is one threat.
const sourceOf = (id) => id.slice(0, id.lastIndexOf(':'));

function runForecast(room) {
  const start = combatNow(room);
  const sandbox = sandboxRoom(room, start);
  const owners = new Map([...room.players.values()].map((p) => [p.name, p]));
  const threats = new Map();
  const steps = Math.round(FORECAST_MS / sandbox.FIXED_DT_MS);
  for (let step = 0; step < steps; step++) {
    sandbox.damageHitboxes.clear();
    try { sandbox.advance(); } catch (error) { sandbox.error = error; break; }
    for (const [id, { owner: ownerName, expiresAt, ...shape }] of sandbox.damageHitboxes) {
      const source = sourceOf(id);
      let threat = threats.get(source);
      if (!threat) {
        const owner = owners.get(ownerName);
        if (!owner) continue;
        threat = { id: source, ownerId: owner.participantId, team: owner.team, stepS: STEP_S, steps: [] };
        threats.set(source, threat);
      }
      (threat.steps[step] ||= []).push(shape);
    }
  }
  // The hidden-gas rectangle and other room-level hazards have no owner.
  for (const threat of threats.values()) for (let i = 0; i < threat.steps.length; i++) threat.steps[i] ||= [];
  return { at: start, tickId: room.tickId, threats: [...threats.values()], error: sandbox.error || null };
}

// Attacks move deterministically, so a forecast stays true until an attack
// starts or ends. It is shared by every bot and recomputed when the set of
// live attacks changes, or after REUSE_MS. Readers offset into it by its age.
const REUSE_MS = 250;
const cache = new WeakMap();
function attackSignature(room) {
  const ninja = room.ninjaCombatState, sparrow = room.sparrowCombatState;
  return [room.activeAttacks?.length || 0, ninja?.active.size || 0, ninja?.pending.length || 0,
    sparrow?.active.size || 0, sparrow?.pending.length || 0, sparrow?.bolts?.size || 0,
    (room._scheduledActions || []).filter((action) => action.release).length,
    ...[...room.players.values()].map((p) => Number(p.effects?.dravenInfernoUntil) || 0)].join(',');
}
function forecastThreats(room) {
  const now = combatNow(room), signature = attackSignature(room);
  const cached = cache.get(room);
  if (cached && cached.signature === signature && now - cached.at < REUSE_MS) return cached;
  const forecast = runForecast(room);
  forecast.signature = signature;
  if (forecast.error) room.onBotForecastError?.(forecast.error);
  cache.set(room, forecast);
  return forecast;
}

// Gap between a published damage shape and an axis-aligned body, 0 on contact.
function rectGap(rect, x, y) {
  return Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom));
}
function segmentRectGap(a, b, rect) {
  // Sampled closely enough for bot decisions; shapes are at most a few hundred px.
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8));
  let gap = Infinity;
  for (let i = 0; i <= steps && gap > 0; i++) gap = Math.min(gap, rectGap(rect, a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps));
  return gap;
}
// A cone reaches what is inside its spread; outside it, the gap is the
// distance to the nearest edge ray.
function sectorGap(shape, rect) {
  const cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2;
  const reach = Math.hypot(rect.right - rect.left, rect.bottom - rect.top) / 2;
  const dist = Math.hypot(cx - shape.x, cy - shape.y);
  const excess = Math.abs(normalizeAngleDelta(Math.atan2(cy - shape.y, cx - shape.x), shape.angle)) - shape.halfSpread;
  const radial = Math.max(0, dist - reach - shape.radius, (shape.innerRadius || 0) - dist - reach);
  if (excess <= 0) return radial;
  const side = excess >= Math.PI / 2 ? dist : dist * Math.sin(excess);
  return Math.max(radial, side - reach);
}
function shapeGap(shape, rect) {
  switch (shape.kind) {
    case 'circle': return Math.max(0, rectGap(rect, shape.x, shape.y) - shape.radius);
    case 'sector': return Math.max(0, sectorGap(shape, rect));
    case 'sweep': return Math.max(0, segmentRectGap(shape.a, shape.b, rect) - shape.radius);
    case 'rect': return Math.hypot(Math.max(0, shape.left - rect.right, rect.left - shape.right),
      Math.max(0, shape.top - rect.bottom, rect.top - shape.bottom));
    case 'capsule': return Math.max(0, segmentRectGap(shape.a, shape.b, rect) - shape.radius);
    default: return Infinity;
  }
}
function shapeBounds(shape) {
  switch (shape.kind) {
    case 'circle': case 'sector':
      return { left: shape.x - shape.radius, right: shape.x + shape.radius, top: shape.y - shape.radius, bottom: shape.y + shape.radius };
    case 'sweep': case 'capsule':
      return { left: Math.min(shape.a.x, shape.b.x) - shape.radius, right: Math.max(shape.a.x, shape.b.x) + shape.radius,
        top: Math.min(shape.a.y, shape.b.y) - shape.radius, bottom: Math.max(shape.a.y, shape.b.y) + shape.radius };
    case 'rect': return { left: shape.left, right: shape.right, top: shape.top, bottom: shape.bottom };
    default: return null;
  }
}

module.exports = { forecastThreats, shapeGap, shapeBounds, FORECAST_MS };
