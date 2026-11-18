const { objectiveShot } = require("./bankBust");
const { basicAim, hasClearShot, pressureAim, requestBasic, requestSpecial } = require("../../../shared/combat/combat.js");
const { healthFraction, preferredRange, finishSteps } = require("./tactics");
const { shouldUseSuper } = require("./supers");
const { botProfile } = require("../../../shared/combat/characterProfiles.js");

function tryCombat(brain, ...args) { return finishSteps(brain.tryCombatSteps(...args)); }

function* tryCombatSteps(brain, enemies, target, observed, now) {
  const objective = objectiveShot(brain, enemies);
  target = objective || target;
  if (!target || now < brain.nextOpportunity || now < (brain.player._dashUntil || 0)) return;
  // Reserve the upcoming activation so an attack windup cannot invalidate a
  // jump-then-dash halfway across a gap. Combat resumes once it has launched.
  if ((brain.traversal?.dash && brain.traversal.cursor <= brain.traversal.dashFrame) ||
      (brain.approachEdge?.dash && Math.abs(brain.approachEdge.takeoffX - brain.player.x) < 120)) return;
  const p = brain.player;
  if (now < (brain.ammoReadyAfter || 0) && p.superCharge < p.maxSuperCharge) return;
  const nearest = Math.min(...enemies.map((e) => Math.hypot(e.x - p.x, e.y - p.y)));
  // Use ordinary ammo/cooldown limits to push back a pursuer. Once clear of
  // pressure, stop firing so regeneration can begin.
  let counterfire = true;
  if (brain.retreating) {
    const closePressure = Math.max(300, preferredRange(brain, target) * 1.25);
    if (nearest > closePressure && now - (p.lastDamagedAt || 0) > 550) counterfire = false;
  }
  const candidates = [];
  for (const e of [target, ...enemies.filter(e => e !== target)]) {
    yield;
    if (!counterfire) break;
    const aim = basicAim(p, e, brain.profile, () => 0.5, brain.room);
    if ((aim.canHit && hasClearShot(brain.room, p, e, aim)) ||
        (p.ammoState?.charges >= 2 && now >= (p._botPressureUntil || 0) && pressureAim(brain.room, p, e, brain.profile))) candidates.push(e);
  }
  candidates
    .sort((a, b) => {
      if (brain.retreating) return Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y);
      const contestId = brain.decision?.contestTargetId;
      if (contestId && a.participantId === contestId) return -1;
      if (contestId && b.participantId === contestId) return 1;
      const value = (enemy) => (enemy.objectiveTarget ? -2 : healthFraction(enemy)) - (enemy.participantId === target.participantId ? 0.6 : 0);
      return value(a) - value(b);
    });
  yield;
  now = brain.room.botNow ?? now;
  const age = Math.min(0.3, Math.max(0, now - (observed?.at || now)) / 1000) * brain.profile.prediction;
  const predict = (enemy) => ({ ...enemy, x: enemy.x + (enemy.vx || 0) * age, y: enemy.y + (enemy.vy || 0) * age });
  // Supers have their own ranges and targeting rules. A missing basic shot
  // must not prevent a hook, swarm, or self buff from being considered.
  const superTarget = [target, ...enemies.filter((e) => e !== target)].filter(e => !e.objectiveTarget).map(predict)
    .find((enemy) => shouldUseSuper(brain, enemy, enemies, now));
  const candidate = candidates[0];
  if (!candidate && !superTarget) return;
  brain.nextOpportunity = now + brain.between(180, 320) * (1.1 - brain.profile.tacticalAwareness * 0.28);
  if (brain.random() < brain.profile.mistakeChance / (brain.aggression * (brain.teamPlan ? 0.7 + brain.teamPlan.morale * 0.6 : 1))) { brain.nextOpportunity += brain.between(180, 400); return; }
  if (superTarget && requestSpecial(brain.room, p, superTarget, now)) {
    brain.metrics.specials++;
    brain.superPlan = { charged: false, preferredRange: null };
  } else if (candidate && now >= (brain.ammoReadyAfter || 0) && requestBasic(brain.room, p, predict(candidate), brain.profile, brain.random, now)) {
    brain.metrics.attacks++;
    // Wait after the mechanical cooldown/reload completes. This prevents the
    // bot from firing on the exact frame ammo becomes available every cycle.
    brain.ammoReadyAfter = now + (Number(p.ammoState?.cooldownMs) || 0) + brain.attackHesitationMs();
  }
}

function attackHesitationMs(brain) {
  const awareness = brain.profile.tacticalAwareness ?? 0.5;
  const aggression = Math.max(0.8, brain.aggression || 1);
  const urgency = brain.retreating ? 0.55 : 1;
  const fixed = botProfile(brain.player.char_class).hesitation;
  if (fixed) return (brain.between(fixed.min, fixed.max) + (1 - awareness) * fixed.awarenessPenalty) * urgency;
  const min = 65 + (1 - awareness) * 55;
  const max = 190 + (1 - awareness) * 170;
  // A rare quick follow-up creates bursts without returning to frame-perfect spam.
  if (brain.random() < 0.12 * aggression) return brain.between(35, 90);
  return brain.between(min, max) / Math.min(1.2, aggression) * urgency;
}

module.exports = { tryCombat, tryCombatSteps, attackHesitationMs };
