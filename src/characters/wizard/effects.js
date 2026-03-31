const POWERUP_TINTS = {
  rage: 0xa855f7,
  health: 0x34d399,
  shield: 0xf97316,
  poison: 0xfacc15,
  gravityBoots: 0xef4444,
};
const ARCANE_SURGE_DARK_MS = 2000;
const ALLY_GLOW_COLOR = 0x7dd3fc;

function getPowerupTextureKey(scene, type) {
  const webp = `pu-icon-${type}-webp`;
  const png = `pu-icon-${type}-png`;
  if (scene?.textures?.exists(webp)) return webp;
  if (scene?.textures?.exists(png)) return png;
  return null;
}

function getSpriteAnchor(sprite) {
  const height = sprite?.displayHeight || sprite?.height || 120;
  return {
    x: Number(sprite?.x) || 0,
    y: (Number(sprite?.y) || 0) - height * 0.18,
    height,
  };
}

function destroyMany(items = []) {
  for (const item of items) {
    try {
      item?.destroy?.();
    } catch (_) {}
  }
}

function pulseHtmlMatchBackgroundDarkness() {
  const bgImage = document.querySelector("#game-bg .background-image");
  if (!bgImage) return;

  const prevTransition = bgImage.style.transition || "";
  const prevFilter = bgImage.style.filter || "";
  if (bgImage._wizardArcaneSurgeTimer) {
    window.clearTimeout(bgImage._wizardArcaneSurgeTimer);
    bgImage._wizardArcaneSurgeTimer = null;
  }

  bgImage.style.transition = prevTransition
    ? `${prevTransition}, filter 180ms ease`
    : "filter 180ms ease";
  bgImage.style.filter = "brightness(0.33) saturate(0.78)";

  bgImage._wizardArcaneSurgeTimer = window.setTimeout(() => {
    bgImage.style.filter = prevFilter;
    window.setTimeout(() => {
      bgImage.style.transition = prevTransition;
    }, 220);
    bgImage._wizardArcaneSurgeTimer = null;
  }, ARCANE_SURGE_DARK_MS);
}

function createBlueTeamGlow(scene, sprite, isCaster) {
  const anchor = getSpriteAnchor(sprite);
  const outer = scene.add.circle(
    anchor.x,
    anchor.y,
    isCaster ? 54 : 42,
    ALLY_GLOW_COLOR,
    isCaster ? 0.2 : 0.14,
  );
  const inner = scene.add.circle(
    anchor.x,
    anchor.y,
    isCaster ? 28 : 22,
    0xe0f2fe,
    isCaster ? 0.18 : 0.12,
  );
  outer.setDepth((sprite.depth || 20) + 2);
  inner.setDepth((sprite.depth || 20) + 3);

  const state = { t: 0 };
  scene.tweens.add({
    targets: state,
    t: 1,
    duration: ARCANE_SURGE_DARK_MS,
    ease: "Sine.easeInOut",
    onUpdate: () => {
      const next = getSpriteAnchor(sprite);
      const pulse = 0.76 + Math.sin(state.t * Math.PI * 7) * 0.18;
      outer.x = next.x;
      outer.y = next.y;
      inner.x = next.x;
      inner.y = next.y;
      outer.alpha = (isCaster ? 0.18 : 0.12) * (1 - state.t * 0.72) * pulse;
      inner.alpha = (isCaster ? 0.22 : 0.14) * (1 - state.t * 0.65) * pulse;
      outer.scale = 1 + state.t * (isCaster ? 0.42 : 0.26);
      inner.scale = 1 + state.t * (isCaster ? 0.18 : 0.12);
    },
    onComplete: () => destroyMany([outer, inner]),
  });
}

