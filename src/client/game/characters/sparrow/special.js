// Sparrow's super, Seraph, on screen. The tap starts it (the server's
// player:special): she rises on angel wings inside an angelic shield and hovers
// with her bow drawn for the aim phase. Her light shows where she aims; she
// faces her default direction until her owner steers the bow. Releasing (or the
// server, when time runs out) looses the light bolt: radiance, an explosion of
// light at the bow, feathers, then she falls. The server owns the aim phase and
// the bolt (sparrowSeraphAbility.js); this module only presents them.
import { characterDefinitions } from "../../../../shared/characters/index.js";
import { SERAPH, facingAngle, createBolt, boltOrigin } from "../../../../shared/characters/sparrowLightBolt.js";
import { playSpriteAnimation } from "../shared/animationState.js";
import { playPlayerSound, combatSoundVolume, playerSoundVolume } from "../../audio/playerAudio";
import { createRuntimeId } from "../shared/runtimeId";
import { SERAPH_FLUTTER_FPS, seraphAimPose, seraphPoseAngle } from "../../../../shared/characters/sparrowSeraphAim.js";
import { createSeraphShield, createAimRay, createSeraphChargeLights, playSeraphRelease, launchSeraphBolt } from "./seraphFx";
import { playerAnchor } from "../shared/rig.js";

const { key: NAME } = characterDefinitions.sparrow;
export const SERAPH_AIM_SOUND = "sparrow-seraph-aim";
export const SERAPH_RELEASE_SOUND = "sparrow-seraph-release";
// Presentations end on the bolt; this only cleans up a lost packet.
const RELEASE_TIMEOUT_PAD_MS = 1500;
const AIM_SOUND_RISE_MS = 240;
const AIM_SOUND_FADE_MS = 160;
const AIM_SOUND_FINAL_GAIN = 0.14;

export function isSeraphAiming(player, now = Date.now()) {
  const state = player?._seraph;
  return !!state && now < state.until;
}

function bowPoint(player, angle) {
  return boltOrigin({ x: player.x, y: player.y, flip: !!player.flipX }, angle);
}

// Keeps the wing flutter's phase when the aim direction changes.
function showAimPose(scene, player, logical, elapsed) {
  const previousKey = player.anims?.currentAnim?.key;
  const key = playSpriteAnimation({ scene, sprite: player, character: NAME, logical });
  if (!key || key === previousKey) return;
  const frames = scene.anims?.get?.(key)?.frames;
  if (!frames?.length) return;
  const phase = Math.floor(elapsed * SERAPH_FLUTTER_FPS / 1000);
  player.anims.setCurrentFrame?.(frames[phase % frames.length]);
}

function startAimSound(scene) {
  const sound = scene.sound?.add?.(SERAPH_AIM_SOUND, { volume: 0 });
  if (!sound) return null;
  try { sound.play(); } catch (_) { sound.destroy(); return null; }
  return sound;
}

function stopAimSound(scene, sound, fade) {
  if (!sound) return;
  const stop = () => { sound.stop(); sound.destroy(); };
  if (fade && scene.tweens) {
    scene.tweens.add({ targets: sound, volume: 0, duration: AIM_SOUND_FADE_MS, onComplete: stop });
  } else {
    stop();
  }
}

function endSeraph(scene, player, { fall = true } = {}) {
  const state = player?._seraph;
  if (!state) return;
  delete player._seraph;
  scene.events?.off("update", state.update);
  scene.events?.off("shutdown", state.cleanup);
  player.off?.("combat:reset", state.cleanup);
  player.off?.("destroy", state.cleanup);
  state.shield?.destroy();
  state.ray?.destroy();
  state.chargeLights?.destroy();
  stopAimSound(scene, state.sound, fall);
  player._sparrowSeraphUntil = 0;
  if (state.isOwner) {
    player._movementLockedUntil = 0;
    player._abilityKeepsMomentum = false;
    player._lockFlip = false;
    delete player._lockedFlipX;
    if (player.body) {
      player.body.allowGravity = true;
      if (fall) player.setVelocityY?.(Math.max(player.body.velocity.y, 60));
    }
  }
}

export function getSeraphAim(player) {
  const state = player?._seraph;
  return state ? state.angle ?? facingAngle(state.facingLeft) : null;
}

export function setSeraphAim(player, angle) {
  if (isSeraphAiming(player) && Number.isFinite(angle)) player._seraph.angle = angle;
}

