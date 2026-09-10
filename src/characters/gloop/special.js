import { prepareHandAnimation, handPose, HAND_TEXTURE } from "./handAnimation";
import { getResolvedCharacterSpecialConfig } from "../../lib/characterTuning.js";
import { RENDER_LAYERS } from "../../gameScene/renderLayers";
import { playSpriteAnimation } from "../shared/animationState";
import { resolveGloopHookSocket } from "../../shared/gloopHookGeometry";

const NAME = "gloop";
const HOOK = getResolvedCharacterSpecialConfig(NAME, "hook");
const ACTIVE_HOOK_VISUALS = new WeakMap();

function playSpecialAnimation(scene, player) {
  playSpriteAnimation({
    scene,
    sprite: player,
    character: NAME,
    logical: "special",
    fallback: "throw",
  });
}

function resolveAngle(player, specialData = null) {
  if (Number.isFinite(Number(specialData?.angle))) {
    return Number(specialData.angle);
  }
  const direction = Number(specialData?.direction) === -1 ? -1 : 1;
  return direction < 0 || player?.flipX ? Math.PI : 0;
}

function resolveStart(player, angle) {
  // Gloop's artwork sits near the bottom of a mostly transparent 128px frame.
  // Anchor the hook to the visible/physics body instead of the frame center.
  return resolveGloopHookSocket(player, angle);
}

function resolveActionStart(player, specialData = null, angle = 0) {
  const sx = Number(specialData?.start?.x);
  const sy = Number(specialData?.start?.y);
  if (Number.isFinite(sx) && Number.isFinite(sy)) {
    return { x: sx, y: sy };
  }
  return resolveStart(player, angle);
}

function resolveHandTextureKey(scene, variant = "open") {
  const wantClosed = String(variant || "").toLowerCase() === "closed";
  if (wantClosed && scene?.textures?.exists(`${NAME}-hand-closed`)) {
    return `${NAME}-hand-closed`;
  }
  if (!wantClosed && scene?.textures?.exists(`${NAME}-hand-open`)) {
    return `${NAME}-hand-open`;
  }
  if (scene?.textures?.exists(`${NAME}-hand`)) {
    return `${NAME}-hand`;
  }
  return null;
}

function createHand(scene, x, y, angle, scale, variant = "open") {
  const animated = prepareHandAnimation(scene);
  const key = animated ? HAND_TEXTURE : resolveHandTextureKey(scene, variant);
  const hand = key
    ? scene.add.sprite(x, y, key)
    : scene.add.ellipse(x, y, 44, 26, 0x72f0ff, 0.9);
  hand.setDepth(RENDER_LAYERS.ATTACKS + 9);
  hand._gripAnimated = animated;
  if (animated) { hand.setOrigin(0.5, 0.55); hand.setFrame(7); }
  if (hand.setScale) hand.setScale(Math.max(0.05, Number(scale) || 0.28) * (animated ? 318 / 128 : 1));
  if (hand.setRotation) hand.setRotation(angle);
  return hand;
}

