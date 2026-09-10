// Shared by the aim preview and the rendered hook so the guide begins at the
// exact same visible-body socket from which the hand launches.
function resolveGloopHookSocket(player, angle = 0) {
  const width = player?.displayWidth || player?.width || 80;
  const height = player?.displayHeight || player?.height || 100;
  const body = player?.body;
  const bodyWidth = Number(body?.width) || width * 0.3;
  const bodyHeight = Number(body?.height) || height * 0.3;
  const bodyCenterX = Number(body?.center?.x);
  const bodyCenterY = Number(body?.center?.y);
  const centerX = Number.isFinite(bodyCenterX) ? bodyCenterX : (player?.x || 0);
  const centerY = Number.isFinite(bodyCenterY)
    ? bodyCenterY
    : (player?.y || 0) + height * 0.34;
  return {
    x: centerX + Math.cos(angle) * bodyWidth * 0.35,
    y: centerY + Math.sin(angle) * bodyHeight * 0.3,
  };
}

module.exports = { resolveGloopHookSocket };
