import { thorgGripPose } from "./weaponMotion";
import { THORG_SWEEP, sampleThorgSweep } from "../../shared/thorgSweep";
import { playSpriteAnimation, markOneShotAnimation } from "../shared/animationState";
import { lockPlayerFlip, enforceLockedFlip } from "../shared/flipLock";

// A single held mace is used during locomotion, windup and the entire sweep.
export function ensureThorgWeapon(scene, body) {
  if (body._thorgWeapon?.active) return body._thorgWeapon;
  const skin = body._bbSkinTextureKey || body.texture?.key;
  const key = scene.textures.exists(`${skin}-weapon`) ? `${skin}-weapon` : "thorg-weapon";
  if (!scene.textures.exists(key)) return null;
  const weapon = scene.add.image(body.x, body.y, key).setOrigin(0.5, 0.12);
  weapon.setDisplaySize(26, 26 * 101 / 36);
  body._thorgWeapon = weapon;
  const spin = key === "thorg-weapon" && scene.textures.exists("thorg-weapon-spin");
  let spinElapsed = 0;
  if (spin) weapon.setTexture("thorg-weapon-spin", 0);
  // Re-render the fingers above the handle, while the palm remains behind it.
  const fingers = scene.add.image(body.x, body.y, body.texture.key, body.frame.name);
  const support = scene.add.image(body.x, body.y, body.texture.key, body.frame.name);
  const pose = (_time, delta) => {
    if (!body.active || !weapon.active) return;
    const legacySkin = /thorg-(storm|iron)/.test(String(body._bbSkinTextureKey || body.texture?.key));
    weapon.setVisible(body.visible && (!legacySkin || body._thorgSweepActive) && !String(body.frame?.name).startsWith("dying"));
    weapon.setAlpha(body.alpha);
    // Axial roll changes the head artwork without moving the held grip or
    // competing with the sweep's world-space rotation. Eight frames at 8 fps.
    if (spin && weapon.visible) {
      spinElapsed = (spinElapsed + Math.max(0, Number(delta) || 0)) % 1000;
      weapon.setTexture("thorg-weapon-spin", Math.floor(spinElapsed / 125));
    }
    const scale = body._thorgVisualScale || 1;
    fingers.setVisible(false);
    support.setVisible(false);
    if (body._thorgSweepActive) return;
    weapon.setDisplaySize((legacySkin ? 30 : 26) * scale, (legacySkin ? 71 : 26 * 101 / 36) * scale);
    const grip = thorgGripPose(body, Number(delta) || 16);
    const direction = body.flipX ? -1 : 1;
    weapon.setPosition(body.x + direction * grip.x * scale, body.y - 37.8 * (scale - 1) + (grip.y - (String(body.frame?.name).startsWith("sliding") ? 7 : 0)) * scale);
    weapon.rotation = direction * grip.angle;
    // Draw the carried weapon over the torso so the grip reads as held.
    weapon.setDepth((body.depth ?? 30) + 0.1);
    if (!legacySkin && weapon.visible && !String(body.frame?.name).startsWith("idle")) {
      const x = Math.round(grip.x / 0.7 + 64);
      const y = Math.round(grip.y / 0.7 + 64);
      const drawHand = (image, cx, cy, width, height) => {
        image.setTexture(body.texture.key, body.frame.name);
        image.setOrigin(0.5).setDisplaySize(89.6 * scale, 89.6 * scale);
        image.setPosition(body.x, body.y - 37.8 * (scale - 1));
        image.setFlipX(body.flipX).setCrop(cx - width / 2, cy - height / 2, width, height);
        image.setDepth((body.depth ?? 30) + 0.2).setAlpha(body.alpha).setVisible(true);
        if (body.isTinted) image.setTint(body.tintTopLeft); else image.clearTint();
      };
      drawHand(fingers, x, y, 7, 8);
    }
  };
  const cleanup = () => {
    scene.events.off("postupdate", pose);
    scene.events.off("shutdown", cleanup);
    body.off?.("destroy", cleanup);
    body._thorgAttackCleanup?.();
    weapon.destroy();
    fingers.destroy();
    support.destroy();
    delete body._thorgWeapon;
  };
  scene.events.on("postupdate", pose);
  scene.events.once("shutdown", cleanup);
  body.once?.("destroy", cleanup);
  pose();
  return weapon;
}

