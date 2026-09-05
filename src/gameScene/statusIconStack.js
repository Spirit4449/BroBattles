import { RENDER_LAYERS } from "./renderLayers";

const DISPLAY_EFFECTS = [
  "rage", "health", "shield", "poison", "gravityBoots",
  "invisibility", "shockwave", "freeze",
];

const BADGE_COLORS = {
  rage: 0xa855f7, health: 0x34d399, shield: 0xf97316,
  poison: 0xfacc15, gravityBoots: 0xef4444, invisibility: 0xc084fc,
  shockwave: 0xff8a00, freeze: 0x67e8f9,
};

const BADGE_LIGHT_COLORS = {
  rage: 0xddc2fa, health: 0xa8edc0, shield: 0xfbc89f,
  poison: 0xf5e36f, gravityBoots: 0xf5b8b8, invisibility: 0xddc2fa,
  shockwave: 0xfbc891, freeze: 0xb8eef5,
};

function textureFor(scene, type) {
  const webp = `pu-icon-${type}-webp`;
  const png = `pu-icon-${type}-png`;
  if (scene?.textures?.exists?.(webp)) return webp;
  if (scene?.textures?.exists?.(png)) return png;
  return null;
}

function useSmoothFiltering(scene, texture) {
  try {
    scene.textures.get(texture).setFilter(Phaser.Textures.FilterMode.LINEAR);
  } catch (_) {}
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
  const shadow = scene.add.circle(1, 1.5, 11, 0x000000, 0.55);
  const background = scene.add.circle(0, 0, 10.5, 0xffd7b5, 0.97)
    .setStrokeStyle(2, 0xffffff, 0.9);
  const glow = scene.add.circle(0, 0, 8.5, 0xffffff, 0.2);
  const icon = scene.add.image(0, 0, "pu-icon-shield-webp");
  const container = scene.add.container(0, 0, [shadow, background, glow, icon])
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
    container, background, glow, icon, pulseTween,
    type: null, shown: false, transitionTween: null,
  };
}

function showBadge(scene, badge, type, texture) {
  const color = BADGE_COLORS[type] || 0xffffff;
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
    useSmoothFiltering(scene, texture);
    badge.icon.setTexture(texture);
    containImage(badge.icon, 16, 16);
    badge.background
      .setFillStyle(BADGE_LIGHT_COLORS[type] || 0xf8fafc, 0.97)
      .setStrokeStyle(2, color, 1);
    badge.glow.setFillStyle(0xffffff, 0.3);
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
