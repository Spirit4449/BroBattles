const { SERAPH, facingAngle, validAngle } = require("../../../characters/sparrowLightBolt.js");
const { seraphAimPose, seraphPoseAngle } = require("../../../characters/sparrowSeraphAim.js");
const { clampToWorld } = require("../attackRuntimes/geometry.js");
const { combatRandom } = require("../clock.js");

// Sparrow's super, Seraph. The tap only starts the aim phase: she rises on
// wings and hovers, bow drawn, for SERAPH.aimMs. Releasing an aim fires one
// light bolt (sparrowCombat.fireBolt); if time runs out she uses her last
// reported aim pose. Knockback, pulls and stuns still apply. A human
// Sparrow's client flies her hover and reports positions as usual; a bot's
// hover is flown here. Tuning: sparrow.json stats.tuning.special.seraph.

// Resolved on first use: sparrowCombat requires the damage path, which
// requires the ability manager that loads this module.
let combat = null;
const sparrowCombat = () => (combat ||= require("../sparrowCombat.js"));

function isAiming(player, now) {
  const e = player?.effects;
  return !!e && !e.sparrowSeraphFired && (Number(e.sparrowSeraphUntil) || 0) > 0 &&
    now < Number(e.sparrowSeraphUntil) + SERAPH.releaseGraceMs;
}

function activate(player, now, room) {
  const e = (player.effects ||= {});
  e.sparrowSeraphStartedAt = now;
  e.sparrowSeraphUntil = now + SERAPH.aimMs;
  e.sparrowSeraphFired = false;
  e.sparrowSeraphSeq = (Number(e.sparrowSeraphSeq) || 0) + 1;
  if (player.isBot) {
    const [min, max] = SERAPH.botFireDelayMs;
    e.sparrowSeraphBotFireAt = now + SERAPH.riseMs + min + combatRandom(room) * (max - min);
    e.sparrowSeraphHover = { x: Number(player.x) || 0, y: Number(player.y) || 0, at: now };
    e.sparrowSeraphBotAim = { angle: facingAngle(player.flip), at: now };
    player.vx = 0; player.vy = 0;
  }
}

function end(player) {
  const e = player.effects || {};
  e.sparrowSeraphUntil = 0;
  e.sparrowSeraphFired = true;
  delete e.sparrowSeraphHover;
  delete e.sparrowSeraphBotFireAt;
  delete e.sparrowSeraphBotAim;
}

function release(room, player, now, { requestId, angle, viewRewindMs = 0, auto = false }) {
  end(player);
  player.lastCombatAt = now;
  sparrowCombat().fireBolt(room, player, { requestId, angle, viewRewindMs, auto });
}

// A human's release: { type: 'sparrow-light-bolt', id, angle }. Accepted once
// per aim phase; locks (a pull, a stomp) do not hold the shot back.
function requestFire(room, player, data, now = Date.now()) {
  if (!player?.isAlive || room.status !== "active" || !isAiming(player, now)) return false;
  const angle = validAngle(data?.angle);
  const requestId = typeof data?.id === "string" ? data.id.slice(0, 128) : "";
  if (angle === null || !requestId) return false;
  release(room, player, now, { requestId, angle, viewRewindMs: Number(data?.viewRewindMs) || 0 });
  return true;
}

// The angle to the nearest living enemy's body centre, for a bot's aim.
function botTargetAngle(room, player) {
  let best = null;
  for (const target of room.players.values()) {
    if (target === player || !target.isAlive || (player.team && target.team === player.team)) continue;
    const d = Math.hypot(target.x - player.x, target.y - player.y);
    if (!best || d < best.d) best = { d, target };
  }
  return best ? Math.atan2(best.target.y - player.y, best.target.x - player.x) : null;
}

// A bot draws the bow onto its target the way a player drags the aim, not a
// turret: it re-reads where the target is every SERAPH.botLookMs, carries a
// fresh aiming error each look, sways a little, and eases toward that point
// no faster than SERAPH.botTurnDegPerSec. Her pose shows the held angle and
// the bolt flies along it, so the shot can miss.
const DEG = Math.PI / 180;
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const between = (room, [min, max]) => min + combatRandom(room) * (max - min);

