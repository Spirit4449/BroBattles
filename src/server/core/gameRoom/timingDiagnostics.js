function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values, average = null) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const avg = average == null ? mean(values) : average;
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function percentile(values, pct) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const sorted = [...values].sort((a, b) => a - b);
  const clampedPct = Math.max(0, Math.min(100, Number(pct) || 0));
  const rank = (clampedPct / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const weight = rank - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function format(value, digits = 1) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(digits) : "n/a";
}

function createRingBuffer(limit) {
  const values = [];
  return {
    push(value) {
      values.push(value);
      if (values.length > limit) values.shift();
    },
    toArray() {
      return values.slice();
    },
    length() {
      return values.length;
    },
    clear() {
      values.length = 0;
    },
  };
}

function createTimingDiagnostics(room, options = {}) {
  const fixedDtMs = Number(options.fixedDtMs) || 33.333333333333336;
  const sampleLimit = Math.max(30, Number(options.sampleLimit) || 240);
  const summaryIntervalMs = Math.max(
    1000,
    Number(options.summaryIntervalMs) || 4000,
  );
  const severeLoopGapMs = Math.max(
    fixedDtMs * 4,
    Number(options.severeLoopGapMs) || 250,
  );
  const criticalLoopGapMs = Math.max(
    severeLoopGapMs * 2,
    Number(options.criticalLoopGapMs) || 1000,
  );
  const severeSnapshotGapMs = Math.max(
    fixedDtMs * 3,
    Number(options.severeSnapshotGapMs) || 180,
  );

  const loopDeltas = createRingBuffer(sampleLimit);
  const loopBursts = createRingBuffer(sampleLimit);
  const snapshotGaps = createRingBuffer(sampleLimit);
  const snapshotBurstSizes = createRingBuffer(sampleLimit);

  let lastSummaryAt = 0;
  let lastSnapshotMono = null;
  let sameMonoSnapshotCount = 0;
  let loopCount = 0;
  let totalLoopSteps = 0;
  let maxLoopDelta = 0;
  let maxLoopBurst = 0;
  let maxLoopBacklog = 0;
  let maxSnapshotGap = 0;
  let maxSnapshotBurst = 0;

  function buildSummary(reason = "periodic") {
    const loopValues = loopDeltas.toArray();
    const loopBurstValues = loopBursts.toArray();
    const snapshotGapValues = snapshotGaps.toArray();
    const snapshotBurstValues = snapshotBurstSizes.toArray();

    const loopAvg = mean(loopValues);
    const loopSd = stddev(loopValues, loopAvg);
    const loopP95 = percentile(loopValues, 95);
    const snapshotAvg = mean(snapshotGapValues);
    const snapshotSd = stddev(snapshotGapValues, snapshotAvg);
    const snapshotP95 = percentile(snapshotGapValues, 95);
    const burstAvg = mean(loopBurstValues);
    const burstP95 = percentile(loopBurstValues, 95);
    const snapshotBurstAvg = mean(snapshotBurstValues);

    const loopLagExcess = Math.max(0, maxLoopDelta - fixedDtMs);
    const burstPressure = Math.max(0, maxLoopBurst - 1);
    const backlogPressure = Math.max(0, maxLoopBacklog - fixedDtMs);
    const snapshotGapPressure = Math.max(0, maxSnapshotGap - fixedDtMs);
    const zeroGapRatio =
      snapshotGaps.length() > 0
        ? snapshotGaps.toArray().filter((gap) => Math.abs(gap) < 0.5).length /
          snapshotGaps.length()
        : 0;

    let verdict = "stable";
    let confidence = 0;
    let cause = "none";

    if (maxLoopDelta >= criticalLoopGapMs || maxLoopBurst >= 12) {
      verdict = "critical loop stall";
      cause =
        maxLoopDelta >= criticalLoopGapMs
          ? "event-loop pause"
          : "catch-up burst";
      confidence = clamp(
        0.7 +
          (Math.max(maxLoopDelta - criticalLoopGapMs, 0) / criticalLoopGapMs) *
            0.2 +
          burstPressure * 0.01,
        0,
        0.99,
      );
    } else if (maxLoopDelta >= severeLoopGapMs || maxLoopBurst >= 4) {
      verdict = "loop catch-up burst";
      cause =
        maxLoopDelta >= severeLoopGapMs ? "event-loop pause" : "burst replay";
      confidence = clamp(
        0.45 +
          (Math.max(maxLoopDelta - severeLoopGapMs, 0) / severeLoopGapMs) *
            0.35 +
          burstPressure * 0.03,
        0,
        0.95,
      );
    } else if (maxSnapshotGap >= severeSnapshotGapMs) {
      verdict = "snapshot pacing drift";
      cause = "snapshot emission gap";
      confidence = clamp(
        0.4 +
          ((maxSnapshotGap - severeSnapshotGapMs) /
            Math.max(severeSnapshotGapMs, 1)) *
            0.4,
        0,
        0.9,
      );
    } else if (loopSd > loopAvg * 0.25 || snapshotSd > snapshotAvg * 0.25) {
      verdict = "high jitter";
      cause = loopSd > loopAvg * 0.25 ? "loop jitter" : "snapshot jitter";
      confidence = 0.35;
    }

    const loopStepRatio = loopCount > 0 ? totalLoopSteps / loopCount : 0;
    const lines = [
      `[diag] reason=${reason} verdict=${verdict} cause=${cause} conf=${format(confidence * 100, 0)}%`,
      `loop n=${loopValues.length} avg=${format(loopAvg)}ms sd=${format(loopSd)}ms p95=${format(loopP95)}ms max=${format(maxLoopDelta)}ms burstAvg=${format(burstAvg, 2)} burstP95=${format(burstP95, 1)} burstMax=${format(maxLoopBurst, 0)} stepsPerFrame=${format(loopStepRatio, 2)}`,
      `snap n=${snapshotGapValues.length} avg=${format(snapshotAvg)}ms sd=${format(snapshotSd)}ms p95=${format(snapshotP95)}ms max=${format(maxSnapshotGap)}ms zeroGap=${format(zeroGapRatio * 100, 0)}% burstAvg=${format(snapshotBurstAvg, 2)} burstMax=${format(maxSnapshotBurst, 0)}`,
      `pressure loopLagExcess=${format(loopLagExcess)}ms backlogPressure=${format(backlogPressure)}ms snapshotGapPressure=${format(snapshotGapPressure)}ms sameMonoSnapshots=${sameMonoSnapshotCount}`,
    ];

    return lines.join(" | ");
  }

  function maybeLog(reason, nowMono, force = false, evidence = {}) {
    if (!room?.DEV_TIMING_DIAG || room?._netTestEnabled) return;
    const now = Number(nowMono) || 0;
    const recentLoopDelta = Math.max(0, Number(evidence?.deltaMs) || 0);
    const recentSteps = Math.max(0, Number(evidence?.stepsThisFrame) || 0);
    const recentSnapshotGap = Math.max(0, Number(evidence?.gapMs) || 0);
    const recentBurst = Math.max(0, Number(evidence?.burstSize) || 0);
    const severe =
      recentLoopDelta >= severeLoopGapMs ||
      recentSteps >= 4 ||
      recentSnapshotGap >= severeSnapshotGapMs ||
      recentBurst >= 4 ||
      sameMonoSnapshotCount >= 3;
    if (!force && !severe && now - lastSummaryAt < summaryIntervalMs) return;
    if (!force && severe && now - lastSummaryAt < 1000) return;
    console.log(`[GameRoom ${room.matchId}] ${buildSummary(reason)}`);
    lastSummaryAt = now;
  }

  function noteLoopFrame({ nowMono, deltaMs, stepsThisFrame, sleepMs }) {
    const delta = Math.max(0, Number(deltaMs) || 0);
    const steps = Math.max(0, Number(stepsThisFrame) || 0);
    const backlog = Math.max(0, delta - fixedDtMs);
    loopCount += 1;
    totalLoopSteps += steps;
    loopDeltas.push(delta);
    loopBursts.push(steps);
    if (delta > maxLoopDelta) maxLoopDelta = delta;
    if (steps > maxLoopBurst) maxLoopBurst = steps;
    if (backlog > maxLoopBacklog) maxLoopBacklog = backlog;
    if (delta >= severeLoopGapMs || steps >= 4) {
      maybeLog(
        `loop-delta=${format(delta)}ms steps=${steps} sleep=${format(sleepMs)}ms`,
        nowMono,
        true,
        { deltaMs: delta, stepsThisFrame: steps, sleepMs },
      );
      return;
    }
    maybeLog("loop-frame", nowMono, false, {
      deltaMs: delta,
      stepsThisFrame: steps,
    });
  }

  function noteSnapshot({ nowMono, snapMono, tickId, burstSize = 1 }) {
    const mono = Number(snapMono);
    const now = Number(nowMono) || mono || 0;
    const burst = Math.max(1, Number(burstSize) || 1);
    const prevSnapshotMono = lastSnapshotMono;
    snapshotBurstSizes.push(burst);
    if (burst > maxSnapshotBurst) maxSnapshotBurst = burst;

    if (Number.isFinite(mono)) {
      if (prevSnapshotMono != null) {
        const gap = Math.max(0, mono - prevSnapshotMono);
        snapshotGaps.push(gap);
        if (gap > maxSnapshotGap) maxSnapshotGap = gap;
        sameMonoSnapshotCount = gap < 0.5 ? sameMonoSnapshotCount + 1 : 0;
      }
      lastSnapshotMono = mono;
    }

    const recentGap =
      Number.isFinite(mono) && prevSnapshotMono != null
        ? Math.max(0, mono - prevSnapshotMono)
        : 0;
    if (recentGap >= severeSnapshotGapMs || burst >= 4) {
      maybeLog(
        `snapshot-gap=${format(recentGap)}ms tick=${tickId ?? "?"} burst=${burst}`,
        now,
        true,
        { gapMs: recentGap, burstSize: burst },
      );
      return;
    }
    maybeLog("snapshot", now, false, { gapMs: recentGap, burstSize: burst });
  }

  function flush(reason = "flush", nowMono = performance.now()) {
    maybeLog(reason, nowMono, true);
  }

  return {
    noteLoopFrame,
    noteSnapshot,
    flush,
  };
}

module.exports = {
  createTimingDiagnostics,
};
