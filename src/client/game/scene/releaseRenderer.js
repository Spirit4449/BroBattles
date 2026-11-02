// A browser keeps only a handful of WebGL contexts alive at once, and a
// destroyed Phaser game hands its own back only when the canvas is collected.
// Visiting a match (or reloading a map in the editor) more than a few times
// otherwise pushes the browser past its limit, which evicts the oldest
// contexts. Safari logs "WebGL: context lost." for every call made on one of
// those, so the console floods and the next boot cannot build its framebuffers.
// Give the context up explicitly the moment the game that owned it is gone.
export function releaseRendererContext(gl) {
  if (!gl || typeof gl.getExtension !== 'function') return false;
  if (gl.isContextLost?.()) return false;
  const lose = gl.getExtension('WEBGL_lose_context');
  if (!lose) return false;
  try {
    lose.loseContext();
    return true;
  } catch (_) {
    return false;
  }
}

// The renderer clears its own references while tearing down, so the context has
// to be read before destroy() runs.
export function rendererContextOf(game) {
  const gl = game?.renderer?.gl || null;
  return gl && typeof gl.getExtension === 'function' ? gl : null;
}
