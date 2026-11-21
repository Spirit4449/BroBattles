const BRO_BALL_MODE = 'soccer';
const BRO_BALL_VARIANT = 'soccer-2v2';

// The ball is kicked by body contact, by coming within reach during an attack
// or super (away from the kicker with some lift), or by dashing through it.
const ballRules = Object.freeze({
  radius: 24,
  gravity: 700,
  floorRestitution: 0.51,
  hardLandingRestitution: 0.76,
  // Blend in the extra rebound between these downward impact speeds (px/s).
  hardLandingMinSpeed: 280,
  hardLandingFullSpeed: 650,
  wallRestitution: 0.65,
  // Extra reach in px for passive player touches.
  bodyContactPadding: 6,
  // Additional reach above the head, around the local super bar.
  bodyContactTopPadding: 8,
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
  // Treat foot contact within this many px of the player's center as head-on.
  footCenterTolerance: 4,
  dashReach: 16,
  dashGraceMs: 85,
  maxSpeed: 1650,
  kickSpeed: 720,
  // Upward bias added to the contact direction for attacks and supers.
  kickLift: 0.55,
  // A super kick uses the same direction with a higher launch speed.
  superKickSpeed: 1150,
  dashSpeed: 1340,
  // A level dash on a grounded ball lifts it over the goal step.
  dashLift: 0.48,
  smashSpeed: 1540,
  smashLiftRatio: 0.6,
  kickReach: 30,
  // Close-range kick grace after a cast releases, or after an instant action.
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
