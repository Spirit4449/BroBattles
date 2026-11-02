// The motion behind Bank Bust's coins and crate, with no Phaser in it, so what
// makes them feel right can be tested directly.

export const COIN_SPIN_FRAMES = 16;
// The sheet is drawn at four times the size a coin is laid out at, so it stays
// sharp on high-resolution screens. Sprites scale by COIN_FRAME_SCALE to match.
export const COIN_FRAME_SIZE = 112;
export const COIN_FRAME_SCALE = 28 / COIN_FRAME_SIZE;
const COIN_GRAVITY = 1500; // px/s^2
const COIN_BOUNCE = 0.46; // vertical speed kept per bounce
const COIN_FLOOR_DRAG = 0.68; // horizontal speed kept per bounce
const COIN_REST_SPEED = 70; // below this a bounce stops being worth drawing

// One step of a thrown coin. `floorY`, when set, is the surface it bounces on
// for as long as it stays inside `floorLeft`..`floorRight`; past those edges it
// falls away. Returns true on the step it strikes the floor.
export function stepLooseCoin(coin, dt) {
  if (coin.resting) return false;
  coin.vy += COIN_GRAVITY * dt;
  coin.x += coin.vx * dt;
  coin.y += coin.vy * dt;
  const overFloor =
    Number.isFinite(coin.floorY) &&
    (!Number.isFinite(coin.floorLeft) || coin.x >= coin.floorLeft) &&
    (!Number.isFinite(coin.floorRight) || coin.x <= coin.floorRight);
  if (!overFloor || coin.vy <= 0 || coin.y < coin.floorY) return false;
  coin.y = coin.floorY;
  coin.vy = -coin.vy * COIN_BOUNCE;
  coin.vx *= COIN_FLOOR_DRAG;
  if (Math.abs(coin.vy) < COIN_REST_SPEED) {
    coin.vy = 0;
    coin.vx = 0;
    coin.resting = true;
  }
  return true;
}

// A collected coin's path: a bowed curve that starts slowly and whips in, so
// coins peel away in a stream rather than sliding along a straight line.
export function homingPoint(from, bow, to, progress) {
  const t = Math.min(1, Math.max(0, progress));
  const eased = t * t * (3 - 2 * t) * 0.35 + t * t * 0.65;
  const midX = (from.x + to.x) / 2 + bow.x;
  const midY = (from.y + to.y) / 2 + bow.y;
  const inv = 1 - eased;
  return {
    x: inv * inv * from.x + 2 * inv * eased * midX + eased * eased * to.x,
    y: inv * inv * from.y + 2 * inv * eased * midY + eased * eased * to.y,
  };
}

// Spin is counted in eighths of a turn, whatever the sheet's frame count, so
// spin rates read the same however finely the turn is drawn.
export function coinSpinFrame(accumulator) {
  const whole = Math.floor((accumulator * COIN_SPIN_FRAMES) / 8) % COIN_SPIN_FRAMES;
  return whole < 0 ? whole + COIN_SPIN_FRAMES : whole;
}

const CRATE_ROCK_STIFFNESS = 240;
const CRATE_ROCK_DAMPING = 8;
const CRATE_SQUASH_STIFFNESS = 520;
const CRATE_SQUASH_DAMPING = 18;
const CRATE_ROCK_LIMIT = 0.3; // radians; further than this and it would topple

export function createCrateSpring() {
  return { rock: 0, rockSpeed: 0, squash: 0, squashSpeed: 0 };
}

// A blow knocks the crate away from the attacker and flattens it slightly.
// Strength is about 1 for an ordinary hit.
export function kickCrate(spring, side, strength = 1) {
  spring.rockSpeed += (side < 0 ? -1 : 1) * 2.5 * strength;
  spring.squashSpeed -= 2.6 * strength;
}

// Sub-stepped so a long frame cannot launch it: the spring is stiff enough that
// one 50ms step would otherwise gain energy rather than lose it.
export function stepCrateSpring(spring, dt) {
  const steps = Math.max(1, Math.ceil(dt / 0.008));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    spring.rockSpeed += (-CRATE_ROCK_STIFFNESS * spring.rock - CRATE_ROCK_DAMPING * spring.rockSpeed) * h;
    spring.rock += spring.rockSpeed * h;
    spring.squashSpeed += (-CRATE_SQUASH_STIFFNESS * spring.squash - CRATE_SQUASH_DAMPING * spring.squashSpeed) * h;
    spring.squash += spring.squashSpeed * h;
  }
  spring.rock = Math.max(-CRATE_ROCK_LIMIT, Math.min(CRATE_ROCK_LIMIT, spring.rock));
  return spring;
}

// A coin that has come to rest turns on, slowly, until it faces front, so none
// are left lying as an edge-on sliver. Frames 0 and half way round are the faces.
export function settleCoinSpin(spin, dt) {
  if (coinSpinFrame(spin) % (COIN_SPIN_FRAMES / 2) === 0) return spin;
  return spin + 10 * dt;
}

// Which artwork a crate at this much health shows.
export function crateStage(healthRatio) {
  if (healthRatio > 0.6) return "intact";
  return healthRatio > 0.25 ? "damaged" : "broken";
}
