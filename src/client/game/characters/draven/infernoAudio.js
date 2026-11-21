import { combatSoundVolume, playerSoundVolume, playPlayerSound } from "../../audio/playerAudio";

// Inferno's sound, layered so it answers what the super is doing
// (layers drawn in scripts/art/draven-pixel/inferno-sfx.cjs):
// an ignite hit on cast, the special.mp3 swell and a crackle bed under the
// channel, a thrum with each shock ring, and a release whoosh when it ends.
const SWELL = "draven-special";
const CRACKLE = "draven-inferno-crackle";
const IGNITE = "draven-inferno-ignite";
const PULSE = "draven-inferno-pulse";
const END = "draven-inferno-end";
export const INFERNO_HIT = "draven-inferno-hit";
export const INFERNO_SOUND_KEYS = [CRACKLE, IGNITE, PULSE, END, INFERNO_HIT];

// The overlay art sends out a shock ring every half second (two per loop).
const PULSE_MS = 500;
// Mix within the super, relative to the calibrated combat volumes.
const CRACKLE_MIX = 0.5;
const PULSE_MIX = 0.4;
const HIT_MIX = 0.6;
const STOP_FADE_MS = 180;

// Slows a layer just enough to outlast the channel, so it never runs out
// before the super ends and is always faded out by stop() instead.
const MIN_FIT_RATE = 0.75;
function fitRate(sound, fitMs) {
  const seconds = Number(sound?.duration) || 0;
  if (!fitMs || seconds <= 0) return 1;
  return Math.max(MIN_FIT_RATE, Math.min(1, seconds / ((fitMs + STOP_FADE_MS) / 1000)));
}

function startLoop(scene, player, key, mix, riseMs, fitMs = 0) {
  const sound = scene.sound?.add?.(key, { volume: 0 });
  if (!sound) return null;
  const rate = fitRate(sound, fitMs);
  if (rate !== 1) sound.setRate?.(rate);
  const base = combatSoundVolume(key) * mix;
  const state = { gain: 0 };
  let done = false;
  let fade = null;
  // Stops every callback that touches the sound. Phaser nulls a destroyed
  // sound's config, so a volume write after that throws.
  const release = () => {
    if (done) return false;
    done = true;
    scene.events?.off?.("update", update);
    fade?.remove?.();
    return true;
  };
  const update = () => {
    if (done || !sound.manager) return void release();
    sound.volume = playerSoundVolume(scene, player, base) * state.gain;
  };
  const destroy = () => { if (release()) sound.destroy?.(); };
  fade = scene.tweens?.add?.({ targets: state, gain: 1, duration: riseMs, ease: "Sine.easeInOut", onUpdate: update });
  scene.events?.on?.("update", update);
  sound.once?.("complete", destroy);
  // Destroyed elsewhere (a sound-manager teardown): just stand down.
  sound.once?.("destroy", release);
  if (!sound.play()) destroy();
  return {
    stop(fadeMs) {
      if (done) return;
      fade?.remove?.();
      if (!fadeMs || !scene.tweens?.add) return destroy();
      fade = scene.tweens.add({ targets: state, gain: 0, duration: fadeMs, onUpdate: update, onComplete: destroy });
    },
    destroy,
  };
}

// Returns stop(released): released plays the end whoosh; otherwise (an
// interruption or teardown) the layers just fade out.
export function startInfernoAudio(scene, player, { riseMs, durationMs }) {
  const loops = [];
  let pulses = null;
  try {
    playPlayerSound(scene, player, IGNITE);
    for (const [key, mix] of [[SWELL, 1], [CRACKLE, CRACKLE_MIX]]) {
      const loop = startLoop(scene, player, key, mix, riseMs, durationMs);
      if (loop) loops.push(loop);
    }
    pulses = scene.time?.addEvent?.({
      delay: PULSE_MS,
      loop: true,
      callback: () => {
        if (player?.active) playPlayerSound(scene, player, PULSE, { volume: combatSoundVolume(PULSE) * PULSE_MIX });
      },
    }) || null;
  } catch (_) {}
  let stopped = false;
  const stop = (released = false) => {
    if (stopped) return;
    stopped = true;
    scene.events?.off?.("shutdown", teardown);
    pulses?.remove?.(false);
    for (const loop of loops) loop.stop(STOP_FADE_MS);
    if (released) {
      try { playPlayerSound(scene, player, END); } catch (_) {}
    }
  };
  const teardown = () => {
    stop(false);
    for (const loop of loops) loop.destroy();
  };
  scene.events?.once?.("shutdown", teardown);
  return stop;
}

// Crack and sizzle where an Inferno explosion lands.
export function playInfernoHit(scene, x, y) {
  try {
    playPlayerSound(scene, { x, y }, INFERNO_HIT, { volume: combatSoundVolume(INFERNO_HIT) * HIT_MIX });
  } catch (_) {}
}