// A single update loop owns the arm, hand deformation and bounded liquid debris.
// The wrist follows the rendered caster; projectile travel stays on the server ray.
function createHookVisual(scene, owner, angle, start, id) {
  const hand = createHand(scene, start.x, start.y, angle, Number(HOOK.visualScale) || 0.28);
  const tether = scene.add.graphics().setDepth(RENDER_LAYERS.ATTACKS + 4);
  const fx = scene.add.graphics().setDepth(RENDER_LAYERS.ATTACKS + 5);
  const baseScale = (Number(HOOK.visualScale) || 0.28) * (hand._gripAnimated ? 318 / 128 : 1);
  const visual = { hand, tether, fx, id, phase: "out", age: 0, elapsed: 0,
    start, angle, drops: [], trail: 0, recoil: 0, destroyed: false };
  let previous = { ...start };

  function burst(x, y, count, force) {
    for (let i = 0; i < count && visual.drops.length < 48; i++) {
      const a = angle + Math.PI + (Math.random() - 0.5) * 3;
      const speed = force * (0.4 + Math.random() * 0.6);
      visual.drops.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 30,
        life: 0, duration: 280 + Math.random() * 220, r: 1.5 + Math.random() * 2.5 });
    }
  }
  visual.burst = burst;
  visual.destroy = () => {
    if (visual.destroyed) return;
    visual.destroyed = true;
    scene.events.off("update", update);
    scene.events.off("shutdown", visual.destroy);
    owner.off?.("destroy", visual.destroy);
    hand.destroy(); tether.destroy(); fx.destroy();
    if (ACTIVE_HOOK_VISUALS.get(owner) === visual) ACTIVE_HOOK_VISUALS.delete(owner);
  };
  function finish() {
    visual.phase = "settle"; visual.elapsed = 0;
    hand.setVisible(false); tether.clear();
    burst(hand.x, hand.y, 6, 65);
    // Let a late authoritative catch packet create its pull visual while the
    // miss/catch debris from this visual finishes fading independently.
    if (ACTIVE_HOOK_VISUALS.get(owner) === visual) ACTIVE_HOOK_VISUALS.delete(owner);
  }
  function drawArm(wrist) {
    tether.clear();
    // Terminate inside the wrist flesh, not at the palm center. The flared
    // ribbon overlaps the sprite, so rotation/stretch never opens a seam.
    const facing = hand.rotation || 0;
    const socketBack = hand._gripAnimated ? 128 * 0.25 * hand.scaleX : 22;
    const socket = { x: hand.x - Math.cos(facing) * socketBack,
      y: hand.y - Math.sin(facing) * socketBack };
    const dx = socket.x - wrist.x, dy = socket.y - wrist.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length, ny = dx / length;
    const tension = visual.phase === "catch" ? 0.3 : 1;
    const amplitude = Math.min(16, length * 0.055) * tension;
    const width = Math.max(3, 9 - length * 0.007);
    const points = [];
    for (let i = 0; i <= 32; i++) {
      const t = i / 32, envelope = Math.pow(Math.sin(Math.PI * t), 2);
      const wave = envelope * (Math.sin(t * 9 - visual.age * 0.014) * amplitude
        + Math.sin(t * 17 - visual.age * 0.021) * visual.recoil * 9);
      points.push({ x: wrist.x + dx * t + nx * wave,
        y: wrist.y + dy * t + ny * wave + envelope * Math.min(18, length * 0.04) * tension,
        w: width * (0.7 + 0.3 * Math.pow(Math.abs(2 * t - 1), 3))
          + Math.pow(Math.max(0, (t - 0.66) / 0.34), 2)
          * Math.max(0, (hand._gripAnimated ? 128 * 0.17 * hand.scaleY : 15) - width) });
    }
    // Opaque ink edge and teal/blue flesh match the original hand sprite.
    for (const [size, color, offset] of [[1.12, 0x071c38, 0], [1, 0x1176aa, 0], [0.72, 0x10b6bc, -1]]) {
      tether.fillStyle(color, 1); tether.beginPath();
      points.forEach((p, i) => {
        const x = p.x + nx * p.w * size, y = p.y + ny * p.w * size + offset;
        if (i === 0) tether.moveTo(x, y); else tether.lineTo(x, y);
      });
      for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i]; tether.lineTo(p.x - nx * p.w * size, p.y - ny * p.w * size + offset);
      }
      tether.closePath(); tether.fillPath();
    }
    tether.lineStyle(1.2, 0x92dfc8, 0.65); tether.beginPath();
    points.forEach((p, i) => {
      if (i === 0) tether.moveTo(p.x, p.y - p.w * 0.5);
      else tether.lineTo(p.x, p.y - p.w * 0.5);
    });
    tether.strokePath();
  }
  function update(_time, delta = 16.67) {
    if (!owner.active) { visual.destroy(); return; }
    const ms = Math.min(Math.max(delta, 0), 80), dt = ms / 1000;
    visual.age += ms; visual.elapsed += ms; visual.recoil *= Math.exp(-dt * 10);
    const wrist = resolveStart(owner, visual.angle);
    if (visual.phase === "out") {
      const t = Math.min(1, visual.elapsed / visual.outMs);
      hand.setPosition(start.x + Math.cos(angle) * visual.range * t,
        start.y + Math.sin(angle) * visual.range * t);
      if (t >= 1) {
        // A missed hook dissipates at maximum reach. Only a confirmed catch
        // travels back toward Gloop with its target.
        finish();
      }
    } else if (visual.phase === "return" || visual.phase === "catch") {
      const caught = visual.phase === "catch";
      const t = Math.min(1, visual.elapsed / visual.returnMs);
      const eased = caught ? 1 - Math.pow(1 - t, 3) : t * t * (3 - 2 * t);
      // Catch coordinates describe the projectile contact, never the caster wrist.
      const end = caught ? visual.end : wrist;
      hand.setPosition(visual.returnStart.x + (end.x - visual.returnStart.x) * eased,
        visual.returnStart.y + (end.y - visual.returnStart.y) * eased);
      if (caught && visual.target?.active) {
        // Follow the same rendered victim on both local and remote clients.
        hand.setPosition(visual.target.x + visual.targetOffset.x * (1 - eased),
          visual.target.y + visual.targetOffset.y * (1 - eased));
      }
      if (t >= 1) finish();
    }
    if (visual.phase !== "settle") {
      if (hand._gripAnimated) hand.setFrame(handPose(visual.phase, visual.age, visual.elapsed, visual.returnMs));
      const velocity = Math.hypot(hand.x - previous.x, hand.y - previous.y) / Math.max(dt, 0.001);
      const stretch = Math.min(0.22, velocity / 5000);
      const appear = Math.min(1, visual.age / 75);
      const squash = visual.recoil * Math.sin(visual.elapsed * 0.045) * 0.16;
      hand.setScale(baseScale * (0.65 + appear * 0.35) * (1 + stretch - squash),
        baseScale * (0.65 + appear * 0.35) * (1 - stretch * 0.5 + squash));
      // Keep fingers outward on the pull; only the flexible wrist changes angle.
      const facing = Math.atan2(hand.y - wrist.y, hand.x - wrist.x);
      hand.setRotation(facing + Math.sin(visual.age * 0.018) * 0.025);
      drawArm(wrist);
      visual.trail += ms;
      if (visual.trail >= 45) {
        visual.trail %= 45;
        // Shed liquid from the moving wrist, not unrelated dots at the palm.
        const back = hand._gripAnimated ? 128 * 0.3 * hand.scaleX : 22;
        burst(hand.x - Math.cos(facing) * back, hand.y - Math.sin(facing) * back + 8, 1, 45);
      }
    }
    previous = { x: hand.x, y: hand.y };
    fx.clear();
    for (let i = visual.drops.length - 1; i >= 0; i--) {
      const d = visual.drops[i]; d.life += ms;
      if (d.life >= d.duration) { visual.drops.splice(i, 1); continue; }
      d.vy += 330 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
      const alpha = Math.min(1, (d.duration - d.life) / 140);
      fx.lineStyle(d.r * 1.3, 0x137fa5, alpha);
      fx.lineBetween(d.x - d.vx * 0.025, d.y - d.vy * 0.025, d.x, d.y);
      fx.fillStyle(0x25bcb2, alpha); fx.fillEllipse(d.x, d.y, d.r * 1.6, d.r * 2.2);
      fx.fillStyle(0xa0e4cd, alpha * 0.75); fx.fillRect(d.x - 1, d.y - 1, 1.5, 2);
    }
    if (visual.phase === "settle" && !visual.drops.length) visual.destroy();
  }
  scene.events.on("update", update);
  scene.events.once("shutdown", visual.destroy);
  owner.once?.("destroy", visual.destroy);
  ACTIVE_HOOK_VISUALS.set(owner, visual);
  return visual;
}