function steerBotAim(room, player, e, now) {
  const aim = e.sparrowSeraphBotAim;
  const dt = Math.min(0.1, Math.max(0, (now - aim.at) / 1000));
  aim.at = now;
  const elapsed = now - e.sparrowSeraphStartedAt;
  if (elapsed >= SERAPH.botAimDelayMs && now >= (aim.nextLookAt || 0)) {
    const seen = botTargetAngle(room, player);
    if (seen !== null) {
      aim.goal = seen;
      aim.error = (combatRandom(room) * 2 - 1) * SERAPH.botMissDeg * DEG;
    }
    aim.nextLookAt = now + between(room, SERAPH.botLookMs);
  }
  if (aim.goal != null) {
    aim.drift = (aim.drift || 0) + (aim.error - (aim.drift || 0)) * (1 - Math.exp(-4 * dt));
    const sway = Math.sin(elapsed / SERAPH.botSwayWaveMs) * SERAPH.botSwayDeg * DEG;
    const diff = wrap(aim.goal + aim.drift + sway - aim.angle);
    const eased = diff * (1 - Math.exp(-SERAPH.botTurnEasePerSec * dt));
    const maxStep = SERAPH.botTurnDegPerSec * DEG * dt;
    aim.angle = validAngle(aim.angle + Math.sign(eased) * Math.min(Math.abs(eased), maxStep));
  }
  const { direction, flipX } = seraphAimPose(aim.angle, player.flip);
  player.flip = flipX;
  player.animation = direction.logical;
  return aim.angle;
}

// A bot hovers where it rose to; knockback velocity carries the hover point
// and drains away, and a hook pull moves it outright.
function flyBotHover(room, player, e, now) {
  const hover = e.sparrowSeraphHover;
  const dt = Math.min(0.1, Math.max(0, (now - hover.at) / 1000));
  hover.at = now;
  const elapsed = now - e.sparrowSeraphStartedAt;
  const rise = Math.min(1, elapsed / SERAPH.riseMs);
  const lift = SERAPH.liftPx * (1 - (1 - rise) ** 3);
  const bob = Math.sin(elapsed / SERAPH.bobWaveMs) * SERAPH.bobPx;
  if (player._gloopPullState) {
    hover.x = player.x; hover.y = player.y + lift - bob;
    return;
  }
  hover.x += (Number(player.vx) || 0) * dt;
  hover.y += (Number(player.vy) || 0) * dt;
  const drag = Math.exp(-SERAPH.hoverDragPerSec * dt);
  player.vx = (Number(player.vx) || 0) * drag;
  player.vy = (Number(player.vy) || 0) * drag;
  player.x = clampToWorld(hover.x, "x", room);
  player.y = clampToWorld(hover.y - lift + bob, "y", room);
  player.grounded = false;
}

function tick(room, caster, now) {
  const e = caster?.effects;
  if (!e || !(Number(e.sparrowSeraphUntil) > 0) || e.sparrowSeraphFired) return;
  if (!caster.isAlive || caster.connected === false || room.status !== "active") {
    end(caster);
    return;
  }
  if (caster.isBot && e.sparrowSeraphHover) flyBotHover(room, caster, e, now);
  const botAngle = caster.isBot && e.sparrowSeraphBotAim ? steerBotAim(room, caster, e, now) : null;
  caster.lastCombatAt = now;
  const auto = now >= Number(e.sparrowSeraphUntil) + SERAPH.releaseGraceMs;
  const botReady = caster.isBot && now >= (Number(e.sparrowSeraphBotFireAt) || Infinity) &&
    Math.max(caster._controlLockUntil || 0, caster._attackInterruptedUntil || 0) <= now;
  if (!auto && !botReady) return;
  release(room, caster, now, {
    requestId: `seraph:${e.sparrowSeraphSeq}`,
    angle: auto ? (botAngle ?? seraphPoseAngle(caster.animation, caster.flip) ?? facingAngle(caster.flip)) : botAngle ?? facingAngle(caster.flip),
    auto,
  });
}

function isMovementSuppressed(player, now) {
  return isAiming(player, now);
}

module.exports = {
  key: "sparrow",
  activate,
  tick,
  isAiming,
  requestFire,
  isMovementSuppressed,
  // The aim phase still takes positions from a human Sparrow's client, which
  // flies the hover and every knockback or pull.
  acceptsClientPosition: true,
  damageTakenMult(player, now) {
    return isAiming(player, now) ? SERAPH.damageTakenMult : 1;
  },
};
