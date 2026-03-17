// gameScene/networkInterpolation.js

export function processSnapshotInterpolation({
  snapshotBuffer,
  now = performance.now(),
  applyFrame,
  onDebugLine,
}) {
  if (snapshotBuffer.hasData()) {
    const frame = snapshotBuffer.getInterpolationFrame(now);
    if (frame) {
      applyFrame(frame);
    }
  }

  try {
    const line = snapshotBuffer.consumeAdaptiveDebugLine(now);
    if (line && typeof onDebugLine === "function") onDebugLine(line);
  } catch (_) {}
}
