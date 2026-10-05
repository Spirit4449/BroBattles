// Phaser 3.70's Canvas renderer ignores GameConfig.resolution for the main
// canvas. Give it a denser backing store without changing logical game units.
export function installHighResolutionCanvas(game, Phaser, initialScale = 1) {
  if (game?.renderer?.type !== Phaser.CANVAS) return null;

  const canvas = game.canvas;
  const context = game.renderer.gameContext;
  if (!canvas || !context) return null;
  let renderScale = 1;
  const originalImageRendering = canvas.style.imageRendering;

  // Phaser repeatedly calls setTransform, including once per game object.
  // Scaling only at frame start would be immediately overwritten. Apply the
  // backing-store scale to each transform on the main canvas context instead.
  const originalSetTransform = context.setTransform;
  const nativeSetTransform = originalSetTransform.bind(context);
  const scaledSetTransform = (...args) => {
    if (args.length === 1) {
      const matrix = args[0];
      return nativeSetTransform(
        matrix.a * renderScale,
        matrix.b * renderScale,
        matrix.c * renderScale,
        matrix.d * renderScale,
        matrix.e * renderScale,
        matrix.f * renderScale,
      );
    }

    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = args;
    return nativeSetTransform(
      a * renderScale,
      b * renderScale,
      c * renderScale,
      d * renderScale,
      e * renderScale,
      f * renderScale,
    );
  };

  try {
    context.setTransform = scaledSetTransform;
    if (context.setTransform !== scaledSetTransform) return null;
  } catch (_) {
    return null;
  }

  const syncBackingStore = () => {
    const width = Math.round(game.scale.baseSize.width * renderScale);
    const height = Math.round(game.scale.baseSize.height * renderScale);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    canvas.style.imageRendering = renderScale > 1 ? "auto" : originalImageRendering;
  };

  const setScale = (nextScale) => {
    renderScale = Number.isFinite(nextScale) && nextScale >= 0.5 && nextScale <= 2 ? nextScale : 1;
    syncBackingStore();
  };

  setScale(initialScale);
  game.scale.on(Phaser.Scale.Events.RESIZE, syncBackingStore);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    game.scale.off(Phaser.Scale.Events.RESIZE, syncBackingStore);
    context.setTransform = originalSetTransform;
    canvas.style.imageRendering = originalImageRendering;
  });
  return { setScale };
}
