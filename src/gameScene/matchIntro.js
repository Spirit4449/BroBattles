// gameScene/matchIntro.js
//
// The pregame: when this client's loading screen lifts, pregame.mp3 plays and
// the camera holds on the enemy side, then glides to the local player
// (see pregameFlythrough.js). Afterwards the arena holds silently until the
// server starts the countdown. A countdown or live game arriving early cuts
// the shot short with a quick blend instead of a jump.
import { PREGAME_MS } from "../shared/matchIntroTiming";
import { bindMusicEnvelope } from "../lib/musicEnvelope";
import { restingCameraFrame } from "./cameraDynamics";
import {
  blendFraming,
  clampCenter,
  planFlythrough,
  sampleFlythrough,
} from "./pregameFlythrough";

const PREGAME_AUDIO_SRC = "/assets/pregame.mp3";
const PREGAME_AUDIO_VOLUME = 0.55;
const AUDIO_FADE_OUT_MS = 450;
const CUT_SHORT_BLEND_MS = 650;
// Lerp values the gameplay camera follows with (see initializeGameWorld).
export const FOLLOW_LERP = { x: 0.08, y: 0.05 };

function cameraBounds(cam, scene) {
  const b = cam.useBounds && cam._bounds?.width > 0 ? cam._bounds : scene.physics?.world?.bounds;
  return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
}

function spritePosition(sprite) {
  const x = Number(sprite?.x);
  const y = Number(sprite?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function centroid(points) {
  if (!points.length) return null;
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * @param {object} deps
 * @param {() => object|null} deps.getScene
 * @param {() => object|null} deps.getPlayer local player sprite
 * @param {() => object[]} deps.getEnemySprites
 * @param {(active: boolean) => void} deps.onActiveChange
 */
export function createMatchIntro({ getScene, getPlayer, getEnemySprites, onActiveChange }) {
  // Start downloading before the loading screen lifts.
  const audio = typeof Audio === "function" ? new Audio(PREGAME_AUDIO_SRC) : null;
  if (audio) audio.preload = "auto";
  let envelope = null;
  let audioStopTimer = null;
  let pregameTimer = null;
  let state = "idle"; // idle -> pregame -> holding -> done
  let shot = null; // { plan, bounds, view, startedAt, blend? }

  function restFraming(player, bounds, view) {
    const rest = restingCameraFrame(player.y);
    return {
      ...clampCenter(bounds, view, rest.zoom, player.x, player.y - rest.followOffsetY),
      zoom: rest.zoom,
      followOffsetY: rest.followOffsetY,
    };
  }

  function playAudio() {
    if (!audio) return;
    try {
      envelope?.dispose();
      clearTimeout(audioStopTimer);
      audio.currentTime = 0;
      envelope = bindMusicEnvelope(audio, PREGAME_AUDIO_VOLUME, 1, 120);
      audio.play()?.catch(() => {});
    } catch (_) {}
  }

  function stopAudio() {
    if (!audio || !envelope) return;
    envelope.fade(0, AUDIO_FADE_OUT_MS);
    const retiring = envelope;
    envelope = null;
    clearTimeout(audioStopTimer);
    audioStopTimer = setTimeout(() => {
      retiring.dispose();
      try { audio.pause(); } catch (_) {}
    }, AUDIO_FADE_OUT_MS + 50);
  }

  function startShot(scene, player) {
    const cam = scene.cameras?.main;
    const bounds = cam && cameraBounds(cam, scene);
    if (!bounds || prefersReducedMotion()) return null;
    const view = { width: cam.width, height: cam.height };
    const final = restFraming(player, bounds, view);
    const enemies = (getEnemySprites?.() || []).map(spritePosition).filter(Boolean);
    const plan = planFlythrough({ bounds, view, enemy: centroid(enemies), final });
    cam.stopFollow();
    return { plan, bounds, view, startedAt: performance.now() };
  }

  // Hand the camera back exactly where the follow camera would rest.
  function releaseCamera(scene, player) {
    const cam = scene?.cameras?.main;
    shot = null;
    if (!cam || !player?.active) return;
    const bounds = cameraBounds(cam, scene);
    if (!bounds) return;
    const rest = restFraming(player, bounds, { width: cam.width, height: cam.height });
    cam.setZoom(rest.zoom);
    // startFollow resets the follow offset unless given one; passing it keeps
    // the snap identical to the shot's final frame.
    cam.startFollow(player, false, FOLLOW_LERP.x, FOLLOW_LERP.y, 0, rest.followOffsetY);
  }

  /** The loading screen lifted on a match that has not started yet. */
  function beginPregame() {
    if (state !== "idle") return;
    const scene = getScene();
    const player = getPlayer();
    if (!scene || !player) return;
    state = "pregame";
    onActiveChange?.(true);
    playAudio();
    shot = startShot(scene, player);
    // Wall time, not the scene clock, which pauses in background tabs. The
    // camera releases itself when its shot completes (see updateCamera).
    pregameTimer = setTimeout(() => {
      if (state === "pregame") state = "holding";
    }, PREGAME_MS);
  }

  /** The countdown or the live game began: end the pregame gracefully. */
  function conclude() {
    if (state === "done") return;
    const wasActive = state !== "idle";
    state = "done";
    clearTimeout(pregameTimer);
    stopAudio();
    const cam = getScene()?.cameras?.main;
    if (shot && !shot.blend && cam) {
      shot.blend = {
        from: { x: cam.midPoint.x, y: cam.midPoint.y, zoom: cam.zoom },
        startedAt: performance.now(),
      };
    }
    if (wasActive) onActiveChange?.(false);
  }

  /** Drive the camera for this frame. Returns true while the intro owns it. */
  function updateCamera() {
    if (!shot) return false;
    const scene = getScene();
    const player = getPlayer();
    const cam = scene?.cameras?.main;
    if (!cam || !player?.active) {
      shot = null;
      return false;
    }
    const now = performance.now();
    let framing;
    if (shot.blend) {
      const progress = (now - shot.blend.startedAt) / CUT_SHORT_BLEND_MS;
      if (progress >= 1) {
        releaseCamera(scene, player);
        return false;
      }
      // Fighters stand still before FIGHT, but track the target anyway.
      framing = blendFraming(shot.blend.from, restFraming(player, shot.bounds, shot.view), progress);
    } else {
      const progress = (now - shot.startedAt) / PREGAME_MS;
      if (progress >= 1) {
        releaseCamera(scene, player);
        return false;
      }
      // The planned end framing stays fixed for the whole shot, so physics
      // settling on the spawn platform can never jitter the camera.
      framing = sampleFlythrough(shot.plan, progress, { bounds: shot.bounds, view: shot.view });
    }
    // Nothing else may steer the camera while the shot runs.
    if (cam._follow) cam.stopFollow();
    cam.setZoom(framing.zoom);
    cam.centerOn(framing.x, framing.y);
    return true;
  }

  function dispose() {
    state = "done";
    shot = null;
    clearTimeout(pregameTimer);
    clearTimeout(audioStopTimer);
    envelope?.dispose();
    envelope = null;
    try { audio?.pause(); } catch (_) {}
  }

  return {
    beginPregame,
    conclude,
    updateCamera,
    dispose,
    isActive: () => state === "pregame" || state === "holding",
  };
}
