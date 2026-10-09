import { applyTeamVisual } from "../../../../shared/projectilePresentation";
import { createRuntimeId } from '../shared/runtimeId';
import { RENDER_LAYERS } from '../../scene/renderLayers';
import { HuntressReplica } from '../../../../shared/characters/huntressReplication';
import { serverClock, ensureServerClockEpoch } from '../../match/serverClock';
import { remoteLaunchCorrection, reconcileFlight } from '../../../../shared/projectilePresentation';
import { VERSION, attackConfig, resolveShot, powerFromSpeed, createVolley, firstContact, sample, attachmentPoint } from '../../../../shared/characters/huntressProjectile';
import { advanceGeometry } from '../../../../shared/maps/platformMotion';
import { playPlayerSound } from '../../audio/playerAudio';
import { isLocalShooter, predictShotContact, confirmWindowMs } from '../shared/shotPrediction';

// The replica reads the shared match clock; it never resets or pings it.
const replica = new HuntressReplica(serverClock);
let version = null, sceneRef = null, context = {};
const sprites = new Map(), casts = new Map(), metrics = [];
const predictedRequests = new Map();
const fireParticles = new Set();
// Predicted hits the server did not confirm; their flight is no longer drawn.
const withdrawn = new Set();
const WITHDRAW_FADE_MS = 150;
let lastAmmoRevision = 0;
// Bootstrap colliders carry their motion; terrain is static apart from that,
// so every client can stop an arrow where the server will.
let colliders = [], platformMotion = { movingColliders: [] };
let updateListener = null;
let shutdownListener = null;

export function resetHuntressNetwork() {
  if (sceneRef && updateListener) sceneRef.events.off('update', updateListener);
  if (sceneRef && shutdownListener) sceneRef.events.off('shutdown', shutdownListener);
  for (const entry of sprites.values()) entry.sprite.destroy();
  for (const particle of fireParticles) particle.destroy();
  fireParticles.clear();
  sprites.clear(); casts.clear(); predictedRequests.clear(); withdrawn.clear(); replica.reset(); lastAmmoRevision = 0;
  sceneRef = null; updateListener = null; shutdownListener = null; context = {}; version = null;
  colliders = []; platformMotion = { movingColliders: [] };
}

// Visibility resync is presentation-only: preserve the configured protocol and
// clock, while dropping arrows/casts that would otherwise appear after a stall.
export function discardHuntressPresentation() {
  for (const entry of sprites.values()) entry.sprite.destroy();
  for (const particle of fireParticles) particle.destroy();
  fireParticles.clear();
  sprites.clear(); casts.clear(); predictedRequests.clear(); withdrawn.clear();
  replica.active.clear();
}

export function configureHuntressNetwork(state) {
  resetHuntressNetwork();
  version = state?.huntressCombatVersion ?? null;
  if (version !== VERSION) return;
  colliders = state.collisionGeometry?.colliders || [];
  platformMotion = { movingColliders: colliders.filter(c => c.motion && c.base) };
  ensureServerClockEpoch(state.epoch);
  replica.reset(state.epoch);
  replica.clock.observe(state, performance.now());
  for (const terminal of state.terminals || []) replica.terminate(terminal, performance.now());
  for (const projectile of state.projectiles || []) replica.launch(projectile);
  if (typeof window !== 'undefined') window.__BB_HUNTRESS_DIAGNOSTICS__ = () => ({
    version, epoch: replica.clock.epoch, active: replica.active.size,
    rttMs: replica.clock.samples.map(p => p.rtt), events: metrics.slice(),
  });
}

export function observeHuntressSnapshot(snapshot) {
  if (version !== VERSION) return;
  replica.clock.observe({ epoch: snapshot.snapshotEpoch, sentMono: snapshot.sentMono, simMono: snapshot.tMono }, performance.now());
}