export function startThorgSweep(scene, body, { direction = body.flipX ? -1 : 1 } = {}) {
  body._thorgAttackCleanup?.();
  const weapon = ensureThorgWeapon(scene, body);
  if (!weapon) return null;
  body.flipX = direction < 0;
  const unlock = lockPlayerFlip(body);
  // Keep recovery tied to the carry grip, not the moving throw-frame hands.
  const carryGrip = { ...thorgGripPose(body, 0) };
  body._thorgSweepActive = true;
  playSpriteAnimation({ scene, sprite: body, character: "thorg", logical: "throw", fallback: "idle" });
  const strikeEnd = THORG_SWEEP.windupMs + THORG_SWEEP.strikeMs;
  const duration = strikeEnd + 100;
  markOneShotAnimation(body, "throw", duration);
  // Match the body animation clock to the same sweep clock, including skins.
  const animDuration = Number(body.anims?.currentAnim?.duration);
  if (body.anims && animDuration > 0) body.anims.timeScale = animDuration / duration;
  const startPose = { x: weapon.x - body.x, y: weapon.y - body.y, angle: weapon.rotation };
  const trail = scene.add.graphics().setDepth((body.depth || 30) + 0.2);
  const rearTrail = scene.add.graphics().setDepth((body.depth || 30) - 0.2);
  const samples = [];
  let swingSound;
  try {
    swingSound = scene.sound?.add(scene.cache?.audio?.exists("thorg-sweep") ? "thorg-sweep" : "thorg-throw");
    swingSound?.play({ volume: 0.48 });
  } catch (_) {}
  let elapsed = 0;
  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    scene.events.off("update", update);
    scene.events.off("presentation:reset", cleanup);
    trail.destroy();
    rearTrail.destroy();
    swingSound?.stop();
    swingSound?.destroy();
    body._thorgSweepActive = false;
    delete body._thorgAttackCleanup;
    unlock();
    if (body.anims) { body.anims.timeScale = 1; body.anims.resume?.(); }
    if (body.active) body.setAngle(0);
  };
  const update = (_time, delta) => {
    if (!body.active || !weapon.active) { cleanup(); return; }
    elapsed += Number(delta) || scene.game?.loop?.delta || 16;
    enforceLockedFlip(body);
    const scale = body._thorgVisualScale || 1;
    const centerY = body.y - 37.8 * (scale - 1);
    const legacySkin = /thorg-(storm|iron)/.test(String(body._bbSkinTextureKey || body.texture?.key));
    weapon.setDisplaySize((legacySkin ? 30 : 26) * scale, (legacySkin ? 71 : 26 * 101 / 36) * scale);
    const handRadius = legacySkin ? 24 : 35;
    const handY = legacySkin ? 13 : 8;
    const grip = carryGrip;
    const windup = Math.min(1, elapsed / THORG_SWEEP.windupMs);
    if (elapsed < THORG_SWEEP.windupMs) {
      const ease = windup * windup * (3 - 2 * windup);
      weapon.setPosition(body.x + startPose.x + (direction * handRadius * scale - startPose.x) * ease,
        body.y + startPose.y + (centerY - body.y + handY * scale - startPose.y) * ease);
      const targetAngle = -direction * Math.PI / 2;
      const angleDelta = Math.atan2(Math.sin(targetAngle - startPose.angle), Math.cos(targetAngle - startPose.angle));
      weapon.rotation = startPose.angle + angleDelta * ease;
      weapon.setDepth((body.depth ?? 30) + 0.1);
    } else {
      const t = Math.min(1, (elapsed - THORG_SWEEP.windupMs) / THORG_SWEEP.strikeMs);
      const head = sampleThorgSweep({ x: body.x, y: body.y, direction, scale }, t);
      if (!legacySkin && body.setFrame) {
        const phase = t - Math.sin(2 * Math.PI * t) / (2 * Math.PI);
        const index = phase < 0.12 ? 0 : phase < 0.38 ? 1 : phase < 0.6 ? 2 : phase < 0.88 ? 3 : 4;
        body.anims?.pause?.();
        body.setFrame(`throw0${index}`);
      }
      if (legacySkin) {
        weapon.rotation = head.rotation;
        weapon.setPosition(head.x - Math.cos(head.rotation + Math.PI / 2) * 51 * scale,
          head.y - Math.sin(head.rotation + Math.PI / 2) * 51 * scale);
      } else {
        // Keep the rigid mace head on the continuous waist-level ellipse.
        weapon.setDisplaySize(26 * scale, 26 * 101 / 36 * scale);
        weapon.rotation = head.rotation;
        const headOffset = weapon.displayHeight / 71 * 39.5;
        weapon.setPosition(head.x - Math.cos(weapon.rotation + Math.PI / 2) * headOffset,
          head.y - Math.sin(weapon.rotation + Math.PI / 2) * headOffset);
      }
      weapon.setDepth((body.depth || 30) + (head.behind ? -0.1 : 0.1));
      if (elapsed <= strikeEnd) samples.push({ x: head.x - body.x, y: head.y - body.y, age: elapsed });
      while (samples.length && elapsed - samples[0].age > 115) samples.shift();
      trail.clear();
      rearTrail.clear();
      trail.setVisible(body.visible).setAlpha(body.alpha);
      rearTrail.setVisible(body.visible).setAlpha(body.alpha);
      trail.setDepth((body.depth ?? 30) + 0.2);
      rearTrail.setDepth((body.depth ?? 30) - 0.2);
      const color = scale > 1 ? 0xd9b7ff : 0xd5eeff;
      const seamY = centerY - body.y + THORG_SWEEP.centerY * scale;
      const drawSegment = (a, b, fade) => {
        const layer = (a.y + b.y) / 2 < seamY ? rearTrail : trail;
        layer.lineStyle(9 * scale, color, fade * 0.12);
        layer.lineBetween(body.x+a.x, body.y+a.y, body.x+b.x, body.y+b.y);
        layer.lineStyle(2 * scale, 0xf1fbff, fade * 0.7);
        layer.lineBetween(body.x+a.x, body.y+a.y, body.x+b.x, body.y+b.y);
      };
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i-1], b = samples[i];
        const fade = Math.max(0, 1 - (elapsed - b.age) / 115);
        // Split at the body's depth plane, including a trail spanning both halves.
        if ((a.y < seamY) !== (b.y < seamY)) {
          const t = (seamY - a.y) / (b.y - a.y);
          const crossing = { x: a.x + (b.x - a.x) * t, y: seamY };
          drawSegment(a, crossing, fade);
          drawSegment(crossing, b, fade);
        } else drawSegment(a, b, fade);
      }
      if (elapsed > strikeEnd) {
        const recovery = Math.min(1, (elapsed - strikeEnd) / 100);
        const ease = recovery * recovery * (3 - 2 * recovery);
        weapon.setDisplaySize((legacySkin ? 30 : 26) * scale, (legacySkin ? 71 : 26 * 101 / 36) * scale);
        weapon.setPosition(body.x + direction * (handRadius + (grip.x - handRadius) * ease) * scale,
          centerY + (handY + (grip.y - handY) * ease) * scale);
        weapon.rotation = direction * (-Math.PI / 2 + (grip.angle + Math.PI / 2) * ease);
      }
    }
    // Small visual grip adjustment, eased into windup and out of recovery.
    // Pull toward the torso on either side without changing weapon proportions.
    const gripBlend = elapsed < THORG_SWEEP.windupMs
      ? Math.min(1, elapsed / THORG_SWEEP.windupMs)
      : Math.max(0, 1 - Math.max(0, elapsed - strikeEnd) / 100);
    weapon.setPosition(body.x + (weapon.x - body.x) * (1 - 0.1 * gripBlend),
      weapon.y - 3 * scale * gripBlend);
    if (elapsed >= duration) cleanup();
  };
  body._thorgAttackCleanup = cleanup;
  scene.events.on("update", update);
  scene.events.once("presentation:reset", cleanup);
  return weapon;
}
