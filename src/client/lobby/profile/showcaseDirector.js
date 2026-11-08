// Chooses ordinary commands, never combat outcomes. The featured fighter can
// burst; sparring partners answer less often and give a hurt player breathing room.
import { requestBasic, requestSpecial, basicRange } from '../../../shared/combat/combat';
import { botProfile } from '../../../shared/combat/characterProfiles';
import { getModifiers } from '../../../shared/combat/runtime/effects/effectManager';
import { isMovementSuppressed } from '../../../shared/combat/runtime/abilityRuntimeManager';
import physics from '../../../shared/physics/movementPhysics.json';

export function seededRandom(seed = 7) {
  return () => { seed = Math.imul(seed ^ seed >>> 15, 1 | seed); seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed); return ((seed ^ seed >>> 14) >>> 0) / 4294967296; };
}
export function createShowcaseDirector(session, { halfWidth = 240, random = seededRandom() } = {}) {
  const brains = new Map();
  for (const p of session.players.values()) brains.set(p.name, {
    minX: Math.max(-halfWidth, ...[...session.players.values()].filter(q => q.team === p.team && q.role === 'bystander' && q.x < p.x).map(q => q.x + 80)),
    maxX: Math.min(halfWidth, ...[...session.players.values()].filter(q => q.team === p.team && q.role === 'bystander' && q.x > p.x).map(q => q.x - 80)),
    nextThink: session.now + (p.role === 'sparring' ? 1250 : 500) + random() * 300,
    move: 0, until: 0, attackAfter: 0, superAfter: 0, burst: 0,
  });
  return () => {
    const dt = session.FIXED_DT_MS / 1000, now = session.now;
    for (const p of session.players.values()) {
      if (!p.isAlive || p.role === 'bystander') continue;
      const brain = brains.get(p.name), kit = botProfile(p.char_class), modifiers = getModifiers(p, now);
      const sparring = p.role === 'sparring';
      const enemies = [...session.players.values()].filter(q => q.isAlive && q.team !== p.team && q.role !== 'bystander');
      const target = enemies.sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
      const locked = isMovementSuppressed(p, now) || (p._controlLockUntil || 0) > now;
      if (brain.wasLocked && !locked) brain.attackAfter = now + 700;
      brain.wasLocked = locked;
      if (now >= brain.nextThink && !locked) {
        brain.nextThink = now + 100 + random() * 90;
        const direction = target ? Math.sign(target.x - p.x) || 1 : p.flip ? -1 : 1;
        const distance = target ? Math.abs(target.x - p.x) : 0;
        const range = basicRange(p, session);
        const desired = kit.melee ? Math.min(kit.spacing.cap, range * kit.spacing.fraction)
          : Math.min(kit.spacing.cap, range * kit.spacing.fraction, halfWidth * 0.8);
        if (now >= brain.until) {
          const far = target && distance > desired + 38;
          const close = target && !kit.melee && distance < desired - 65 && (p.ammoState.charges === 0 || p.health < p.maxHealth * 0.6);
          brain.move = far ? direction : close ? -direction : 0;
          brain.until = now + 450 + random() * 400;
        }
        if (!target || (brain.move && ((brain.move === direction && distance <= desired) || (brain.move !== direction && distance >= desired)))) brain.move = 0;
        p.flip = direction < 0;
        if (p.superCharge >= p.maxSuperCharge) brain.chargedAt ??= now; else brain.chargedAt = null;
        const nearby = radius => enemies.filter(q => Math.hypot(q.x - p.x, q.y - p.y) <= radius);
        // Buffs can be demonstrated after the finishing hit, including Wizard
        // granting a bystander a powerup. Charge is earned; never topped up.
        const superTarget = target || (kit.buffSuper ? p : null);
        const wantsSuper = !sparring && superTarget && brain.chargedAt != null && now - brain.chargedAt >= 450 &&
          now >= brain.superAfter && ((now - brain.chargedAt >= 900 && (kit.buffSuper || distance <= Math.max(range, kit.superRange || 0))) || (kit.shouldUseSuper?.({ brain: { room: session }, player: p,
            target: superTarget, enemies, distance, now, nearby, heldMs: now - brain.chargedAt,
            emergency: p.health < p.maxHealth * 0.3 }) ?? true));
        if (wantsSuper && requestSpecial(session, p, superTarget, now)) {
          brain.superAfter = now + 6500;
          brain.attackAfter = now + 650;
          brain.burst = 0;
        } else if (target && now >= brain.attackAfter && (!sparring || target.health > target.maxHealth * 0.45)) {
          if (requestBasic(session, p, target, { prediction: sparring ? 0.3 : 0.7, aimError: 0 }, random, now)) {
            brain.burst++;
            const burstSize = Math.min(p.ammoState.capacity, 2);
            const pause = sparring ? 1800 + random() * 650
              : brain.burst >= burstSize ? 750 + random() * 550 : 140 + random() * 160;
            // This is thinking time in addition to the real cooldown. Ammo
            // admission remains in shared combat and can never be bypassed.
            brain.attackAfter = now + p.ammoState.cooldownMs + pause;
            if (sparring || brain.burst >= burstSize) brain.burst = 0;
          }
        }
      }
      if (locked) { p.vx = p.vy = 0; continue; }
      if (now >= (p._previewImpulseUntil || 0)) {
        const desiredVx = target ? brain.move * physics.maxSpeed * modifiers.speedMult : 0;
        const accel = physics.accel * dt;
        p.vx += Math.max(-accel, Math.min(accel, desiredVx - p.vx));
      }
      const nextX = p.x + p.vx * dt;
      p.x = Math.max(brain.minX, Math.min(brain.maxX, nextX));
      if (p.x !== nextX) p.vx = 0;
      if (p.y < p.groundY || p.vy < 0) {
        p.vy += physics.gravity * (p.vy > 0 ? physics.fallGravityFactor : 1) * dt;
        p.y += p.vy * dt;
      }
      if (p.y >= p.groundY) { p.y = p.groundY; p.vy = 0; p.grounded = true; }
    }
  };
}