export function playHookAction(scene, player, specialData = null, isOwner = false) {
  if (!scene?.add || !player?.active) return;
  const existing = ACTIVE_HOOK_VISUALS.get(player);
  if (specialData?.id && existing?.id === specialData.id) return;
  existing?.destroy();
  const angle = resolveAngle(player, specialData);
  const start = resolveActionStart(player, specialData, angle);
  const visual = createHookVisual(scene, player, angle, start, specialData?.id);
  visual.range = Math.max(1, Number(specialData?.range) || Number(HOOK.range) || 780);
  const speed = Math.max(1, Number(specialData?.speed) || Number(HOOK.speed) || 900);
  visual.outMs = Math.max(1, visual.range / speed * 1000);
  visual.returnMs = Math.max(160, visual.outMs * 0.45);
  visual.burst(start.x, start.y, 5, 90);
  try { scene.sound?.play?.("gloop-special", { volume: isOwner ? 0.68 : 0.38 }); } catch (_) {}
}

export function playHookCatchAction(scene, ownerPlayer, actionData = null, isOwner = false) {
  if (!scene?.add || !ownerPlayer?.active) return;
  const start = { x: Number(actionData?.start?.x), y: Number(actionData?.start?.y) };
  const end = { x: Number(actionData?.end?.x), y: Number(actionData?.end?.y) };
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) return;
  let visual = ACTIVE_HOOK_VISUALS.get(ownerPlayer);
  if (visual?.id && actionData?.id && visual.id !== actionData.id) return;
  if (visual?.phase === "catch" || visual?.phase === "settle") return;
  if (!visual) {
    const angle = Math.atan2(start.y - ownerPlayer.y, start.x - ownerPlayer.x);
    visual = createHookVisual(scene, ownerPlayer, angle, start, actionData?.id);
  }
  visual.phase = "catch"; visual.elapsed = 0; visual.recoil = 1;
  visual.returnStart = start; visual.end = end;
  visual.target = actionData?.target ? scene.children?.list?.find(
    child => child.active && child.username === actionData.target,
  ) : null;
  if (visual.target) visual.targetOffset = {
    x: start.x - visual.target.x, y: start.y - visual.target.y,
  };
  visual.returnMs = Math.max(100, Number(actionData?.pullDurationMs) || 640);
  visual.hand.setPosition(start.x, start.y);
  const closed = resolveHandTextureKey(scene, "closed");
  if (closed && !visual.hand._gripAnimated) visual.hand.setTexture?.(closed);
  visual.burst(start.x, start.y, 14, 170);
  try { scene.sound?.play?.("gloop-pull", { volume: isOwner ? 0.62 : 0.36 }); } catch (_) {}
}

export function perform(
  scene,
  player,
  playersInTeam,
  opponentPlayers,
  username,
  gameId,
  isOwner = false,
  specialData = null,
) {
  if (!scene || !player || !player.active) return;

  const angle = resolveAngle(player, specialData);
  player.flipX = Math.cos(angle) < -0.1;
  player._specialAnimLockUntil = Date.now() + 850;
  playSpecialAnimation(scene, player);

  playHookAction(scene, player, specialData, isOwner);
}
