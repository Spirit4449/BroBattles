const { SERAPH, facingAngle, validAngle } = require("../../../characters/sparrowLightBolt.js");
const { seraphPoseAngle } = require("../../../characters/sparrowSeraphAim.js");
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
    player.vx = 0; player.vy = 0;
  }
}

function end(player) {
  const e = player.effects || {};
  e.sparrowSeraphUntil = 0;
  e.sparrowSeraphFired = true;
  delete e.sparrowSeraphHover;
  delete e.sparrowSeraphBotFireAt;
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

// The nearest living enemy's body centre, for a bot's aim.
function botAim(room, player) {
  let best = null;
  for (const target of room.players.values()) {
    if (target === player || !target.isAlive || (player.team && target.team === player.team)) continue;
    const d = Math.hypot(target.x - player.x, target.y - player.y);
    if (!best || d < best.d) best = { d, target };
  }
  if (!best) return facingAngle(player.flip);
  const dx = best.target.x - player.x;
  player.flip = dx < 0;
  return Math.atan2(best.target.y - player.y, dx);
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
  player.animation = "seraph-aim-06";
}

function tick(room, caster, now) {
  const e = caster?.effects;
  if (!e || !(Number(e.sparrowSeraphUntil) > 0) || e.sparrowSeraphFired) return;
  if (!caster.isAlive || caster.connected === false || room.status !== "active") {
    end(caster);
    return;
  }
  if (caster.isBot && e.sparrowSeraphHover) flyBotHover(room, caster, e, now);
  caster.lastCombatAt = now;
  const auto = now >= Number(e.sparrowSeraphUntil) + SERAPH.releaseGraceMs;
  const botReady = caster.isBot && now >= (Number(e.sparrowSeraphBotFireAt) || Infinity) &&
    Math.max(caster._controlLockUntil || 0, caster._attackInterruptedUntil || 0) <= now;
  if (!auto && !botReady) return;
  release(room, caster, now, {
    requestId: `seraph:${e.sparrowSeraphSeq}`,
    angle: auto ? (seraphPoseAngle(caster.animation, caster.flip) ?? facingAngle(caster.flip)) : botAim(room, caster),
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