function targetSprite(name) {
  return name === context.localUsername ? context.localPlayer :
    context.opponentPlayersRef?.[name]?.opponent || context.teamPlayersRef?.[name]?.opponent;
}
function addSprite(scene, projectile) {
  const sprite = scene.add.sprite(projectile.x, projectile.y, 'huntress-arrow');
  sprite.setScale(projectile.scale); sprite.setDepth(RENDER_LAYERS.ATTACKS + 4);
  applyTeamVisual(sprite, targetSprite(projectile.ownerName) || { _bbTeamColor: context.opponentPlayersRef?.[projectile.ownerName] ? 0xff413f : 0x50ce88 }, true, "arrow");
  const entry = { sprite, projectile, revision: 0, lastTrail: 0 };
  sprites.set(projectile.id, entry);
  return entry;
}
// Where this frame's flight stops: the server's terrain sweep at the arrow's
// own simulation time, and for the local shooter the enemies as drawn. Without
// it an arrow flew on into a wall or body until the terminal arrived, then
// jumped back. Terrain wins ties, as on the server.
function flightContact(entry, p, point) {
  const from = entry.flight || { x: p.x, y: p.y };
  entry.flight = { x: point.x, y: point.y };
  let wall = null;
  if (colliders.length) {
    advanceGeometry(platformMotion, p.launchMono + point.age);
    wall = firstContact(from, point, 0, colliders, []);
  }
  const hit = isLocalShooter(p.ownerName) ? predictShotContact(from, point, p.radius, { inset: true }) : null;
  if (hit && (!wall || hit.t < wall.t)) {
    const at = attachmentPoint(hit, hit.bounds), body = hit.target.sprite;
    return { x: at.x, y: at.y, target: hit.target.name, sprite: body,
      offset: body ? { x: at.x - body.x, y: at.y - body.y } : null };
  }
  return wall && { x: wall.x, y: wall.y };
}
function placeHeld(entry) {
  const { held } = entry, body = held.sprite;
  if (body?.active && held.offset) entry.sprite.setPosition(body.x + held.offset.x, body.y + held.offset.y);
  else entry.sprite.setPosition(held.x, held.y);
  entry.sprite.setRotation(held.rotation);
}
// Fades a withdrawn prediction; true once it is gone.
function fadeOut(entry, now) {
  entry.withdrawnAt ??= now;
  const alpha = 1 - (now - entry.withdrawnAt) / WITHDRAW_FADE_MS;
  if (alpha > 0) { entry.sprite.setAlpha?.(alpha); return false; }
  entry.sprite.destroy();
  return true;
}
function record(event) { metrics.push(event); if (metrics.length > 240) metrics.shift(); }

export function burningFx(scene, entry, now, embedded = false) {
  if (now - (entry.lastFire ?? -Infinity) < (embedded ? 100 : 40)) return;
  entry.lastFire = now;
  // One small, opaque cluster per emission. Fire bends against flight, then
  // rises after impact; no smoke, additive halos or expanding translucent blobs.
  if (fireParticles.size >= 320) return;
  const angle = embedded ? Math.PI / 2 : entry.sprite.rotation || 0;
  const phase = (entry.fireFrame = (entry.fireFrame || 0) + 1) % 3;
  const size = entry.projectile.special ? 3 : 2;
  const x = entry.sprite.x, y = entry.sprite.y;
  const flame = scene.add.graphics().setPosition(x, y);
  flame.setRotation(angle);
  flame.setDepth(RENDER_LAYERS.ATTACKS + 5);
  const block = (color, bx, by, w, h) => {
    flame.fillStyle(color, 1);
    flame.fillRect(bx * size, by * size, w * size, h * size);
  };
  block(0xd94716, -4, -1, 5, 2);
  block(0xff8526, -3, -1, 4, 2);
  block(0xff8526, -5 - phase, phase === 1 ? 0 : -1, 3, 1);
  block(0xffbf42, -2, -1, 3, 2);
  block(0xffeaa0, 0, -1, 1, 2);
  block(0xffbf42, -3 - phase, phase === 1 ? -2 : 1, 2, 1);
  fireParticles.add(flame);
  scene.tweens.add({ targets: flame,
    x: x - Math.cos(angle) * 12, y: y - Math.sin(angle) * 12 - 6,
    alpha: 0, duration: embedded ? 180 : 150,
    onComplete: () => { fireParticles.delete(flame); flame.destroy(); } });
}

