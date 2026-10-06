// Logical game size for the current window. The arena fills the window by
// trimming what players see, within limits; past those limits the canvas
// letterboxes and ambient bezels (ambientBezels.js) fill the rest.
export const GAME_VIEW = Object.freeze({
  width: 2300, // full arena width
  height: 1000, // base playfield height
  maxHeight: 1320, // tall windows first gain sky above the arena
  minWidth: 1610, // then trim up to 30% of the sides
  minHeight: 860, // very wide windows trim the top and bottom instead
});

export function fitGameSize(viewportWidth, viewportHeight, view = GAME_VIEW) {
  const aspect = Math.max(1, viewportWidth) / Math.max(1, viewportHeight);
  let width = view.width;
  let height = view.width / aspect;
  if (height > view.maxHeight) {
    height = view.maxHeight;
    width = Math.max(view.minWidth, height * aspect);
  } else if (height < view.height) {
    height = Math.max(view.minHeight, height);
  }
  return { width: Math.round(width), height: Math.round(height) };
}

export function viewportSize() {
  const vv = window.visualViewport;
  return {
    width: Number(vv?.width) || Number(window.innerWidth) || document.documentElement?.clientWidth || GAME_VIEW.width,
    height: Number(vv?.height) || Number(window.innerHeight) || document.documentElement?.clientHeight || GAME_VIEW.height,
  };
}

// While a window is being dragged, Phaser's FIT scaling stretches the existing
// canvas; the logical size changes once the window settles. Resizing the
// renderer every frame clears the canvas and jumps the camera.
export const RESIZE_SETTLE_MS = 180;

/** Keep the logical game size matched to the window as it resizes or rotates. */
export function installViewportFit(game) {
  let timer = 0;
  const apply = () => {
    timer = 0;
    const { width, height } = viewportSize();
    const next = fitGameSize(width, height);
    const current = game.scale.gameSize;
    if (current.width === next.width && current.height === next.height) return;
    // Phaser keeps scroll when a camera resizes, which shifts what it centres on.
    const centres = game.scene.getScenes(true).map((scene) => {
      const cam = scene.cameras?.main;
      return cam && { cam, x: cam.scrollX + cam.width * cam.originX, y: cam.scrollY + cam.height * cam.originY };
    }).filter(Boolean);
    game.scale.setGameSize(next.width, next.height);
    for (const { cam, x, y } of centres) {
      cam.setScroll(x - cam.width * cam.originX, y - cam.height * cam.originY);
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(apply, RESIZE_SETTLE_MS);
  };
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    clearTimeout(timer);
    window.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
  });
}
