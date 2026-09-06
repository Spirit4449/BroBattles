import socket from '../../socket';
import { createRuntimeId } from '../shared/runtimeId';
import { RENDER_LAYERS } from '../../gameScene/renderLayers';
import { HuntressReplica } from '../../shared/huntressReplication';
import { VERSION, attackConfig, resolveShot, powerFromSpeed, createVolley, firstContact, insetBounds } from '../../shared/huntressProjectile';

const replica = new HuntressReplica();
let version = 1, sceneRef = null, context = {}, syncTimer = null, generation = 0;
const sprites = new Map(), casts = new Map(), metrics = [];
const predictedRequests = new Map();
const fireParticles = new Set();
let lastAmmoRevision = 0;
let updateListener = null;
let shutdownListener = null;
let geometry = null;

export function resetHuntressNetwork() {
  generation++;
  clearInterval(syncTimer); syncTimer = null;
  if (sceneRef && updateListener) sceneRef.events.off('update', updateListener);
  if (sceneRef && shutdownListener) sceneRef.events.off('shutdown', shutdownListener);
  for (const entry of sprites.values()) entry.sprite.destroy();
  for (const particle of fireParticles) particle.destroy();
  fireParticles.clear();
  sprites.clear(); casts.clear(); predictedRequests.clear(); replica.reset(); lastAmmoRevision = 0;
  sceneRef = null; updateListener = null; shutdownListener = null; context = {}; version = 1;
  geometry = null;
}

export function configureHuntressNetwork(state) {
  resetHuntressNetwork();
  version = state?.huntressCombatVersion || 1;
  if (version !== VERSION) return;
  geometry = state.collisionGeometry;
  replica.reset(state.epoch);
  replica.clock.observe(state, performance.now());
  for (const terminal of state.terminals || []) replica.terminate(terminal, performance.now());
  for (const projectile of state.projectiles || []) replica.launch(projectile);
  const current = generation;
  const sync = () => {
    if (!socket.connected) return;
    const sent = performance.now();
    socket.timeout(1500).emit('game:clock', {}, (error, response) => {
      if (!error && current === generation && response) replica.clock.synchronize(response, sent, performance.now());
    });
  };
  sync(); syncTimer = setInterval(sync, 2000);
  if (typeof window !== 'undefined') window.__BB_HUNTRESS_DIAGNOSTICS__ = () => ({
    version, epoch: replica.clock.epoch, active: replica.active.size,
    rttMs: replica.clock.samples.map(p => p.rtt), events: metrics.slice(),
  });
}

export function observeHuntressSnapshot(snapshot) {
  if (version !== VERSION) return;
  replica.clock.observe({ epoch: snapshot.snapshotEpoch, sentMono: snapshot.sentMono, simMono: snapshot.tMono }, performance.now());
}

export function huntressV2Enabled() { return version === VERSION; }

function targetSprite(name) {
  return name === context.localUsername ? context.localPlayer :
    context.opponentPlayersRef?.[name]?.opponent || context.teamPlayersRef?.[name]?.opponent;
}
function visualTargets(projectile, ignored) {
  const enemyOwner = !!context.opponentPlayersRef?.[projectile.ownerName];
  const targets = enemyOwner
    ? [[context.localUsername, context.localPlayer], ...Object.entries(context.teamPlayersRef || {}).map(([name, w]) => [name, w.opponent])]
    : Object.entries(context.opponentPlayersRef || {}).map(([name, w]) => [name, w.opponent]);
  return targets.filter(([name, s]) => name !== projectile.ownerName && s?.active && s.body?.enable !== false && s.body && !ignored?.has(name))
    .map(([name, sprite]) => ({ name, bounds: insetBounds(sprite.body) }));
}
function addSprite(scene, projectile) {
  const sprite = scene.add.sprite(projectile.x, projectile.y, 'huntress-arrow');
  sprite.setScale(projectile.scale); sprite.setDepth(RENDER_LAYERS.ATTACKS + 4);
  if (projectile.special) sprite.setTint(0xff8a2f);
  const entry = { sprite, projectile, revision: 0, lastTrail: 0 };
  sprites.set(projectile.id, entry);
  return entry;
}
function record(event) { metrics.push(event); if (metrics.length > 240) metrics.shift(); }