// One frame of the hover, for every viewer.
function updateSeraph(scene, player, state) {
  if (!player.active) { endSeraph(scene, player, { fall: false }); return; }
  const now = Date.now();
  if (now > state.until + SERAPH.releaseGraceMs + RELEASE_TIMEOUT_PAD_MS) {
    endSeraph(scene, player);
    return;
  }
  const elapsed = now - state.startedAt;
  const rising = elapsed < SERAPH.riseMs;
  let angle;
  if (state.isOwner) {
    angle = getSeraphAim(player);
    const pose = seraphAimPose(angle, state.facingLeft);
    state.facingLeft = pose.flipX;
    player._lockFlip = true;
    player._lockedFlipX = pose.flipX;
    if (!rising) showAimPose(scene, player, pose.direction.logical, elapsed - SERAPH.riseMs);
  } else {
    // Another player's aim arrives as their pose: its direction and facing.
    angle = seraphPoseAngle(player.anims?.currentAnim?.key, player.flipX) ?? facingAngle(player.flipX);
    state.angle = state.angle == null ? angle : state.angle + Math.atan2(Math.sin(angle - state.angle), Math.cos(angle - state.angle)) * 0.35;
    angle = state.angle;
  }
  const bow = bowPoint(player, angle);
  state.ray?.update(bow.x, bow.y, angle, { visible: now < state.until && elapsed > SERAPH.riseMs * 0.6 });
  // Centred on her body core, like the powerup bubbles.
  const core = playerAnchor(player, "core") || player;
  state.shield?.sync(core.x, core.y, elapsed);
  state.chargeLights?.sync(core.x, core.y, elapsed);
  if (state.sound) {
    const level = Math.min(1, elapsed / AIM_SOUND_RISE_MS);
    const progress = Math.min(1, elapsed / SERAPH.aimMs);
    const late = Math.max(0, (progress - 0.7) / 0.3);
    state.sound.volume = playerSoundVolume(scene, player,
      combatSoundVolume(SERAPH_AIM_SOUND) * level * (1 + AIM_SOUND_FINAL_GAIN * late ** 2));
  }
}

/** Owner-side hover, once per frame from the local movement loop. */
export function updateSeraphHover(scene, player, now = Date.now()) {
  const state = player?._seraph;
  if (!state?.isOwner || !player.body) return;
  // A pull or other external control owns her body meanwhile.
  if ((player._externalControlLockUntil || 0) > now) return;
  const elapsed = now - state.startedAt;
  const ease = (t) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
  const lift = SERAPH.liftPx * ease(elapsed / SERAPH.riseMs) + Math.sin(elapsed / SERAPH.bobWaveMs) * SERAPH.bobPx;
  // The rise and bob move her directly; knockback keeps its velocity and drains.
  player.y -= lift - (state.lift || 0);
  state.lift = lift;
  const dt = Math.min(0.1, Math.max(0, (now - (state.lastHoverAt || now)) / 1000));
  state.lastHoverAt = now;
  const drag = Math.exp(-SERAPH.hoverDragPerSec * dt);
  player.body.allowGravity = false;
  player.setVelocity?.(player.body.velocity.x * drag, player.body.velocity.y * drag);
}

export function perform({ scene, player, isOwner = false }) {
  if (!scene || !player || !player.active) return;
  endSeraph(scene, player, { fall: false });
  const now = Date.now();
  const state = {
    isOwner, startedAt: now, until: now + SERAPH.aimMs,
    facingLeft: !!player.flipX, angle: null, lift: 0, lastHoverAt: now,
  };
  player._seraph = state;
  // The super bar drains over the aim phase (superBarRenderer.js).
  player._sparrowSeraphStartedAt = now;
  player._sparrowSeraphUntil = state.until;
  if (isOwner) {
    player._movementLockedUntil = state.until + SERAPH.releaseGraceMs;
    player._abilityKeepsMomentum = true;
    if (player.body) { player.body.allowGravity = false; player.setVelocity?.(0, 0); }
  }
  playSpriteAnimation({ scene, sprite: player, character: NAME, logical: "special", restart: true,
    holdMs: SERAPH.riseMs, remote: !isOwner });
  state.sound = startAimSound(scene);
  state.shield = createSeraphShield(scene, player);
  state.ray = createAimRay(scene);
  state.chargeLights = createSeraphChargeLights(scene);
  state.update = () => { if (player._seraph === state) updateSeraph(scene, player, state); };
  scene.events?.on("update", state.update);
  state.cleanup = () => { if (player._seraph === state) endSeraph(scene, player, { fall: false }); };
  player.once?.("combat:reset", state.cleanup);
  player.once?.("destroy", state.cleanup);
  scene.events?.once("shutdown", state.cleanup);
}

/**
 * The bolt flies: present the release on `player` and the bolt's flight.
 * `bolt` is the flight (the server's, or the owner's prediction).
 */
export function presentSeraphRelease(scene, player, bolt, { ageMs = 0 } = {}) {
  if (!scene || !bolt) return;
  const angle = Math.atan2(bolt.vy, bolt.vx);
  if (player?._seraph) {
    if (player._seraph.isOwner) {
      const pose = seraphAimPose(angle, player.flipX);
      player.flipX = pose.flipX;
      player._lockedFlipX = pose.flipX;
      // Hold the release pose a moment before she drops.
      playSpriteAnimation({ scene, sprite: player, character: NAME, logical: pose.direction.logical, holdMs: 260 });
    }
    endSeraph(scene, player);
  }
  if (player) {
    const core = playerAnchor(player, "core") || player;
    playSeraphRelease(scene, { x: core.x, y: core.y, bowX: bolt.x, bowY: bolt.y, facing: Math.cos(angle) < 0 ? -1 : 1 });
    try { playPlayerSound(scene, player, SERAPH_RELEASE_SOUND); } catch (_) {}
  }
  launchSeraphBolt(scene, bolt, { ageMs });
}

/** The owner's release: predicts the bolt and returns the request. */
export function releaseSeraph(scene, player, angle = getSeraphAim(player)) {
  const state = player?._seraph;
  if (!state?.isOwner || !isSeraphAiming(player)) return null;
  const id = createRuntimeId("sparrowBolt");
  const bolt = createBolt({ x: player.x, y: player.y, flip: state.facingLeft }, angle, id, 0);
  player._seraphPredictedRequestId = id;
  presentSeraphRelease(scene, player, bolt);
  return { type: "sparrow-light-bolt", id, angle };
}
