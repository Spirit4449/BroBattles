import { RENDER_LAYERS } from "./renderLayers";
import { addPixelCircle, fillPixelBlob, rasterizePixelBlob } from "./fx/pixelShapes";
import { POWERUP_TYPES, POWERUP_COLORS, POWERUP_LIGHT_COLORS } from "../powerups/powerupConfig";
import { EFFECT_RULES } from "../../../shared/effectRules";

// One badge per powerup type, in catalog order (powerups.catalog.json).
const DISPLAY_EFFECTS = POWERUP_TYPES;
const BADGE_COLORS = POWERUP_COLORS; // countdown ring
const BADGE_LIGHT_COLORS = POWERUP_LIGHT_COLORS; // badge fill
const FULL_TURN = Math.PI * 2;
const BADGE_PIXEL_SIZE = 1;
const TIMER_RING_THICKNESS = 2;
const TIMER_RING = rasterizePixelBlob(
  Array.from({ length: 32 }, (_, index) => {
    const angle = index / 32 * FULL_TURN;
    return { x: 12.5 * Math.cos(angle), y: 12.5 * Math.sin(angle) };
  }),
  { cell: BADGE_PIXEL_SIZE, grow: 0, ringCount: TIMER_RING_THICKNESS },
);
// Full duration of each effect, used to draw the countdown ring. Thorg's rage
// shares the rage badge but has its own duration (thorg.json).
const EFFECT_DURATIONS_MS = Object.fromEntries(
  Object.entries(EFFECT_RULES).map(([key, rule]) => [key, rule.durationMs]),
);

function textureFor(scene, type) {
  const webp = `pu-icon-${type}-webp`;
  const png = `pu-icon-${type}-png`;
  if (scene?.textures?.exists?.(webp)) return webp;
  if (scene?.textures?.exists?.(png)) return png;
  return null;
}

function containImage(image, maxWidth, maxHeight) {
  const width = Math.max(1, Number(image.width) || 1);
  const height = Math.max(1, Number(image.height) || 1);
  image.setScale(Math.min(maxWidth / width, maxHeight / height));
}

function activeIconTypes(effects = {}, recentEffects = {}) {
  const types = DISPLAY_EFFECTS.filter((type) => (Number(effects[type]) || 0) > 0);
  const now = Date.now();
  for (const type of DISPLAY_EFFECTS) {
    if ((Number(recentEffects[type]) || 0) > now && !types.includes(type)) types.push(type);
  }
  if ((Number(effects.thorgRage) || 0) > 0) types.push("rage");
  return types;
}

function createBadge(scene) {
  const pixelOptions = { cell: BADGE_PIXEL_SIZE };
  const shadow = addPixelCircle(scene, 1, 1.5, 11, 0x000000, 0.55, pixelOptions);
  const background = addPixelCircle(scene, 0, 0, 10.5, 0xffd7b5, 0.97, pixelOptions);
  const glow = addPixelCircle(scene, 0, 0, 8.5, 0xffffff, 0.2, pixelOptions);
  const icon = scene.add.image(0, 0, "pu-icon-shield-webp");
  const timer = scene.add.graphics();
  const container = scene.add.container(0, 0, [shadow, background, glow, icon, timer])
    .setDepth(RENDER_LAYERS.PLAYER_HUD + 3)
    .setVisible(false);
  const pulseTween = scene.tweens.add({
    targets: glow,
    alpha: { from: 0.12, to: 0.38 },
    scaleX: { from: 0.88, to: 1.08 },
    scaleY: { from: 0.88, to: 1.08 },
    duration: 560,
    ease: "Sine.InOut",
    yoyo: true,
    repeat: -1,
  });
  return {
    container, background, glow, icon, timer, pulseTween,
    type: null, shown: false, transitionTween: null,
  };
}

