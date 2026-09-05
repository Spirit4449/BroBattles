const states = new WeakMap();
const RELEASE_MS = 700;

export function resetSuperBarAnimation(graphics, player) {
  if (graphics) states.delete(graphics);
  if (player) player._superBarLaunch = 0;
}

export function drawSuperChargeBar(graphics, background, {
  x, y, charge, maxCharge, player, notReady = false,
}) {
  const width = 60;
  const height = 4;
  const now = graphics.scene.time.now;
  const wallNow = Date.now();
  const fraction = maxCharge > 0 ? Math.max(0, Math.min(1, charge / maxCharge)) : 0;
  const launch = player?._superBarLaunch || 0;
  let state = states.get(graphics);
  if (!state || graphics.visible === false) {
    state = { fraction, launch, releasedAt: -Infinity, releasedFraction: 0 };
    states.set(graphics, state);
  }
  const launched = launch !== state.launch;
  const spent = state.fraction >= 1 && fraction < state.fraction;
  if (launched || spent) {
    // Charge and special events can arrive on adjacent frames: show one release.
    if (now - state.releasedAt > 100) {
      state.releasedAt = now;
      state.releasedFraction = launched ? 1 : state.fraction;
    }
  }
  state.fraction = fraction;
  state.launch = launch;

  // Coordinates are drawn in world space. Keep both Graphics objects at the
  // same neutral transform so state changes (including ducking) cannot leave
  // either layer with an additional positional or scale offset.
  graphics.setPosition(0, 0).setScale(1).setRotation(0).clear();
  background.setPosition(0, 0).setScale(1).setRotation(0).clear();
  background.fillStyle(0x222222, 0.65);
  background.fillRect(x, y, width, height);

  const sustained = launch > 0 && Math.max(
    Number(player?._thorgRageUntil) || 0,
    Number(player?._dravenInfernoUntil) || 0,
  ) > wallNow;
  const pulse = 0.5 + 0.5 * Math.sin(now / 160);
  const release = Math.max(0, 1 - (now - state.releasedAt) / RELEASE_MS) ** 2;
  const glowAlpha = sustained ? 0.45 + pulse * 0.4 : fraction >= 1 ? 0.3 + pulse * 0.3 : 0;
  const glow = Math.max(glowAlpha, release);
  if (glow > 0) {
    for (let spread = 3; spread >= 1; spread--) {
      graphics.fillStyle(0xffd700, glow * 0.09);
      graphics.fillRoundedRect(x - spread, y - spread, width + spread * 2, height + spread * 2, spread);
    }
  }
  if (notReady && fraction < 1) {
    graphics.fillStyle(0xff4444, 0.65 + 0.35 * Math.abs(Math.sin(wallNow / 75)));
    graphics.fillRect(x, y, width * Math.max(fraction, 0.18), height);
  } else if (fraction > 0) {
    graphics.fillStyle(fraction >= 1 ? 0xffd700 : 0xffff00, 1);
    graphics.fillRect(x, y, width * fraction, height);
  }
  // The spent charge keeps its width and fades to empty, like health chunks.
  if (release > 0) {
    graphics.fillStyle(0xffd700, release);
    graphics.fillRect(x, y, width * state.releasedFraction, height);
    graphics.fillStyle(0xfff6cf, release * 0.9);
    graphics.fillRect(x, y, width * state.releasedFraction, 1);
  }
  if (glow > 0) {
    graphics.lineStyle(1, sustained ? 0xffd700 : 0xfff6cf, glow);
    graphics.strokeRect(x, y, width, height);
  }
  graphics.setDepth(41);
  background.setDepth(40);
}
