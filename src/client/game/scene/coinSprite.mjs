export const COIN_SPIN_FRAMES = 16;
// The sheet is drawn at four times the size a coin is laid out at, so it stays
// sharp on high-resolution screens. Sprites scale by COIN_FRAME_SCALE to match.
export const COIN_FRAME_SIZE = 112;
export const COIN_FRAME_SCALE = 28 / COIN_FRAME_SIZE;

// Spin is counted in eighths of a turn, whatever the sheet's frame count, so
// spin rates read the same however finely the turn is drawn.
export function coinSpinFrame(accumulator) {
  const whole = Math.floor((accumulator * COIN_SPIN_FRAMES) / 8) % COIN_SPIN_FRAMES;
  return whole < 0 ? whole + COIN_SPIN_FRAMES : whole;
}