function drawTimerRing(badge, type, effects = {}, recentEffects = {}) {
  const remainingMs = Number(
    type === "rage" && (Number(effects.thorgRage) || 0) > (Number(effects.rage) || 0)
      ? effects.thorgRage
      : effects[type],
  ) || 0;
  const hasRecentEffect = (Number(recentEffects[type]) || 0) > Date.now();
  const durationMs = EFFECT_DURATIONS_MS[
    type === "rage" && remainingMs === Number(effects.thorgRage) ? "thorgRage" : type
  ] || 1;
  const progress = remainingMs > 0
    ? Phaser.Math.Clamp(remainingMs / durationMs, 0, 1)
    : (hasRecentEffect ? 1 : 0);

  badge.timer.clear();
  if (progress <= 0) return;
  fillPixelBlob(badge.timer, TIMER_RING, BADGE_COLORS[type] || 0xffffff, 1, (depth, x, y) => {
    if (depth > TIMER_RING_THICKNESS) return false;
    const angleFromTop = (Math.atan2(x, -y) + FULL_TURN) % FULL_TURN;
    return angleFromTop <= FULL_TURN * progress;
  });
}

function showBadge(scene, badge, type, texture) {
  const changed = badge.type !== type;
  // Active badges are synchronized every frame. Do not cancel their in-flight
  // entrance animation or reset their opacity/scale on those refreshes.
  if (badge.shown && !changed) {
    badge.container.setVisible(true);
    return;
  }
  badge.transitionTween?.remove?.();
  badge.transitionTween = null;
  if (changed) {
    scene.textures.get(texture).setFilter(Phaser.Textures.FilterMode.LINEAR);
    badge.icon.setTexture(texture);
    containImage(badge.icon, 16, 16);
    badge.background.setTint(BADGE_LIGHT_COLORS[type] || 0xf8fafc);
    badge.type = type;
  }
  badge.container.setVisible(true);
  badge.shown = true;
  badge.container.setAlpha(0).setScale(0.45);
  badge.transitionTween = scene.tweens.add({
    targets: badge.container,
    alpha: 1,
    scaleX: 1,
    scaleY: 1,
    duration: 210,
    ease: "Back.Out",
    onComplete: () => { badge.transitionTween = null; },
  });
}

function hideBadge(scene, badge, animate = true) {
  if (!badge?.shown) return;
  badge.transitionTween?.remove?.();
  badge.transitionTween = null;
  badge.shown = false;
  if (!animate) {
    badge.container.setVisible(false);
    return;
  }
  badge.transitionTween = scene.tweens.add({
    targets: badge.container,
    alpha: 0,
    scaleX: 0.45,
    scaleY: 0.45,
    duration: 170,
    ease: "Cubic.In",
    onComplete: () => {
      badge.container.setVisible(false);
      badge.transitionTween = null;
    },
  });
}

export function setStatusIconStackVisible(badges = [], visible = true) {
  badges.forEach((badge) => badge?.container?.setVisible(visible && badge.shown));
}

export function setStatusIconStackAlpha(badges = [], alpha = 1) {
  badges.forEach((badge) => badge?.container?.setAlpha(alpha));
}

export function syncStatusIconStack({
  scene, icons = [], effects, recentEffects, x, y,
  visible = true, offset = 15, startIndex = 0,
}) {
  const types = activeIconTypes(effects, recentEffects);
  while (icons.length < types.length) icons.push(createBadge(scene));
  const crowdShift = Math.min(10, Math.max(0, types.length - 1) * 3);

  icons.forEach((badge, index) => {
    const type = types[index];
    const texture = type ? textureFor(scene, type) : null;
    if (!type || !texture || !visible) {
      hideBadge(scene, badge, !!type && !!texture);
      return;
    }
    // 22px badges at 15px spacing overlap by 7px.
    badge.container.setPosition(
      x + crowdShift - (startIndex + index) * offset,
      y,
    );
    showBadge(scene, badge, type, texture);
    drawTimerRing(badge, type, effects, recentEffects);
  });
  return icons;
}

export function destroyStatusIconStack(icons = []) {
  for (const badge of icons) {
    badge?.transitionTween?.remove?.();
    badge?.pulseTween?.remove?.();
    badge?.container?.destroy?.(true);
  }
  icons.length = 0;
}
