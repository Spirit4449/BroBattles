import { installHighResolutionCanvas } from './highResolutionCanvas';

// Phaser 3.70 has no main-canvas resolution setting. Keep all game/camera/input
// coordinates logical and scale only the default framebuffer. Offscreen textures
// retain their own dimensions. No character or effect needs a renderer branch.
export function installRenderResolution(game, Phaser, initialScale = 1) {
  if (game.renderer.type === Phaser.CANVAS) {
    return installHighResolutionCanvas(game, Phaser, initialScale);
  }
  if (game.renderer.type !== Phaser.WEBGL) return null;
  const renderer = game.renderer;
  const gl = renderer.gl;
  const canvas = game.canvas;
  const originalImageRendering = canvas.style.imageRendering;
  const originals = { viewport: gl.viewport, scissor: gl.scissor, bindFramebuffer: gl.bindFramebuffer };
  const bufferHeightDescriptor = Object.getOwnPropertyDescriptor(renderer, 'drawingBufferHeight');
  let bufferHeight = renderer.drawingBufferHeight;
  let framebuffer = null;
  let scaleX = 1, scaleY = 1, renderScale = 1;
  gl.bindFramebuffer = function (target, buffer) {
    originals.bindFramebuffer.call(this, target, buffer);
    if (target === gl.FRAMEBUFFER) framebuffer = buffer;
  };
  // These calls happen at camera/target boundaries, not for each sprite.
  for (const method of ['viewport', 'scissor']) {
    gl[method] = function (x, y, width, height) {
      if (!framebuffer) {
        const right = Math.round((x + width) * scaleX);
        const top = Math.round((y + height) * scaleY);
        x = Math.round(x * scaleX);
        y = Math.round(y * scaleY);
        width = right - x;
        height = top - y;
      }
      return originals[method].call(this, x, y, width, height);
    };
  }
  // Phaser reads the physical drawing-buffer height when resetting its viewport,
  // then uses it to invert logical camera scissors. Expose logical units only for
  // the screen; render textures continue to use their native height.
  Object.defineProperty(renderer, 'drawingBufferHeight', {
    configurable: true,
    get: () => framebuffer ? bufferHeight : game.scale.baseSize.height,
    set: value => { bufferHeight = value; },
  });
  const sync = () => {
    const { width, height } = game.scale.baseSize;
    const limits = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    const maxSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    const effectiveScale = Math.min(renderScale, limits[0] / width, limits[1] / height, maxSize / width, maxSize / height);
    const w = Math.max(1, Math.round(width * effectiveScale));
    const h = Math.max(1, Math.round(height * effectiveScale));
    scaleX = w / width;
    scaleY = h / height;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    canvas.style.imageRendering = effectiveScale > 1 ? 'auto' : originalImageRendering;
    renderer.resize(width, height);
    // resize() uses gl.drawingBufferHeight directly, bypassing the logical
    // accessor. Reset the full-screen scissor after changing the backing store.
    gl.scissor(0, 0, width, height);
  };
  const setScale = value => {
    renderScale = Number.isFinite(value) && value >= 0.5 && value <= 2 ? value : 1;
    sync();
  };
  setScale(initialScale);
  game.scale.on(Phaser.Scale.Events.RESIZE, sync);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    game.scale.off(Phaser.Scale.Events.RESIZE, sync);
    Object.assign(gl, originals);
    Object.defineProperty(renderer, 'drawingBufferHeight', bufferHeightDescriptor);
    canvas.style.imageRendering = originalImageRendering;
  });
  return { setScale };
}
