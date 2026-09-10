import {
  playSpriteAnimation,
  resolveSpriteAnimationKey,
} from "../shared/animationState.js";

const POWERUP_TINTS = {
  rage: 0xa855f7,
  health: 0x34d399,
  shield: 0xf97316,
  poison: 0xfacc15,
  gravityBoots: 0xef4444,
};
const ARCANE_SURGE_CAST_MS = 2000;
const ARCANE_SURGE_BEAM_MS = 1000;
const BEAM_HIT_MS = 300;
const BEAM_CLEAR_MS = 780;
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

function getHitboxCenter(sprite) {
  const center = sprite?.body?.center;
  return Number.isFinite(center?.x) && Number.isFinite(center?.y)
    ? { x: center.x, y: center.y }
    : getSpriteAnchor(sprite);
}

function destroyMany(items = []) {
  for (const item of items) {
    try {
      item?.destroy?.();
    } catch (_) {}
  }
}

function isBeamTargetAlive(sprite) {
  return !!sprite?.active && sprite.visible !== false && sprite.body?.enable !== false;
}

// Smooth layered light with a sparse pixel fringe matches the sprite art.
function createPowerupBeam(scene, caster, sprite, entry) {
  const graphics = scene.add.graphics();
  graphics.setBlendMode("ADD");
  graphics.setDepth((sprite.depth || 20) + 4);
  const texture = getPowerupTextureKey(scene, entry.type);
  const icon = texture
    ? scene.add.image(0, 0, texture).setDisplaySize(26, 26)
    : scene.add.text(0, 0, String(entry.type || "?").charAt(0).toUpperCase(), {
        fontFamily: "monospace", fontSize: "20px", color: "#ffffff",
      }).setOrigin(0.5);
  icon.setDepth((sprite.depth || 20) + 5);
  icon.setAlpha(0);
  const state = { elapsed: 0 };
  let delivered = false;
  let tween;
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    tween?.stop();
    scene.events?.off("shutdown", cleanup);
    scene.events?.off("update", checkAlive);
    sprite.off?.("destroy", cleanup);
    caster?.off?.("destroy", cleanup);
    destroyMany([graphics, icon]);
  };
  const checkAlive = () => {
    if (!isBeamTargetAlive(sprite) || !isBeamTargetAlive(caster)) cleanup();
  };
  const pixel = (x, y, size, color, alpha) => {
    graphics.fillStyle(color, alpha);
    graphics.fillRect(Math.round(x / 3) * 3 - size / 2,
      Math.round(y / 3) * 3 - size / 2, size, size);
  };
  scene.events?.once("shutdown", cleanup);
  scene.events?.on("update", checkAlive);
  sprite.once?.("destroy", cleanup);
  caster?.once?.("destroy", cleanup);
  tween = scene.tweens.add({
    targets: state,
    elapsed: ARCANE_SURGE_BEAM_MS,
    duration: ARCANE_SURGE_BEAM_MS,
    ease: "Linear",
    onUpdate: () => {
      checkAlive();
      if (disposed) return;
      const ms = state.elapsed;
      const target = getHitboxCenter(sprite);
      const source = getSpriteAnchor(caster);
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / distance;
      const ny = dx / distance;
      const fade = Math.min(1, ms / 80);
      const reach = Math.min(1, ms / BEAM_HIT_MS);
      const tail = Math.max(0, Math.min(1, (ms - BEAM_HIT_MS) / (BEAM_CLEAR_MS - BEAM_HIT_MS)));
      const impact = Math.max(0, Math.min(1, (ms - BEAM_HIT_MS) / (ARCANE_SURGE_BEAM_MS - BEAM_HIT_MS)));
      const pulse = 0.85 + Math.sin(ms / 95) * 0.15;
      graphics.clear();
      const tip = { x: source.x + dx * reach, y: source.y + dy * reach };
      const release = Math.max(0, 1 - ms / 300);
      // Broad translucent bloom, blue body, and a bright white core.
      for (const [width, color, alpha] of [
        [58, 0x249cff, 0.055], [40, 0x38bdf8, 0.10],
        [25, ALLY_GLOW_COLOR, 0.22], [14, 0xb8edff, 0.6],
        [6, 0xffffff, 0.95],
      ]) {
        // Erase from the source forward, with a soft leading edge on the tail.
        const segments = 40;
        for (let i = 0; i < segments; i++) {
          const start = Math.max(tail, i / segments);
          const end = Math.min(reach, (i + 1) / segments);
          if (end <= start) continue;
          const edge = tail > 0 ? Math.min(1, ((start + end) / 2 - tail) / 0.16) : 1;
          graphics.lineStyle(width * (1 + release * 0.4), color, alpha * fade * pulse * edge);
          graphics.lineBetween(source.x + dx * start, source.y + dy * start,
            source.x + dx * end, source.y + dy * end);
        }
      }
      // A hot launch core and expanding shock ring announce the release.
      for (const [radius, alpha] of [[42, 0.08], [26, 0.17], [12, 0.6]]) {
        graphics.fillStyle(0xb8edff, alpha * fade * release);
        graphics.fillCircle(source.x, source.y, radius * (1 + release * 0.5));
        graphics.fillCircle(tip.x, tip.y, radius * 0.7);
      }
      if (release > 0) {
        graphics.lineStyle(3, 0xe0f7ff, release * fade);
        graphics.strokeCircle(source.x, source.y, 12 + (1 - release) * 68);
        for (let i = 0; i < 10; i++) {
          const angle = i * Math.PI / 5;
          const radius = 18 + (1 - release) * 80;
          graphics.lineStyle(2, ALLY_GLOW_COLOR, release * fade);
          graphics.lineBetween(source.x + Math.cos(angle) * radius,
            source.y + Math.sin(angle) * radius,
            source.x + Math.cos(angle) * (radius + 14 * release),
            source.y + Math.sin(angle) * (radius + 14 * release));
        }
      }
      // Streams of detached pixels visibly flow from wizard to teammate.
      for (let i = 0; i < 14; i++) {
        const t = (ms / 760 + i / 14) % 1;
        if (t > reach || t <= tail) continue;
        const spread = Math.sin(i * 2.4 + ms / 180) * (14 + (i % 3) * 5);
        pixel(source.x + dx * t + nx * spread,
          source.y + dy * t + ny * spread, i % 3 === 0 ? 6 : 3,
          i % 2 ? 0xffffff : ALLY_GLOW_COLOR, fade * 0.85 * Math.min(1, (t - tail) / 0.16));
      }
      const travel = reach;
      icon.x = source.x + dx * travel;
      icon.y = source.y + dy * travel;
      icon.setAlpha(fade * Math.max(0, 1 - impact * 5));
      if (ms >= BEAM_HIT_MS) {
        const burstFade = Math.pow(1 - impact, 2);
        const radius = 12 + (1 - Math.pow(1 - impact, 3)) * 66;
        graphics.fillStyle(ALLY_GLOW_COLOR, burstFade * 0.22);
        graphics.fillCircle(target.x, target.y, radius);
        graphics.fillStyle(0xffffff, burstFade * 0.65);
        graphics.fillCircle(target.x, target.y, 18 * (1 - impact));
        graphics.lineStyle(5 * (1 - impact) + 1, 0xe0f7ff, burstFade);
        graphics.strokeCircle(target.x, target.y, radius);
        graphics.lineStyle(2, ALLY_GLOW_COLOR, burstFade * 0.75);
        graphics.strokeCircle(target.x, target.y, radius * 0.72);
        for (let i = 0; i < 12; i++) {
          const angle = i * Math.PI / 6;
          const sparkRadius = radius * (1 + impact * 0.4);
          pixel(target.x + Math.cos(angle) * sparkRadius,
            target.y + Math.sin(angle) * sparkRadius, i % 3 ? 3 : 6,
            i % 3 ? 0xe0f2fe : POWERUP_TINTS[entry.type] || ALLY_GLOW_COLOR,
            burstFade * 0.8);
        }
      }
      if (travel === 1 && !delivered) {
        delivered = true;
        try { scene.sound?.play?.(`pu-touch-${entry.type}`, { volume: 0.28 }); } catch (_) {}
      }
    },
    onComplete: cleanup,
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
    duration: ARCANE_SURGE_CAST_MS,
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
  const specialKey = resolveSpriteAnimationKey({
    scene,
    sprite,
    character: "wizard",
    logical: "special",
    fallback: "throw",
  });
  const idleKey = resolveSpriteAnimationKey({
    scene,
    sprite,
    character: "wizard",
    logical: "idle",
    fallback: "idle",
  });
  if (!specialKey) return;
  sprite._specialAnimLockUntil = Date.now() + ARCANE_SURGE_CAST_MS + 120;
  sprite._specialAnimLockUntilPerf = performance.now() + ARCANE_SURGE_CAST_MS + 120;

  playSpriteAnimation({
    scene,
    sprite,
    character: "wizard",
    logical: "special",
    fallback: "throw",
  });

  scene.time.delayedCall(Math.max(450, ARCANE_SURGE_CAST_MS - 120), () => {
    if (!sprite?.active || !idleKey) return;
    try {
      const current = sprite.anims?.currentAnim?.key || "";
      if (current === specialKey) {
        playSpriteAnimation({
          scene,
          sprite,
          character: "wizard",
          logical: "idle",
          fallback: "idle",
        });
      }
    } catch (_) {}
  });
}

export function playWizardArcaneSurge(scene, payload, resolveSpriteByName) {
  if (!scene?.add || typeof resolveSpriteByName !== "function") return;

  const recipients = Array.isArray(payload?.recipients) ? payload.recipients : [];
  if (!recipients.length) return;

  try {
    scene.sound?.play?.("wizard-special", {
      volume: 0.52,
      rate: 1,
    });
  } catch (_) {}

  const casterSprite = resolveSpriteByName(payload?.caster);
  if (casterSprite?.active) {
    playCasterSpecialAnimation(scene, casterSprite);
    attachWizardAura(scene, casterSprite);
  }

  for (const entry of recipients) {
    const sprite = resolveSpriteByName(entry?.username);
    if (entry?.isCaster || entry?.username === payload?.caster || sprite === casterSprite) continue;
    if (!isBeamTargetAlive(sprite) || !isBeamTargetAlive(casterSprite)) continue;

    createPowerupBeam(scene, casterSprite, sprite, entry);
  }
}