export function attachHuntressScene(scene, nextContext = {}) {
  context = { ...context, ...nextContext };
  if (version !== VERSION || !scene || sceneRef === scene) return;
  if (sceneRef && updateListener) sceneRef.events.off('update', updateListener);
  sceneRef = scene;
  updateListener = (_time, delta = 16.67) => {
    const now = performance.now();
    for (const [id, request] of predictedRequests) {
      if (now - request.at > 2000) {
        predictedRequests.delete(id); casts.delete(id); replica.reject(request.key, now);
      }
    }
    for (const [id, cast] of casts) {
      if (now < cast.due) continue;
      casts.delete(id);
      if (replica.rejected.has(cast.key) || !cast.owner.active) continue;
      const projectiles = createVolley({ x: cast.owner.x, y: cast.owner.y,
        width: cast.owner.displayWidth, height: cast.owner.displayHeight }, cast.shot, cast.key, replica.clock.now(now));
      for (const p of projectiles) replica.launch({ ...p, ownerName: cast.username }, true);
      record({ type: 'predicted-launch', requestId: id, windupOverrunMs: now - cast.due });
    }
    for (const id of withdrawn) if (!replica.active.has(id)) withdrawn.delete(id);
    for (const [id, state] of replica.active) {
      if (withdrawn.has(id)) continue;
      const p = state.projectile, point = replica.position(id, now);
      if (!point || point.age < 0) continue;
      if (point.age >= p.maxLifetimeMs) { replica.active.delete(id); continue; }
      const entry = sprites.get(id) || addSprite(scene, p);
      if (!entry.revision && p.ownerName !== context.localUsername) {
        entry.correction = remoteLaunchCorrection(targetSprite(p.ownerName), p.origin, point.age, now);
      }
      if (entry.revision && entry.revision !== state.revision) {
        // Compare both flights at this instant. The sprite holds last frame's
        // position, so measuring from it stalled the arrow for a frame.
        const previous = entry.projectile, wasShown = entry.correction ?
          Math.max(0, 1 - (now - entry.correction.at) / (entry.correction.duration || 80)) : 0;
        const predicted = sample(previous, replica.clock.now(now) - previous.launchMono + (entry.lead || 0));
        entry.correction = reconcileFlight({ x: predicted.x + (entry.correction?.x || 0) * wasShown,
          y: predicted.y + (entry.correction?.y || 0) * wasShown }, point, now, Math.hypot(point.vx, point.vy));
        record({ type: 'reconcile', id, errorPx: Math.hypot(entry.correction.x, entry.correction.y) });
      }
      entry.revision = state.revision; entry.projectile = p; entry.lead = state.lead;
      const contact = !entry.held && flightContact(entry, p, point);
      if (contact) entry.held = { ...contact, rotation: Math.atan2(point.vy, point.vx), at: now };
      if (entry.held) {
        // A predicted body hit the server has not confirmed in time is withdrawn.
        if (entry.held.target && now - entry.held.at > confirmWindowMs()) {
          if (fadeOut(entry, now)) { sprites.delete(id); withdrawn.add(id); }
          continue;
        }
        placeHeld(entry);
        burningFx(scene, entry, now, true);
        continue;
      }
      const blend = entry.correction ? Math.max(0, 1 - (now - entry.correction.at) / (entry.correction.duration || 80)) : 0;
      entry.sprite.setPosition(point.x + (entry.correction?.x || 0) * blend, point.y + (entry.correction?.y || 0) * blend);
      entry.sprite.setRotation(Math.atan2(point.vy, point.vx));
      burningFx(scene, entry, now);

    }
    for (const [id, entry] of sprites) {
      const terminal = replica.terminals.get(id);
      if (!terminal && replica.active.has(id)) continue;
      const embed = terminal && ['target', 'terrain'].includes(terminal.reason);
      if (embed && now - terminal.received > entry.projectile.embedMs) {
        entry.sprite.destroy(); sprites.delete(id); continue;
      }
      if (entry.held?.target) {
        // A confirmed prediction stays exactly where it was drawn; any other
        // outcome fades it rather than jumping it somewhere else.
        if (terminal?.reason === 'target' && terminal.target === entry.held.target) {
          placeHeld(entry);
          burningFx(scene, entry, now, true);
        } else if (fadeOut(entry, now)) sprites.delete(id);
        continue;
      }
      if (!embed) { entry.sprite.destroy(); sprites.delete(id); continue; }
      const target = terminal.target && targetSprite(terminal.target);
      entry.sprite.setPosition(target?.active && terminal.targetOffset ? target.x + terminal.targetOffset.x : terminal.x,
        target?.active && terminal.targetOffset ? target.y + terminal.targetOffset.y : terminal.y);
      entry.sprite.setRotation(terminal.rotation);
      burningFx(scene, entry, now, true);
    }
  };
  scene.events.on('update', updateListener);
  shutdownListener = () => { if (sceneRef === scene) resetHuntressNetwork(); };
  scene.events.once('shutdown', shutdownListener);
}

