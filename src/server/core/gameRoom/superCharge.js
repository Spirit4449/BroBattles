const { getSuperChargePerHit } = require("../../../lib/characterStats");

// Called once per accepted enemy hit that dealt positive damage, never for
// passive damage, self-hits, or vault damage.
function chargeSuperForHit(room, attacker, attackType) {
  const gain = getSuperChargePerHit(attacker.char_class, attackType);
  if (!(gain > 0) || !(attacker.maxSuperCharge > 0)) return;
  const previous = attacker.superCharge || 0;
  attacker.superCharge = Math.min(attacker.maxSuperCharge, previous + gain);
  if (attacker.superCharge === previous) return;
  room.io.to(`game:${room.matchId}`).emit("super-update", {
    username: attacker.name,
    charge: attacker.superCharge,
    maxCharge: attacker.maxSuperCharge,
  });
}

module.exports = { chargeSuperForHit };
