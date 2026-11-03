const { basicAim, basicRange, hasClearShot } = require('./combat');
const { walkLimits, canStandAt, standOn } = require('./navigation');
const { movementGeometry } = require('./physics');

const { createRandom } = require('./random');
const SUPPORT_STYLES = ['farmer', 'crate-hunter', 'hunter', 'defender', 'raider'];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const active = (brain) => brain.room.gameMode?.modeId === 'bank-bust';
const infiltrator = role => role === 'flanker' || role === 'rusher';

function seedFor(text) {
  let hash = 2166136261;
  for (const char of String(text)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function bankRole(brain, now = brain.room._botNow ?? Date.now()) {
  // Explicit overrides are useful for simulations. Live controllers manage
  // their styles from the same seeded team schedule, independent of think order.
  if (brain.bankRole && !brain.bankStyleManaged) return brain.bankRole;
  if (!brain.bankStyleRoster) {
    brain.bankStyleRoster = [...brain.room.players.values()].filter(p => p.isBot && p.team === brain.player.team)
      .map(p => ({ id: p.participantId, seed: p.seed || 0 })).sort((a, b) => a.id.localeCompare(b.id));
    brain.bankStyleStart = brain.room.modeState?.startedAt ?? brain.room._loopStartWallTime ?? now;
    brain.bankStyleManaged = true;
  }
  const roster = brain.bankStyleRoster;
  const epoch = Math.max(0, Math.floor((now - brain.bankStyleStart) / 30000));
  if (brain.bankStyleEpoch === epoch) return brain.bankRole;
  const teamSeed = seedFor(JSON.stringify(roster));
  const random = createRandom(teamSeed + epoch);
  const slots = roster.map((p, index) => ({ index, order: random() })).sort((a, b) => a.order - b.order);
  const index = roster.findIndex(p => p.id === brain.player.participantId);
  // One dedicated infiltrator per three bots (at least one); other bots keep
  // economy, combat and defensive preferences rather than all rushing together.
  const specialist = slots.slice(0, Math.max(1, Math.floor(roster.length / 3))).some(s => s.index === index);
  const roleRandom = createRandom(seedFor(`${teamSeed}:${epoch}:${index}`));
  const next = specialist ? (roleRandom() < 0.65 ? 'flanker' : 'rusher') :
    SUPPORT_STYLES[Math.floor(roleRandom() * SUPPORT_STYLES.length)];
  if (next === 'flanker' && brain.bankRole !== next) brain.bankFlankUntil = null;
  brain.bankRole = next;
  brain.bankStyleEpoch = epoch;
  return next;
}

// Planning and execution share one spaced-out willingness roll. Rechecking
// each think must not turn a small opening probability into a guaranteed buy.
function wantsBankPurchase(brain, now) {
  if (!brain.bankClaimRandom) brain.bankClaimRandom = createRandom(seedFor(`claim:${brain.player.participantId}:${brain.player.seed}`));
  const random = brain.bankClaimRandom;
  if (!brain.bankClaimPlan) {
    const start = brain.room.modeState?.startedAt ?? brain.room._loopStartWallTime ?? now;
    brain.bankClaimPlan = { willing: random() < 0.12, checkAt: start + 12000 + random() * 16000 };
  }
  const plan = brain.bankClaimPlan;
  if (now >= plan.checkAt) {
    const role = brain.bankSituation?.role || bankRole(brain, now);
    const chance = infiltrator(role) ? 0.08 : role === 'defender' ? 0.55 : 0.3;
    plan.willing = random() < chance;
    plan.checkAt = now + 8000 + random() * 6000;
  }
  return plan.willing;
}

// Personality is a preference, not an assignment. Threats get a short release
// delay so a defender does not turn around every time an enemy crosses a radius.
function updateBankSituation(brain, enemies, now) {
  if (!active(brain)) return null;
  const p = brain.player, state = brain.room.modeState, own = state?.vaults?.[p.team];
  const preference = bankRole(brain, now);
  const intruders = own ? enemies.filter(e => distance(e, own) < 700) : [];
  const responders = [...brain.room.players.values()].filter(a => a.isBot && a.isAlive && a.team === p.team)
    .sort((a, b) => distance(a, own || p) - distance(b, own || p) || String(a.participantId).localeCompare(String(b.participantId)));
  const humanGuard = own && [...brain.room.players.values()].some(a => !a.isBot && a.isAlive && a.team === p.team && distance(a, own) < 500);
  const shouldDefend = intruders.length && (preference === 'defender' ||
    (!humanGuard && responders[0]?.participantId === p.participantId) || distance(p, own) < 500);
  if (shouldDefend) brain.bankGuardUntil = now + 2500;
  const defending = shouldDefend || now < (brain.bankGuardUntil || 0);
  const hasGold = state?.randomGold?.pickups?.length || state?.objects?.some(o => o.type === 'goldMine' && o.state.storedGold > 0);
  const crateActive = ['announced', 'active'].includes(state?.centerGold?.phase);
  let role = preference;
  if (defending) role = 'defender';
  else if (preference === 'defender' || (preference === 'farmer' && !hasGold) ||
      (preference === 'crate-hunter' && !crateActive) || (preference === 'hunter' && !enemies.length)) role = 'raider';
  brain.bankSituation = { role, defending, intruders, at: now };
  return brain.bankSituation;
}

function bankCombatEnemies(brain, enemies, now) {
  const situation = updateBankSituation(brain, enemies, now);
  if (!situation || brain.retreating) return enemies;
  const p = brain.player;
  const vault = attackTargets(brain).find(t => t.id.startsWith('vault:'));
  const engaged = ['fight', 'kite'].includes(brain.decision?.mode);
  const slippingPast = infiltrator(situation.role) && !situation.defending;
  const radius = slippingPast ? (engaged ? 230 : 150) : situation.role === 'hunter' ? 850 : engaged ? 480 : 330;
  return enemies.filter(e => distance(e, p) < radius ||
    (!slippingPast && vault && distance(e, vault) < 420 && distance(p, vault) < 850) ||
    (situation.defending && situation.intruders.includes(e) && distance(e, p) < 650));
}

function attackTargets(brain) {
  if (!active(brain)) return [];
  const state = brain.room.modeState;
  if (!state || state.phase === 'finished') return [];
  const team = brain.player.team === 'team1' ? 'team2' : 'team1';
  const vault = state.vaults?.[team];
  const crate = state.centerGold;
  return [vault && !vault.destroyedAt && vault.coins > 0 && { ...vault, id: `vault:${team}` },
    crate?.phase === 'active' && { ...crate, id: 'crate:center' }].filter(Boolean)
    .map(t => ({ ...t, participantId: t.id, objectiveTarget: true, vx: 0, vy: 0 }));
}

// Public objectives are known globally. Enemy positions still come exclusively
// from the controller's delayed, visibility-filtered observations.
function objectiveShot(brain, enemies) {
  if (!active(brain) || brain.retreating) return null;
  const p = brain.player;
  const targets = attackTargets(brain);
  if ((brain.bankSituation?.role || bankRole(brain)) === 'crate-hunter') targets.reverse();
  for (const target of targets) {
    const slippingPast = infiltrator(brain.bankSituation?.role || bankRole(brain));
    const defender = enemies.some(e => distance(e, p) < (slippingPast ? 150 : 280) ||
      (!slippingPast && distance(e, target) < 360 && distance(e, p) < basicRange(p, brain.room)));
    if (defender) continue;
    const aim = basicAim(p, target, brain.profile, () => 0.5, brain.room);
    if (aim.canHit && hasClearShot(brain.room, p, target, aim)) return target;
  }
  return null;
}

function purchaseAllowed(brain, entry) {
  const p = brain.player, state = brain.room.modeState;
  const s = entry.state || {};
  const turret = entry.type === 'claimableTurret';
  if (!turret && entry.type !== 'wallSlot') return false;
  if (turret ? s.claimedByTeam === p.team : s.builtByTeam) return false;
  const own = state.vaults?.[p.team];
  const enemy = state.vaults?.[p.team === 'team1' ? 'team2' : 'team1'];
  // Build walls on our side; keep a reserve above the mode's hard floor.
  if (!turret && (!own || !enemy || distance(entry, own) > distance(entry, enemy))) return false;
  const cost = Number(turret ? s.claimCost : s.cost);
  if (!own || own.destroyedAt || state.phase === 'finished' || !Number.isFinite(cost) || cost < 0) return false;
  const remaining = own.coins - Math.round(cost);
  const reserve = Math.max(1, (state.purchaseFloorCoins || 0) + cost, own.coins * 0.35);
  // A purchase late in a timed match must not spend away a winning score.
  const now = brain.room._botNow ?? Date.now();
  if (state.endsAt > now && state.endsAt - now < 15000 && enemy && own.coins > enemy.coins && remaining <= enemy.coins) return false;
  return remaining >= reserve && brain.room.gameMode.canAffordPurchase(p.team, cost);
}

function tryBankInteraction(brain, now) {
  if (!active(brain) || !brain.player.isAlive || now < (brain.nextBankInteraction || 0)) return;
  if (brain.retreating || !wantsBankPurchase(brain, now)) return;
  const entry = brain.room.gameMode._findNearestInteractable(brain.player);
  if (!entry || !purchaseAllowed(brain, entry)) return;
  brain.nextBankInteraction = now + 1800;
  brain.room.handlePlayerAction(brain.player.participantId, { type: 'mode-interact' });
}

function* bankDecisionSteps(brain, context, enemies, now) {
  if (!active(brain) || brain.retreating || Number.isFinite(context.poisonY)) return null;
  const p = brain.player, state = brain.room.modeState;
  if (!state || state.phase === 'finished') return null;
  const combatEnemies = bankCombatEnemies(brain, enemies, now);
  const { role, defending } = brain.bankSituation;
  const own = state.vaults?.[p.team];
  const vault = attackTargets(brain).find(t => t.id.startsWith('vault:'));
  if (!vault) return null;
  if (combatEnemies.length) return null;
  const candidates = [{ ...vault, kind: 'siege', utility: infiltrator(role) ? 1100 : 650, attack: true }];
  if (defending && own) candidates.push({ ...own, id: 'guard', kind: 'guard', utility: 2200 });
  const crate = state.centerGold;
  if (crate && ['announced', 'active'].includes(crate.phase)) candidates.push({ ...crate,
    id: 'crate:center', kind: 'crate', attack: crate.phase === 'active', utility: role === 'crate-hunter' ? 1550 : 530 });
  for (const entry of state.objects || []) {
    if (entry.type === 'goldMine' && entry.state.storedGold > 0) candidates.push({ ...entry,
      kind: 'mine', radius: entry.state.collectionRadius, utility: role === 'farmer' ? 1250 : 440 });
    if (wantsBankPurchase(brain, now) && purchaseAllowed(brain, entry)) candidates.push({ ...entry, kind: 'claim',
      radius: entry.state.claimRadius || entry.state.buildRadius,
      utility: role === 'defender' ? 1150 : 690 });
  }
  for (const coin of state.randomGold?.pickups || []) candidates.push({ ...coin, kind: 'gold',
    radius: coin.radius, utility: role === 'farmer' ? 1300 : role === 'crate-hunter' ? 900 : 480 });
  // A flanker takes a reachable lower crossing toward the enemy side once per
  // life/trip. A bounded commitment prevents an inaccessible exit becoming a loop.
  if (role === 'flanker' && distance(p, vault) > 900) {
    if (!brain.bankFlankUntil) brain.bankFlankUntil = now + 14000;
    if (now < brain.bankFlankUntil) {
      const direction = Math.sign(vault.x - p.x);
      for (const surface of context.graph.surfaces) {
        if (surface.top > Math.max(own?.y || 0, vault.y) + 180 && (surface.x - p.x) * direction > 200 &&
            (vault.x - surface.x) * direction > 150) candidates.push({ x: surface.x,
          y: standOn(surface, p.char_class, surface.x).y, id: `flank:${surface.id}`, kind: 'flank', utility: 1500 });
      }
    }
  }
  const previous = brain.bankCommit;
  const incumbent = candidates.find(c => c.id === previous?.decision.bankObjectiveId);
  const previousSurface = context.graph.surfaces.find(s => s.id === previous?.decision.goal.surfaceId);
  let validPrevious = incumbent && previousSurface && previous.role === role &&
    canStandAt(movementGeometry(brain.room), previousSurface, p.char_class, previous.decision.goal.x) &&
    context.routeTo(previousSurface.id, previous.decision.goal.x) !== null;
  if (validPrevious && incumbent.attack) {
    const stance = standOn(previousSurface, p.char_class, previous.decision.goal.x);
    const aim = basicAim(stance, incumbent, brain.profile, () => 0.5, brain.room);
    validPrevious = aim.canHit && hasClearShot(brain.room, stance, incumbent, aim);
  }
  if (validPrevious && now < previous.until) return previous.decision;
  let best = null, bestScore = -Infinity, incumbentChoice = null, incumbentScore = -Infinity;
  for (const candidate of candidates) {
    for (const surface of context.graph.surfaces) {
      yield;
      const limits = walkLimits(surface, p.char_class);
      const range = candidate.attack ? Math.min(450, basicRange(p, brain.room) * 0.65) : 0;
      for (const rawX of new Set([candidate.x, candidate.x - range, candidate.x + range,
        ...(validPrevious && candidate.id === incumbent.id && surface.id === previousSurface.id ? [previous.decision.goal.x] : [])])) {
        const x = Math.max(limits.left, Math.min(limits.right, rawX));
        if (!canStandAt(movementGeometry(brain.room), surface, p.char_class, x)) continue;
        const point = standOn(surface, p.char_class, x);
        if (candidate.attack) {
          const aim = basicAim(point, candidate, brain.profile, () => 0.5, brain.room);
          if (!aim.canHit || !hasClearShot(brain.room, point, candidate, aim)) continue;
        } else if (distance(point, candidate) > Math.max(16, (candidate.radius || 100) - 12)) continue;
        const route = context.routeTo(surface.id, x);
        if (route === null) continue;
        const travel = route.reduce((sum, e) => sum + e.duration, 0);
        const allies = [...(brain.room.botControllers?.values() || [])].filter(b => b !== brain &&
          b.player.team === p.team && b.player.isAlive && b.decision?.bankObjectiveId === candidate.id).length;
        const score = candidate.utility - travel * 0.07 - distance(p, point) * 0.12 -
          (candidate.kind === 'siege' ? 0 : allies * 300) + (validPrevious && candidate.id === incumbent.id && surface.id === previousSurface.id && x === previous.decision.goal.x ? 120 : 0);
        const choice = { mode: `bank-${candidate.kind}`, bankObjectiveId: candidate.id,
          goal: { x, y: surface.top, surfaceId: surface.id } };
        if (candidate.id === incumbent?.id && score > incumbentScore) { incumbentScore = score; incumbentChoice = choice; }
        if (score > bestScore) {
          bestScore = score;
          best = choice;
        }
      }
    }
  }
  // Switching tasks needs a meaningful gain, not a tiny distance fluctuation.
  if (validPrevious && incumbentChoice && bestScore < incumbentScore + 220) best = incumbentChoice;
  brain.bankCommit = best ? { decision: best, role, until: now + 4000 } : null;
  return best;
}

module.exports = { wantsBankPurchase, updateBankSituation, bankCombatEnemies, bankRole, bankDecisionSteps, objectiveShot, tryBankInteraction, purchaseAllowed };