function burningFx(scene, entry, now, embedded = false) {
  if (now - (entry.lastFire || -Infinity) < (embedded ? 90 : 45)) return;
  entry.lastFire = now;
  const angle = entry.sprite.rotation || 0;
  const x = entry.sprite.x, y = entry.sprite.y;
  const emit = (radius, color, alpha, dx, dy, duration, scale) => {
    // Bound cosmetic work during volleys; particles never affect combat.
    if (fireParticles.size >= 320) return;
    const particle = scene.add.circle(x, y, radius, color, alpha);
    fireParticles.add(particle);
    particle.setDepth(RENDER_LAYERS.ATTACKS + 3);
    scene.tweens.add({ targets: particle, x: x + dx, y: y + dy,
      scaleX: scale, scaleY: scale * 1.5, alpha: 0, duration,
      onComplete: () => { fireParticles.delete(particle); particle.destroy(); } });
  };
  const drift = embedded ? 0 : -Math.cos(angle) * 26;
  const lift = embedded ? -30 : -Math.sin(angle) * 26 - 12;
  emit(7, 0xff4b0b, 0.7, drift - 4, lift, 240, 0.25);
  emit(4, 0xffd24a, 0.95, drift + 3, lift - 7, 170, 0.2);
  if (embedded || now - (entry.lastSmoke || -Infinity) > 120) {
    entry.lastSmoke = now;
    emit(5, 0x62616a, 0.38, drift * 0.4 + 10, -48, 650, 2.2);
  }
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
    for (const [id, state] of replica.active) {
      const p = state.projectile, point = replica.position(id, now);
      if (!point || point.age < 0) continue;
      if (point.age >= p.maxLifetimeMs) { replica.active.delete(id); continue; }
      const entry = sprites.get(id) || addSprite(scene, p);
      if (entry.revision && entry.revision !== state.revision) {
        entry.correction = { x: entry.sprite.x - point.x, y: entry.sprite.y - point.y, at: now };
        record({ type: 'reconcile', id, errorPx: Math.hypot(entry.correction.x, entry.correction.y) });
        entry.provisional = null; entry.lastPoint = null;
      }
      entry.revision = state.revision; entry.projectile = p;
      const blend = entry.correction ? Math.max(0, 1 - (now - entry.correction.at) / 80) : 0;
      entry.sprite.setPosition(point.x + (entry.correction?.x || 0) * blend, point.y + (entry.correction?.y || 0) * blend);
      entry.sprite.setRotation(Math.atan2(point.vy, point.vx));
      // Pause at a predicted contact while its authoritative terminal travels to us.
      // No damage, sound or permanent embedding is inferred from this contact.
      if (entry.provisional && now > entry.provisional.until) {
        entry.ignored ||= new Set();
        entry.ignored.add(entry.provisional.target);
        entry.provisional = null; entry.lastPoint = point;
      }
      if (!entry.provisional) {
        const contact = firstContact(entry.lastPoint || point, point, p.radius, geometry?.colliders || [], visualTargets(p, entry.ignored));
        if (contact) {
          const samples = replica.clock.samples;
          const rtt = samples.length ? Math.min(...samples.map(s => s.rtt)) : 100;
          entry.provisional = { ...contact, until: now + Math.min(200, Math.max(50, rtt / 2 + 34)) };
        }
      }
      if (entry.provisional) entry.sprite.setPosition(entry.provisional.x, entry.provisional.y);
      entry.lastPoint = point;
      if (p.special) burningFx(scene, entry, now);
      if (!p.special && now - entry.lastTrail > 45) {
        entry.lastTrail = now;
        const trail = scene.add.circle(entry.sprite.x, entry.sprite.y, p.special ? 3 : 1.5, p.special ? 0xff8a2f : 0xffe6ad, 0.5);
        trail.setDepth(RENDER_LAYERS.ATTACKS + 2);
        scene.tweens.add({ targets: trail, alpha: 0, duration: 150, onComplete: () => trail.destroy() });
      }
    }
    for (const [id, entry] of sprites) {
      const terminal = replica.terminals.get(id);
      if (!terminal && replica.active.has(id)) continue;
      const embed = terminal && ['target', 'terrain'].includes(terminal.reason);
      if (!embed || now - terminal.received > entry.projectile.embedMs) {
        entry.sprite.destroy(); sprites.delete(id); continue;
      }
      const target = terminal.target && targetSprite(terminal.target);
      entry.sprite.setPosition(target?.active && terminal.targetOffset ? target.x + terminal.targetOffset.x : terminal.x,
        target?.active && terminal.targetOffset ? target.y + terminal.targetOffset.y : terminal.y);
      entry.sprite.setRotation(terminal.rotation);
      if (entry.projectile.special) burningFx(scene, entry, now, true);
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
    let existing = sprites.get(action.id);
    const age = Math.max(0, replica.clock.now(performance.now()) - action.simMono);
    if (replica.terminate(action, performance.now() - age)) {
      if (!existing && action.visual && age < action.visual.embedMs && ['target', 'terrain'].includes(action.reason)) {
        existing = addSprite(scene, { id: action.id, x: action.x, y: action.y, ...action.visual });
      }
      record({ type: 'impact', id: action.id, movementReportAgeMs: action.movementReportAgeMs,
        errorPx: existing ? Math.hypot(existing.sprite.x - action.x, existing.sprite.y - action.y) : null,
        confirmAgeMs: replica.clock.now(performance.now()) - action.simMono, appliedDamage: action.appliedDamage });
      if (action.appliedDamage > 0) scene.sound?.play('huntress-hit', { volume: 0.55 });
      if (existing?.projectile.special && ['target', 'terrain'].includes(action.reason)) {
        const flame = scene.add.circle(action.x, action.y, 26, 0xff6a1a, 0.3);
        flame.setDepth(RENDER_LAYERS.ATTACKS + 1);
        scene.tweens.add({ targets: flame, alpha: 0, scaleX: 1.6, scaleY: 0.4, duration: 2200, onComplete: () => flame.destroy() });
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
