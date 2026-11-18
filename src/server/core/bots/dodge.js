const { previewManeuver, poisonDamage } = require("./navigation");
const { maneuverDanger } = require("./perception");
const { finishSteps } = require("./tactics");
const { FIXED_DT_MS } = require("../../../shared/gameConstants");

function findDodgeManeuver(brain, ...args) { return finishSteps(brain.findDodgeSteps(...args)); }

function* findDodgeSteps(brain, observed, mods, now, poisonY) {
  const p = brain.player;
  const baseline = previewManeuver(p, { direction: brain.intent.direction }, brain.movementGeometry(), mods, now, poisonY);
  if (!baseline) return { best: null, baseDanger: Infinity, bestScore: Infinity };
  const poisonAt = brain.context(mods, now).poisonAt;
  const hazardCost = (maneuver) => poisonDamage(maneuver.frames, maneuver.frames.length * FIXED_DT_MS, poisonY, poisonAt) * 1200 / Math.max(1, p.health);
  const baseDanger = maneuverDanger(baseline, observed, now, p.char_class) + hazardCost(baseline);
  let best = null, bestScore = baseDanger - 20;
  for (const direction of [-1, 0, 1]) for (const jumpPressed of [false, true]) {
    yield;
    if (jumpPressed && now - (brain.lastJumpAt || 0) < 1800) continue;
    const candidate = previewManeuver(p, { direction, jumpPressed }, brain.movementGeometry(), mods, now, poisonY);
    if (!candidate) continue;
    const score = maneuverDanger(candidate, observed, now, p.char_class) + hazardCost(candidate) + (jumpPressed ? 35 : 0);
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  return { best, baseDanger, bestScore };
}

function tryDodge(brain, observed, mods, now, poisonY, evaluated = null) {
  if (now < brain.nextDodgeAt) return false;
  brain.nextDodgeAt = now + brain.between(900, 1500);
  if (brain.random() > brain.profile.dodgeChance) return false;
  const { best } = evaluated || brain.findDodgeManeuver(observed, mods, now, poisonY);
  if (!best) return false;
  brain.clearTravel();
  brain.maneuver = { ...best, cursor: 0 };
  brain.idleUntil = 0;
  brain.metrics.dodges++;
  brain.nextDecisionAt = 0;
  return true;
}

module.exports = { findDodgeManeuver, findDodgeSteps, tryDodge };
