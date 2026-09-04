export const DEFAULT_SNAPSHOT_BUFFER_CONFIG = Object.freeze({
  maxStateBuffer: 90,
  initialInterpDelayMs: 75,
  minInterpDelayMs: 45,
  maxInterpDelayMs: 115,
  snapIntervalMs: 1000 / 30,
  maxSpacingMs: 500,
  lateSnapshotThresholdMs: 140,
  largePositionDeltaPx: 90,
  spacingEmaAlpha: 0.12,
  enableAdaptiveDelay: true,
  // Opt-in until gameplay traces validate the latency / underrun tradeoff.
  enableArrivalAdaptiveDelay: false,
  enableClockCorrection: false,
  enableBacklogCatchup: true,
  extrapolationLimitMs: 1000,
});
