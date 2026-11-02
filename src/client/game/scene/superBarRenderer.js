import {
  drawPixelFill, drawPixelFrame, drawPixelGlow, drawPixelTrough, snapPixel,
} from "./pixelBar";

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
  const activeSuper = [
    {
      until: Number(player?._thorgRageUntil) || 0,
      startedAt: Number(player?._thorgRageStartedAt) || 0,
    },
    {
      until: Number(player?._dravenInfernoUntil) || 0,
      startedAt: Number(player?._dravenInfernoStartedAt) || 0,
    },
  ].find(({ until }) => until > wallNow);
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
  x = snapPixel(x);
  y = snapPixel(y);

  // Channeled supers spend their charge immediately. Keep their remaining
  // duration in the bar instead, so the fill visibly drains during the effect.
  const sustained = Boolean(activeSuper);
  const activeDuration = sustained
    ? Math.max(1, activeSuper.until - (activeSuper.startedAt || wallNow))
    : 1;
  const activeFraction = sustained
    ? Math.max(0, Math.min(1, (activeSuper.until - wallNow) / activeDuration))
    : 0;
  const displayedFraction = sustained ? activeFraction : fraction;
  // Quantised pulse so the glow blinks in steps like a sprite animation.
  const pulse = Math.round((0.5 + 0.5 * Math.sin(now / 160)) * 3) / 3;
  const release = Math.max(0, 1 - (now - state.releasedAt) / RELEASE_MS) ** 2;
  const glowAlpha = sustained ? 0.5 + pulse * 0.22 : fraction >= 1 ? 0.3 + pulse * 0.3 : 0;
  const glow = Math.max(glowAlpha, sustained ? 0 : release);
  if (glow > 0) {
    // Match the health-bar halo: stepped and attached to the bar.
    drawPixelGlow(background, x, y, width, height, 0xffd700, glow);
  }
  drawPixelFrame(background, x, y, width, height);
  drawPixelTrough(background, x, y, width, height, 0x2e2a1c);
  if (notReady && fraction < 1) {
    const blink = Math.floor(wallNow / 90) % 2 ? 1 : 0.55;
    drawPixelFill(graphics, x, y, width * Math.max(fraction, 0.18), height, 0xff4444, blink);
  } else if (displayedFraction > 0) {
    drawPixelFill(graphics, x, y, width * displayedFraction, height,
      displayedFraction >= 1 ? 0xffd700 : 0xf2c21b, sustained ? 0.72 + pulse * 0.28 : 1);
    if (sustained) {
      graphics.fillStyle(0xfff6cf, 0.18 + pulse * 0.45);
      graphics.fillRect(x, y, Math.round(width * displayedFraction), 1);
    }
  }
  // The spent charge keeps its width and fades to empty, like health chunks.
  if (release > 0 && !sustained) {
    const steppedRelease = Math.ceil(release * 4) / 4;
    graphics.fillStyle(0xfff6cf, steppedRelease);
    graphics.fillRect(x, y, Math.round(width * state.releasedFraction), height);
  }
  if (glow > 0) {
    // Light the outer frame ring when the super is ready or burning.
    graphics.fillStyle(sustained ? 0xffd700 : 0xfff6cf, glow);
    graphics.fillRect(x, y - 2, width, 1);
    graphics.fillRect(x, y + height + 1, width, 1);
    graphics.fillRect(x - 2, y, 1, height);
    graphics.fillRect(x + width + 1, y, 1, height);
  }
  graphics.setDepth(41);
  background.setDepth(40);
}
