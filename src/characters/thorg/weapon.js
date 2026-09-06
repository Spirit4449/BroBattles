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
  weapon.setDisplaySize(30, 71);
  body._thorgWeapon = weapon;
  const pose = (_time, delta) => {
    if (!body.active || !weapon.active) return;
    const legacySkin = /thorg-(storm|iron)/.test(String(body._bbSkinTextureKey || body.texture?.key));
    weapon.setVisible(body.visible && (!legacySkin || body._thorgSweepActive) && !String(body.frame?.name).startsWith("dying"));
    weapon.setAlpha(body.alpha);
    const scale = body._thorgVisualScale || 1;
    weapon.setDisplaySize(30 * scale, 71 * scale);
    if (body._thorgSweepActive) return;
    const grip = thorgGripPose(body, Number(delta) || 16);
    const direction = body.flipX ? -1 : 1;
    weapon.setPosition(body.x + direction * grip.x * scale, body.y - 37.8 * (scale - 1) + grip.y * scale);
    weapon.rotation = direction * grip.angle;
    // Draw the carried weapon over the torso so the grip reads as held.
    weapon.setDepth((body.depth ?? 30) + 0.1);
  };
  const cleanup = () => {
    scene.events.off("postupdate", pose);
    scene.events.off("shutdown", cleanup);
    body.off?.("destroy", cleanup);
    body._thorgAttackCleanup?.();
    weapon.destroy();
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
    trail.destroy();
    swingSound?.stop();
    swingSound?.destroy();
    body._thorgSweepActive = false;
    delete body._thorgAttackCleanup;
    unlock();
    if (body.anims) body.anims.timeScale = 1;
    if (body.active) body.setAngle(0);
  };
  const update = (_time, delta) => {
    if (!body.active || !weapon.active) { cleanup(); return; }
    elapsed += Number(delta) || scene.game?.loop?.delta || 16;
    enforceLockedFlip(body);
    const scale = body._thorgVisualScale || 1;
    const centerY = body.y - 37.8 * (scale - 1);
    weapon.setDisplaySize(30 * scale, 71 * scale);
    const grip = carryGrip;
    const windup = Math.min(1, elapsed / THORG_SWEEP.windupMs);
    if (elapsed < THORG_SWEEP.windupMs) {
      const ease = windup * windup * (3 - 2 * windup);
      weapon.setPosition(body.x + startPose.x + (direction * 24 * scale - startPose.x) * ease,
        body.y + startPose.y + (centerY - body.y + 13 * scale - startPose.y) * ease);
      const targetAngle = -direction * Math.PI / 2;
      const angleDelta = Math.atan2(Math.sin(targetAngle - startPose.angle), Math.cos(targetAngle - startPose.angle));
      weapon.rotation = startPose.angle + angleDelta * ease;
    } else {
      const t = Math.min(1, (elapsed - THORG_SWEEP.windupMs) / THORG_SWEEP.strikeMs);
      const head = sampleThorgSweep({ x: body.x, y: body.y, direction, scale }, t);
      // Place the handle along the same radial line; artwork's head is ~51px from pivot.
      weapon.rotation = head.rotation;
      weapon.setPosition(head.x - Math.cos(head.rotation + Math.PI / 2) * 51 * scale,
        head.y - Math.sin(head.rotation + Math.PI / 2) * 51 * scale);
      weapon.setDepth((body.depth || 30) + (head.behind ? -0.1 : 0.1));
      if (elapsed <= strikeEnd) samples.push({ x: head.x - body.x, y: head.y - body.y, age: elapsed });
      while (samples.length && elapsed - samples[0].age > 115) samples.shift();
      trail.clear();
      trail.setVisible(body.visible).setAlpha(body.alpha);
      const color = scale > 1 ? 0xd9b7ff : 0xd5eeff;
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i-1], b = samples[i];
        const fade = Math.max(0, 1 - (elapsed - b.age) / 115);
        trail.lineStyle(9 * scale, color, fade * 0.12);
        trail.lineBetween(body.x+a.x, body.y+a.y, body.x+b.x, body.y+b.y);
        trail.lineStyle(2 * scale, 0xf1fbff, fade * 0.7);
        trail.lineBetween(body.x+a.x, body.y+a.y-3*scale, body.x+b.x, body.y+b.y-3*scale);
      }
      if (elapsed > strikeEnd) {
        const recovery = Math.min(1, (elapsed - strikeEnd) / 100);
        const ease = recovery * recovery * (3 - 2 * recovery);
        weapon.setPosition(body.x + direction * (24 + (grip.x - 24) * ease) * scale,
          centerY + (13 + (grip.y - 13) * ease) * scale);
        weapon.rotation = direction * (-Math.PI / 2 + (grip.angle + Math.PI / 2) * ease);
      }
    }
    if (elapsed >= duration) cleanup();
  };
  body._thorgAttackCleanup = cleanup;
  scene.events.on("update", update);
  return weapon;
}
