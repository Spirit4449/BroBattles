// DOM backdrop behind the battle canvas: map artwork and camera parallax.
import { getMapBgAsset, normalizeMapId } from "../maps/manifest";

export function applyMatchBackground(scene, gameData, mapId) {
  try {
    const bgUrl = gameData?.mapSnapshot?.map?.background || getMapBgAsset(mapId, scene);
    const bgImg = document.querySelector("#game-bg img");
    if (bgImg && bgUrl) {
      const markReady = () => {
        bgImg.onload = null;
        bgImg.onerror = null;
        window.markMatchBackgroundReady?.();
      };

      document.getElementById("game-bg")?.classList.remove("visible");
      bgImg.onload = markReady;
      bgImg.onerror = markReady;
      bgImg.setAttribute("src", bgUrl);
      bgImg.style.transform = "translate3d(0,0,0) scale(1)";

      // Cached images can already be complete before the load handler runs.
      if (bgImg.complete) queueMicrotask(markReady);
    }
  } catch (_) {
    // A missing decorative background must not leave the loading screen stuck.
    window.markMatchBackgroundReady?.();
  }
}

// Only Iron Junction (map 4) is wide enough to scroll its backdrop.
export function updateMatchBackgroundParallax(scene, mapId) {
  try {
    const bgImg = document.querySelector("#game-bg img");
    const activeMapId = normalizeMapId(mapId);
    if (!bgImg || activeMapId !== 4) {
      if (bgImg) bgImg.style.transform = "translate3d(0,0,0) scale(1)";
      return;
    }
    const cam = scene?.cameras?.main;
    if (!cam) return;
    // Smooth parallax with clamped shift to prevent exposing white edges.
    const parallaxFactor = 0.35;
    const worldW = Math.max(
      1,
      Number(scene?.physics?.world?.bounds?.width) || 2300,
    );
    const viewportW = Math.max(
      1,
      Number(window.visualViewport?.width) ||
        Number(window.innerWidth) ||
        Number(scene?.scale?.width) ||
        1280,
    );
    const baseScale = 1.22;
    const effectiveBgW = Math.max(viewportW, viewportW * baseScale);
    const maxOverflow = Math.max(0, effectiveBgW - viewportW);
    const progress = Phaser.Math.Clamp(
      (Number(cam.scrollX) || 0) / worldW,
      0,
      1,
    );
    const parallaxShift = -maxOverflow * progress * parallaxFactor;
    const shiftPx = Phaser.Math.Clamp(parallaxShift, -maxOverflow, 0);
    bgImg.style.transform = `translate3d(${shiftPx}px,0,0) scale(${baseScale})`;
    bgImg.style.transformOrigin = "50% 100%";
  } catch (_) {}
}
