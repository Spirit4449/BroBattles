import { playPlayerSound, playerSoundVolume } from './playerAudio';
import { getTerrainSteps, footstepVolume, terrainLandingSound } from './movementAudio';
import { MOVEMENT_VFX_CONFIG } from '../effects';
import movementPhysics from '../shared/movementPhysics.json';

const clamp = value => Math.max(0, Math.min(1, value));

// Each remote fighter owns its cadence and loops. Volumes use the local mix
// levels; the shared listener applies distance and spectator attenuation.
export function createRemoteMovementAudio(scene, sprite) {
  let previous = null, sequence = null, lastStep = -Infinity, variant = 0;
  let fallStarted = null, lastUpdate = -Infinity, destroyed = false;
  let motion = null;
  const loops = new Map();
  const now = () => performance.now();
  const play = (key, options) => {
    if (scene.sound?.locked) return;
    try { playPlayerSound(scene, sprite, key, options); } catch (_) {}
  };
  function step(speed, turning, time) {
    const steps = getTerrainSteps(scene._terrainType);
    variant = (variant + 1 + Math.floor(Math.random() * Math.max(1, steps.length - 1))) % steps.length;
    play(steps[variant].key, {
      volume: footstepVolume(speed, turning, scene._terrainType),
      rate: (turning ? 0.88 : 0.94) + speed * 0.14,
    });
    lastStep = time;
  }
  function loop(key, baseVolume, rate) {
    const volume = playerSoundVolume(scene, sprite, baseVolume);
    let sound = loops.get(key);
    if (volume < 0.005 || scene.sound?.locked) {
      if (sound?.isPlaying) sound.stop();
      return;
    }
    try {
      if (!sound) {
        sound = scene.sound?.add(key, { loop: true, volume: 0 });
        if (!sound) return;
        loops.set(key, sound);
      }
      sound.setVolume(volume);
      sound.setRate(rate);
      if (!sound.isPlaying) sound.play({ loop: true, volume, rate });
    } catch (_) {}
  }
  function reset() {
    previous = motion = null;
    sequence = null;
    lastStep = lastUpdate = -Infinity;
    fallStarted = null;
    for (const sound of loops.values()) { sound.stop(); sound.destroy(); }
    loops.clear();
  }
  function tick() {
    if (!motion || destroyed) return;
    const time = now();
    if (!sprite.active || scene._spawnIntroActive ||
        (typeof document !== 'undefined' && document.hidden) || time - lastUpdate > 300) {
      reset();
      return;
    }
    const speed = clamp(motion.vy / movementPhysics.wallSlideMaxFallSpeed);
    loop('sfx-sliding', motion.wall ? 0.28 + speed * 0.17 : 0, 0.84 + speed * 0.22);
    const falling = !motion.grounded && !motion.wall && !motion.dash && motion.vy > 85;
    if (!falling) fallStarted = null;
    else if (fallStarted === null) fallStarted = time;
    const fallSpeed = clamp((motion.vy - 85) / (MOVEMENT_VFX_CONFIG.fastFallMaxVelocity - 85));
    const elapsed = falling ? time - fallStarted : 0;
    const ramp = clamp(elapsed / 220);
    const age = clamp(elapsed / 950);
    loop('sfx-fall-air', falling ? (0.06 + fallSpeed * (0.16 + age * 0.14)) * ramp : 0,
      0.72 + fallSpeed * 0.24 + age * 0.04);
  }
  function update(state, animationState = state) {
    if (destroyed) return;
    if (!state || !sprite.active || scene._spawnIntroActive ||
        (typeof document !== 'undefined' && document.hidden)) { reset(); return; }
    const time = now();
    lastUpdate = time;
    const grounded = !!state.grounded;
    const vx = Number(state.vx) || 0, vy = Number(state.vy) || 0;
    const animation = String(animationState?.animation || '').toLowerCase();
    const dash = /^(dash|dashing)$/.test(animation);
    const wall = !grounded && (typeof state.wallSliding === 'boolean' ? state.wallSliding : animation.includes('wallslid'));
    const speed = clamp(Math.abs(vx) / MOVEMENT_VFX_CONFIG.runSpeedReference);
    const walking = grounded && Math.abs(vx) > 35 && !dash && !/throw|attack|special|dying/.test(animation);
    const y = Number(sprite.body?.bottom) || sprite.y;
    const peak = grounded ? y : Math.min(previous?.grounded === false ? previous.peak : y, y);
    let event = '';
    const seq = state.movementFxSeq;
    if (Number.isSafeInteger(seq) && seq >= 0) {
      if (sequence !== null && seq > sequence) event = state.movementFxType || '';
      sequence = seq;
    } else if (previous) {
      // Older senders lack event IDs: infer one-shot cues from transitions.
      if (previous.wall && !wall && !grounded && Math.abs(vx) > 220) event = 'wall-jump';
      else if (previous.grounded && !grounded && vy < -40 && !dash) event = 'jump';
      else if (!previous.grounded && grounded) event = 'land';
      else if (walking && previous.walking && Math.sign(vx) !== Math.sign(previous.vx)) event = 'turn';
    }
    if (event === 'jump') play('sfx-jump', { volume: 0.36 + speed * 0.1, rate: 0.96 + speed * 0.08 });
    if (event === 'wall-jump') play('sfx-walljump', { volume: 0.5, rate: 0.96 + Math.min(0.08, Math.abs(vx) / 720) });
    if (event === 'land' && previous) {
      const impact = Number(state.movementFxImpactVelocity) || Math.max(previous.vy, vy);
      const distance = Number(state.movementFxFallDistance) || Math.max(0, y - previous.peak);
      const strength = (clamp(impact / MOVEMENT_VFX_CONFIG.landingMaxVelocity) * 0.65 +
        clamp(distance / (MOVEMENT_VFX_CONFIG.landingShockwaveMinFallPx * 2)) * 0.35) ** 2;
      const sound = terrainLandingSound(scene._terrainType, 0.28 + strength * 0.5);
      play(sound.key, { volume: sound.volume, rate: 0.93 - strength * 0.02 });
    }
    if (walking && (event === 'turn' || !previous?.walking || time - lastStep >= 285 - 135 * speed)) {
      step(speed, event === 'turn', time);
    }
    motion = { grounded, wall, dash, vy };
    previous = { grounded, wall, walking, vx, vy, peak };
  }
  function destroy() {
    if (destroyed) return;
    reset();
    destroyed = true;
    scene.events?.off('postupdate', tick);
    scene.events?.off('shutdown', destroy);
    scene.events?.off('presentation:reset', reset);
    sprite.off?.('destroy', destroy);
  }
  scene.events?.on('postupdate', tick);
  scene.events?.once('shutdown', destroy);
  scene.events?.on('presentation:reset', reset);
  sprite.once?.('destroy', destroy);
  return { update, reset, destroy };
}
