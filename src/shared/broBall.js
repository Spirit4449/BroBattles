const BRO_BALL_MODE = 'soccer';
const BRO_BALL_VARIANT = 'soccer-2v2';

// The ball is only ever kicked: by body contact, by an attack or super fired
// within reach (away from the kicker and upward), or by dashing through it.
const ballRules = Object.freeze({
  radius: 24,
  gravity: 700,
  floorRestitution: 0.51,
  hardLandingRestitution: 0.76,
  // Blend in the extra rebound between these downward impact speeds (px/s).
  hardLandingMinSpeed: 280,
  hardLandingFullSpeed: 650,
  wallRestitution: 0.65,
  // Maximum passive overlap correction per player in px/s.
  bodySeparationSpeed: 90,
  bodyRestitution: 0.52,
  // Sideways speed below which a ball can linger over a player's head (px/s).
  headSlipSpeed: 110,
  // Fraction of the player's run speed transferred by a brush across the head.
  headRunTransfer: 0.55,
  // Minimum upward speed when a standing-up player's head pops the ball (px/s).
  unduckLift: 180,
  rollingDrag: 440,
  // Exponential damping per second on both airborne velocity components.
  airDrag: 0.58,
  settleSpeed: 60,
  // A grounded touch from the side pops the ball up.
  bodyLift: 260,
  bodyLiftMax: 360,
  bodyLiftFloorRange: 22,
  dashReach: 16,
  dashGraceMs: 85,
  maxSpeed: 1650,
  // An attack kick sends the ball away from the kicker, tilted well upward.
  kickSpeed: 720,
  kickLift: 0.95,
  // A super kick is harder and climbs as steeply.
  superKickSpeed: 1150,
  dashSpeed: 1340,
  // A level dash on a grounded ball lifts it over the goal step.
  dashLift: 0.48,
  smashSpeed: 1540,
  smashLiftRatio: 0.6,
  kickReach: 30,
  kickWindowMs: 160,
  // Bots kick at most this often (people are limited by their attack reload).
  botKickCooldownMs: 420,
  // Each rally starts with the ball dropped from high over the centre with a
  // little sideways drift.
  kickoffDrift: 70,
  // Recharge time after the dash burst.
  dashCooldownMs: 2000,
  scoreLimit: 5,
  regulationMs: 180000,
  overtimeMs: 45000,
  goalPauseMs: 2400,
  respawnMs: 2000,
});

/** The pitch the ball simulates against, from resolved map geometry. */
function broBallField(geometry, layout) {
  return {
    goals: layout.goals,
    kickoff: layout.kickoff,
    floor: geometry.anchors['pitch-floor'].top,
    roof: geometry.anchors.ceiling?.bottom ?? layout.goals.team1.top - 250,
    colliders: geometry.colliders,
  };
}

module.exports = { BRO_BALL_MODE, BRO_BALL_VARIANT, ballRules, broBallField };