export function handleHuntressPacket(scene, packet, nextContext) {
  const action = packet?.action;
  if (version !== VERSION || action?.huntressCombatVersion !== VERSION) return false;
  if (action.epoch !== replica.clock.epoch) return true;
  attachHuntressScene(scene, nextContext);
  replica.clock.observe(action, performance.now());
  const requestKey = `${packet.playerName}:${action.requestId}`;
  if (action.type === 'huntress-result') {
    if (!action.accepted) { casts.delete(action.requestId); replica.reject(requestKey, performance.now()); }
    if (packet.playerName === context.localUsername) {
      const predictedRequest = predictedRequests.get(action.requestId);
      predictedRequests.delete(action.requestId);
      if (action.revision > lastAmmoRevision) {
        lastAmmoRevision = action.revision;
        const age = Math.max(0, replica.clock.now(performance.now()) - action.simMono);
        const samples = replica.clock.samples;
        const upstream = samples.length ? Math.min(...samples.map(p => p.rtt)) / 2 : 0;
        const ammo = { ...action.ammoState };
        // Predict readiness when the next request reaches the server, rather than
        // adding an upstream transit time to every local firing/reload cycle.
        ammo.nextFireInMs = Math.max(0, ammo.nextFireInMs - age - upstream);
        if (action.accepted && predictedRequest && !predictedRequest.special) {
          ammo.nextFireInMs = Math.max(0, ammo.cooldownMs - (performance.now() - predictedRequest.at));
        }
        if (ammo.charges < ammo.capacity) {
          const reload = ammo.reloadTimerMs + age + upstream;
          ammo.charges = Math.min(ammo.capacity, ammo.charges + Math.floor(reload / ammo.reloadMs));
          ammo.reloadTimerMs = ammo.charges === ammo.capacity ? 0 : reload % ammo.reloadMs;
        }
        const outstanding = [...predictedRequests.values()].filter(p => !p.special);
        ammo.charges = Math.max(0, ammo.charges - outstanding.length);
        for (const p of outstanding) ammo.nextFireInMs = Math.max(ammo.nextFireInMs, ammo.cooldownMs - (performance.now() - p.at));
        context.onAmmo?.(ammo);
      }
    }
  } else if (action.type === 'huntress-projectiles') {
    casts.delete(action.requestId);
    for (const p of action.projectiles) {
      if (replica.clock.now(performance.now()) - p.launchMono < p.maxLifetimeMs) replica.launch(p);
    }
  } else if (action.type === 'huntress-terminal') {
    withdrawn.delete(action.id);
    let existing = sprites.get(action.id);
    const age = Math.max(0, replica.clock.now(performance.now()) - action.simMono);
    if (replica.terminate(action, performance.now() - age)) {
      if (!existing && action.visual && age < action.visual.embedMs && ['target', 'terrain'].includes(action.reason)) {
        existing = addSprite(scene, { id: action.id, x: action.x, y: action.y, ...action.visual });
      }
      record({ type: 'impact', id: action.id, movementReportAgeMs: action.movementReportAgeMs,
        errorPx: existing ? Math.hypot(existing.sprite.x - action.x, existing.sprite.y - action.y) : null,
        confirmAgeMs: replica.clock.now(performance.now()) - action.simMono, appliedDamage: action.appliedDamage });
      if (action.appliedDamage > 0) playPlayerSound(scene,
        targetSprite(existing?.projectile?.ownerName || action.ownerName) || { x: action.x, y: action.y },
        'huntress-hit', { volume: 0.48 });
      if (existing && ['target', 'terrain'].includes(action.reason)) {
        if (!existing.held) existing.sprite.setPosition(action.x, action.y);
        burningFx(scene, existing, performance.now(), true);
      }
    }
  }
  return true;
}

export function predictHuntressShot(scene, owner, username, payload, special = false) {
  if (version !== VERSION) return payload;
  const id = payload.id || createRuntimeId('huntressShot');
  const aim = special ? payload.aim || {} : payload;
  const normalized = { angle: aim.angle ?? (owner.flipX ? Math.PI : 0),
    power: special ? 0.5 : powerFromSpeed(aim.angle, aim.speed) };
  const shot = resolveShot(normalized, special);
  if (!shot) return payload;
  attachHuntressScene(scene, { localPlayer: owner, localUsername: username });
  casts.set(id, { owner, username, shot, key: `${username}:${id}`, due: performance.now() + (attackConfig(special).castDelayMs || 0) });
  predictedRequests.set(id, { key: `${username}:${id}`, at: performance.now(), special });
  return special ? { ...payload, id, aim: normalized } : { type: 'huntress-arrow', id, ...normalized };
}

// Lifecycle contract consumed by the generic match and scene controllers.
export const networkAdapter = {
  key: 'huntress',
  joinFields: { huntressCombatVersion: VERSION },
  bootstrapKey: 'huntressCombat',
  configure: configureHuntressNetwork,
  reset: resetHuntressNetwork,
  discard: discardHuntressPresentation,
  attach: attachHuntressScene,
  observe: observeHuntressSnapshot,
  handlePacket: handleHuntressPacket,
  predictSpecial: (scene, player, username, request) => predictHuntressShot(scene, player, username, request, true),
};