function attachWizardAura(scene, sprite) {
  if (!scene?.add || !sprite?.active || !scene.textures?.exists("wizard-aura")) {
    return;
  }

  const animKey = scene.anims?.exists("wizard-aura-loop")
    ? "wizard-aura-loop"
    : null;
  const aura = scene.add.sprite(sprite.x, sprite.y, "wizard-aura");
  aura.setDepth((sprite.depth || 20) - 1);
  aura.setAlpha(0);
  aura.setScale(2);
  if (animKey) {
    try {
      aura.play(animKey, true);
    } catch (_) {}
  }

  const state = { t: 0 };
  scene.tweens.add({
    targets: state,
    t: 1,
    duration: ARCANE_SURGE_DARK_MS,
    ease: "Sine.easeInOut",
    onUpdate: () => {
      if (!sprite?.active) return;
      const anchor = getSpriteAnchor(sprite);
      const pulse = 0.84 + Math.sin(state.t * Math.PI * 6) * 0.12;
      aura.x = anchor.x;
      aura.y = anchor.y + anchor.height * 0.12;
      aura.alpha = 0.28 * (1 - state.t * 0.72) * pulse;
      aura.scaleX = (sprite.flipX ? -1 : 1) * (1.14 + state.t * 0.08);
      aura.scaleY = 1.12 + state.t * 0.1;
    },
    onComplete: () => {
      scene.tweens.add({
        targets: aura,
        alpha: 0,
        duration: 180,
        ease: "Quad.easeOut",
        onComplete: () => aura.destroy(),
      });
    },
  });
}

function playCasterSpecialAnimation(scene, sprite) {
  if (!scene?.time || !sprite?.active || !sprite?.anims) return;
  const specialKey = scene.anims?.exists("wizard-special")
    ? "wizard-special"
    : scene.anims?.exists("wizard-throw")
      ? "wizard-throw"
      : scene.anims?.exists("special")
        ? "special"
        : scene.anims?.exists("throw")
          ? "throw"
          : null;
  const idleKey = scene.anims?.exists("wizard-idle")
    ? "wizard-idle"
    : scene.anims?.exists("idle")
      ? "idle"
      : null;
  if (!specialKey) return;
  sprite._specialAnimLockUntil = Date.now() + ARCANE_SURGE_DARK_MS + 120;
  sprite._specialAnimLockUntilPerf = performance.now() + ARCANE_SURGE_DARK_MS + 120;

  try {
    sprite.anims.play(specialKey, true);
  } catch (_) {}

  scene.time.delayedCall(Math.max(450, ARCANE_SURGE_DARK_MS - 120), () => {
    if (!sprite?.active || !idleKey) return;
    try {
      const current = sprite.anims?.currentAnim?.key || "";
      if (current === specialKey) {
        sprite.anims.play(idleKey, true);
      }
    } catch (_) {}
  });
}

