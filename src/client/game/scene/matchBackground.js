// The arena backdrop renders inside Phaser (sceneryRuntime.js) and is loaded
// by the scene preload. Outside the canvas, #game-bg holds the ambient bezels.
// The loading screen still waits for this signal before revealing the match.
export function applyMatchBackground() {
  document.getElementById("game-bg")?.classList.remove("visible");
  queueMicrotask(() => window.markMatchBackgroundReady?.());
}