export function playWizardArcaneSurge(scene, payload, resolveSpriteByName) {
  if (!scene?.add || typeof resolveSpriteByName !== "function") return;

  const recipients = Array.isArray(payload?.recipients) ? payload.recipients : [];
  if (!recipients.length) return;
  pulseHtmlMatchBackgroundDarkness();

  try {
    scene.sound?.play?.("wizard-fireball", {
      volume: 0.42,
      rate: 0.58,
    });
  } catch (_) {}

  const casterSprite = resolveSpriteByName(payload?.caster);
  if (casterSprite?.active) {
    playCasterSpecialAnimation(scene, casterSprite);
    attachWizardAura(scene, casterSprite);
  }

  for (const entry of recipients) {
    const sprite = resolveSpriteByName(entry?.username);
    if (!sprite?.active) continue;

    const tint = POWERUP_TINTS[entry.type] || 0xffffff;
    const textureKey = getPowerupTextureKey(scene, entry.type);
    const anchor = getSpriteAnchor(sprite);
    const auraScale = entry?.isCaster ? 2.35 : 1.7;
    const auraAlpha = entry?.isCaster ? 0.34 : 0.22;
    createBlueTeamGlow(scene, sprite, !!entry?.isCaster);

    const glowOuter = scene.add.circle(anchor.x, anchor.y, 40, tint, auraAlpha);
    const glowInner = scene.add.circle(
      anchor.x,
      anchor.y,
      24,
      0xffffff,
      entry?.isCaster ? 0.24 : 0.14,
    );
    glowOuter.setDepth((sprite.depth || 20) + 3);
    glowInner.setDepth((sprite.depth || 20) + 4);

    scene.tweens.add({
      targets: [glowOuter, glowInner],
      scaleX: auraScale,
      scaleY: auraScale,
      alpha: 0,
      duration: 1150,
      ease: "Cubic.easeOut",
      onUpdate: () => {
        const next = getSpriteAnchor(sprite);
        glowOuter.x = next.x;
        glowOuter.y = next.y;
        glowInner.x = next.x;
        glowInner.y = next.y;
      },
      onComplete: () => destroyMany([glowOuter, glowInner]),
    });

    const orbit = scene.add.container(anchor.x, anchor.y);
    orbit.setDepth((sprite.depth || 20) + 5);
    const halo = scene.add.circle(0, 0, entry?.isCaster ? 26 : 20, tint, 0.28);
    const ring = scene.add.circle(0, 0, entry?.isCaster ? 32 : 26);
    ring.setStrokeStyle(2, 0xffffff, 0.88);
    const icon = textureKey
      ? scene.add.image(0, 0, textureKey)
      : scene.add.text(0, 0, String(entry?.type || "?").charAt(0).toUpperCase(), {
          fontFamily: "Arial",
          fontSize: "18px",
          color: "#ffffff",
        }).setOrigin(0.5);
    if (icon.setDisplaySize) {
      const size = entry?.isCaster ? 30 : 24;
      icon.setDisplaySize(size, size);
    }
    orbit.add([halo, ring, icon]);
    orbit.alpha = 0;
    orbit.setScale(0.2);

    scene.tweens.add({
      targets: orbit,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 180,
      ease: "Back.easeOut",
    });

    scene.tweens.addCounter({
      from: 0,
      to: Math.PI * 3.25,
      duration: entry?.isCaster ? 980 : 860,
      ease: "Sine.easeInOut",
      onUpdate: (tween) => {
        const angle = tween.getValue();
        const next = getSpriteAnchor(sprite);
        const radius = entry?.isCaster ? 42 : 34;
        orbit.x = next.x;
        orbit.y = next.y;
        icon.x = Math.cos(angle) * radius;
        icon.y = Math.sin(angle * 1.3) * (radius * 0.55);
        halo.x = icon.x;
        halo.y = icon.y;
        ring.x = icon.x;
        ring.y = icon.y;
        orbit.rotation = angle * 0.08;
      },
      onComplete: () => {
        const next = getSpriteAnchor(sprite);
        scene.tweens.add({
          targets: [icon, halo, ring],
          x: 0,
          y: 0,
          alpha: { from: 1, to: 0 },
          scaleX: entry?.isCaster ? 1.45 : 1.2,
          scaleY: entry?.isCaster ? 1.45 : 1.2,
          duration: 190,
          ease: "Cubic.easeIn",
          onStart: () => {
            orbit.x = next.x;
            orbit.y = next.y;
          },
          onComplete: () => {
            const impact = scene.add.circle(next.x, next.y, entry?.isCaster ? 22 : 16, tint, 0.75);
            impact.setDepth((sprite.depth || 20) + 6);
            scene.tweens.add({
              targets: impact,
              alpha: 0,
              scaleX: entry?.isCaster ? 3.4 : 2.5,
              scaleY: entry?.isCaster ? 3.4 : 2.5,
              duration: 260,
              ease: "Quad.easeOut",
              onComplete: () => impact.destroy(),
            });
            try {
              scene.sound?.play?.(`pu-touch-${entry.type}`, { volume: 0.28 });
            } catch (_) {}
            orbit.destroy();
          },
        });
      },
    });
  }
}
