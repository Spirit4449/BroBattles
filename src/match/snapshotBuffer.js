import { shouldMuteClientDefaultLogs } from "../lib/netTestLogger.js";
import { DEFAULT_SNAPSHOT_BUFFER_CONFIG } from "./snapshotBufferConfig.js";

const SERVER_TICK_MS = 1000 / 60;

// Correct only the excess outside the tolerated range. Time-based gains and
// speed limits avoid refresh-rate-dependent catch-up and abrupt threshold steps.
export function getRenderClockCorrection(lagMs, deltaMs) {
  const dt = Math.max(0, Math.min(250, deltaMs));
  if (lagMs > 120) {
    return Math.min((lagMs - 120) * (1 - Math.exp(-dt / 130)), dt * 0.6);
  }
  if (lagMs < -60) {
    return -Math.min((-lagMs - 60) * (1 - Math.exp(-dt / 200)), dt * 0.48);
  }
  return 0;
}

export function createSnapshotBuffer(options = {}) {
  const {
    maxStateBuffer,
    initialInterpDelayMs,
    minInterpDelayMs,
    maxInterpDelayMs,
    snapIntervalMs,
    maxSpacingMs,
    lateSnapshotThresholdMs,
    largePositionDeltaPx,
    spacingEmaAlpha,
    enableAdaptiveDelay,
    enableArrivalAdaptiveDelay,
    enableClockCorrection,
    enableBacklogCatchup,
    extrapolationLimitMs,
  } = {
    ...DEFAULT_SNAPSHOT_BUFFER_CONFIG,
    ...(options || {}),
  };
  let active = false;
  const stateBuffer = [];
  let interpDelayMs = initialInterpDelayMs;
  let serverMonoOffset = 0;
  let monoCalibrated = false;
  const snapshotSpacings = [];
  let lastDiagLogMono = 0;
  let renderClockMono = null;
  let lastFramePerfNow = null;
  let spacingEma = null;
  let jitterEma = null;
  let lastAdaptivePrint = 0;
  let lastTickId = null;
  let lastSequence = null;
  let epoch = null;
  let lastPeriodic = null;
  let arrivalJitterEma = 0;
  let arrivalGapMs = 0;
  let sourceGapMs = 0;
  let underrunFrames = 0;
  let renderedFrames = 0;
  let rejectedSnapshots = 0;
  let maxExtrapolationMs = 0;
  let generation = 0;

  function reset() {
    generation++;
    active = false;
    stateBuffer.length = 0;
    snapshotSpacings.length = 0;
    interpDelayMs = initialInterpDelayMs;
    serverMonoOffset = 0;
    monoCalibrated = false;
    renderClockMono = lastFramePerfNow = null;
    spacingEma = jitterEma = null;
    lastTickId = lastSequence = epoch = lastPeriodic = null;
    arrivalJitterEma = arrivalGapMs = sourceGapMs = 0;
    underrunFrames = renderedFrames = rejectedSnapshots = maxExtrapolationMs = 0;
    lastAdaptivePrint = lastDiagLogMono = 0;
  }

  function getDiagnostics() {
    return { interpDelayMs, spacingEma, jitterEma, arrivalJitterEma,
      arrivalGapMs, sourceGapMs, underrunFrames, renderedFrames,
      rejectedSnapshots, maxExtrapolationMs, bufferLength: stateBuffer.length };
  }

  function hasData() {
    return active && stateBuffer.length > 0;
  }

  function getBufferLength() {
    return stateBuffer.length;
  }

  function ingestSnapshot(snapshot, clientMonoNow = performance.now()) {
    const incomingEpoch = typeof snapshot?.snapshotEpoch === "string"
      ? snapshot.snapshotEpoch : null;
    if (incomingEpoch && epoch && incomingEpoch !== epoch) reset();
    if (incomingEpoch) epoch = incomingEpoch;
    const sequence = Number.isSafeInteger(snapshot?.snapshotSeq)
      ? snapshot.snapshotSeq : null;
    const sequenced = incomingEpoch !== null && sequence !== null;
    if (sequenced && lastSequence !== null && sequence <= lastSequence) {
      rejectedSnapshots++;
      return { accepted: false, reason: "stale-sequence", activated: false };
    }
    // Legacy snapshots remain supported. On the first real monotonic timestamp,
    // discard any wall-clock-only bootstrap frames instead of mixing domains.
    if (!monoCalibrated && Number.isFinite(snapshot?.tMono) && stateBuffer.length) {
      generation++;
      stateBuffer.length = 0;
      renderClockMono = lastFramePerfNow = null;
      lastPeriodic = null;
      spacingEma = jitterEma = null;
      snapshotSpacings.length = 0;
    }
    let activated = false;
    if (!active) {
      active = true;
      activated = true;
    }

    let calibrationLog = null;
    if (!monoCalibrated && typeof snapshot?.tMono === "number") {
      serverMonoOffset = snapshot.tMono - clientMonoNow;
      monoCalibrated = true;
      calibrationLog = serverMonoOffset;
    }

    let snapMono = null;
    if (typeof snapshot?.tMono === "number") {
      snapMono = snapshot.tMono;
    } else if (typeof snapshot?.timestamp === "number") {
      snapMono = monoCalibrated
        ? clientMonoNow + serverMonoOffset
        : snapshot.timestamp;
    } else {
      snapMono = clientMonoNow;
    }

    let spacingMs = 0;
    let lateSnapshot = false;
    let outOfOrderTick = false;
    let previousTickId = lastTickId;
    const currentTickId =
      typeof snapshot?.tickId === "number" ? snapshot.tickId : null;
    const positionJumps = [];

    if (stateBuffer.length > 0) {
      const prevState = stateBuffer[stateBuffer.length - 1];
      const prev = prevState.tMono;
      if (sequenced && snapMono < prev) {
        rejectedSnapshots++;
        return { accepted: false, reason: "stale-time", activated: false };
      }
      if (!sequenced && Number.isFinite(snapMono) && snapMono <= prev) {
        const prevTickId =
          typeof prevState?.tickId === "number" ? prevState.tickId : null;
        const tickDelta =
          typeof currentTickId === "number" && typeof prevTickId === "number"
            ? currentTickId - prevTickId
            : null;
        const syntheticGap =
          Number.isFinite(tickDelta) && tickDelta > 0
            ? tickDelta * SERVER_TICK_MS
            : snapIntervalMs;
        snapMono = prev + Math.max(1, syntheticGap);
      }
      const d = snapMono - prev;
      spacingMs = d;

      const prevPlayers =
        prevState?.players && typeof prevState.players === "object"
          ? prevState.players
          : {};
      const nextPlayers =
        snapshot?.players && typeof snapshot.players === "object"
          ? snapshot.players
          : {};
      for (const [name, nextPos] of Object.entries(nextPlayers)) {
        const prevPos = prevPlayers[name];
        if (!prevPos || !nextPos) continue;
        const prevX = Number(prevPos.x);
        const prevY = Number(prevPos.y);
        const nextX = Number(nextPos.x);
        const nextY = Number(nextPos.y);
        if (
          !Number.isFinite(prevX) ||
          !Number.isFinite(prevY) ||
          !Number.isFinite(nextX) ||
          !Number.isFinite(nextY)
        ) {
          continue;
        }
        const dx = nextX - prevX;
        const dy = nextY - prevY;
        const distance = Math.hypot(dx, dy);
        if (distance >= largePositionDeltaPx) {
          positionJumps.push({
            name,
            distance,
            dx,
            dy,
            prevX,
            prevY,
            nextX,
            nextY,
          });
        }
      }
    }

    if (snapshot?.snapshotKind !== "event") {
      const sendMono = Number.isFinite(snapshot?.sentMono) ? snapshot.sentMono : snapMono;
      if (lastPeriodic) {
        const d = snapMono - lastPeriodic.simMono;
        arrivalGapMs = Math.max(0, clientMonoNow - lastPeriodic.arrival);
        sourceGapMs = Math.max(0, sendMono - lastPeriodic.sendMono);
        const jitter = Math.abs(arrivalGapMs - sourceGapMs);
        arrivalJitterEma += (jitter - arrivalJitterEma) * spacingEmaAlpha;
        lateSnapshot = arrivalGapMs >= Math.max(lateSnapshotThresholdMs, snapIntervalMs * 2);
        if (d > 0 && d < maxSpacingMs) {
          snapshotSpacings.push(d);
          if (snapshotSpacings.length > 240) snapshotSpacings.shift();
          spacingEma = spacingEma == null ? d : spacingEma + (d - spacingEma) * spacingEmaAlpha;
          const dev = Math.abs(d - spacingEma);
          jitterEma = jitterEma == null ? dev : jitterEma + (dev - jitterEma) * spacingEmaAlpha;
          if (enableAdaptiveDelay) {
            const target = enableArrivalAdaptiveDelay
              ? snapIntervalMs * 3 + arrivalJitterEma * 2
              : spacingEma * 3 + jitterEma * 2;
            interpDelayMs += (Math.max(minInterpDelayMs, Math.min(maxInterpDelayMs, target)) - interpDelayMs) * 0.1;
          }
        }
      }
      lastPeriodic = { arrival: clientMonoNow, sendMono, simMono: snapMono };
    }

    if (
      typeof currentTickId === "number" &&
      typeof lastTickId === "number" &&
      currentTickId < lastTickId
    ) {
      outOfOrderTick = true;
    }

    if (renderClockMono == null && typeof snapMono === "number") {
      renderClockMono = snapMono;
      lastFramePerfNow = clientMonoNow;
    }

    // A later emission at the same simulation instant replaces that instant's
    // state; it does not advance the render timeline by an invented interval.
    if (sequenced && stateBuffer[stateBuffer.length - 1]?.tMono === snapMono) {
      stateBuffer.pop();
    }
    if (sequenced) lastSequence = sequence;
    stateBuffer.push({
      tMono: snapMono,
      tickId: typeof snapshot?.tickId === "number" ? snapshot.tickId : null,
      players: snapshot?.players || {},
    });

    if (stateBuffer.length > maxStateBuffer) {
      stateBuffer.shift();
    }
    if (typeof currentTickId === "number") {
      lastTickId = currentTickId;
    }

    let snapshotDiagLine = null;
    if (clientMonoNow - lastDiagLogMono > 4000 && snapshotSpacings.length > 5) {
      const arr = snapshotSpacings.slice(-80);
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      const variance =
        arr.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / arr.length;
      const stdev = Math.sqrt(variance);
      snapshotDiagLine = `[interp] snapshots avg=${avg.toFixed(2)}ms sd=${stdev.toFixed(2)}ms n=${arr.length}`;
      lastDiagLogMono = clientMonoNow;
    }

    return {
      accepted: true,
      activated,
      snapMono,
      calibrationLog,
      snapshotDiagLine,
      spacingMs,
      lateSnapshot,
      outOfOrderTick,
      previousTickId,
      interpDelayMs,
      positionJumps,
    };
  }

  function getInterpolationFrame(perfNow = performance.now()) {
    if (!hasData()) return null;

    if (renderClockMono == null) {
      const last = stateBuffer[stateBuffer.length - 1];
      return { aState: last, bState: last, alpha: 1 };
    }

    if (lastFramePerfNow == null) lastFramePerfNow = perfNow;
    let dt = perfNow - lastFramePerfNow;
    lastFramePerfNow = perfNow;
    if (dt < 0) dt = 0;
    if (dt > 250) dt = 250;

    renderClockMono += dt;
    let targetMono = renderClockMono - interpDelayMs;

    const newest = stateBuffer[stateBuffer.length - 1].tMono;
    const oldest = stateBuffer[0].tMono;
    const extrapolationCapMono = newest + Math.max(0, extrapolationLimitMs);
    if (targetMono > extrapolationCapMono) {
      targetMono = extrapolationCapMono;
      renderClockMono = targetMono + interpDelayMs;
    }
    if (targetMono < oldest + 5) {
      targetMono = oldest + 5;
      renderClockMono = targetMono + interpDelayMs;
    }

    if (enableClockCorrection && spacingEma != null) {
      const error = spacingEma - snapIntervalMs;
      renderClockMono += error * 0.02;
    }

    if (enableBacklogCatchup) {
      const headT = newest;
      let lagMs = headT - interpDelayMs - targetMono;
      const maxHistoryMs = 500;
      const minTarget = headT - (interpDelayMs + maxHistoryMs);
      if (targetMono < minTarget) {
        if (!shouldMuteClientDefaultLogs()) {
          console.warn(
            `[interp] clamping backlog: lag=${lagMs.toFixed(1)}ms buffer=${stateBuffer.length}`,
          );
        }
        targetMono = minTarget;
        renderClockMono = targetMono + interpDelayMs;
        while (
          stateBuffer.length > 2 &&
          stateBuffer[1].tMono <= targetMono - 50
        ) {
          stateBuffer.shift();
        }
        lagMs = headT - interpDelayMs - targetMono;
      }

      if (lagMs > 1000) {
        if (!shouldMuteClientDefaultLogs()) {
          console.warn(`[interp] severe lag reset: lag=${lagMs.toFixed(0)}ms`);
        }
        targetMono = headT - interpDelayMs;
        renderClockMono = targetMono + interpDelayMs;
        if (stateBuffer.length > 10) {
          stateBuffer.splice(0, stateBuffer.length - 10);
        }
      }

      {
        const desired = headT - interpDelayMs;
        lagMs = desired - targetMono;

        const correction = getRenderClockCorrection(lagMs, dt);
        if (correction !== 0) {
          targetMono += correction;
          renderClockMono = targetMono + interpDelayMs;
        }

        while (
          stateBuffer.length > 2 &&
          stateBuffer[1].tMono <= targetMono - 50
        ) {
          stateBuffer.shift();
        }
      }
    } else {
      while (
        stateBuffer.length > 2 &&
        stateBuffer[1].tMono <= targetMono - 50
      ) {
        stateBuffer.shift();
      }
    }

    renderedFrames++;
    const frame = sampleAt(targetMono);
    if (frame.extrapolationMs > 0) underrunFrames++;
    maxExtrapolationMs = Math.max(maxExtrapolationMs, frame.extrapolationMs);
    return frame;
  }

  function sampleAt(targetMono) {
    if (!hasData()) return null;
    const oldest = stateBuffer[0].tMono;
    const newest = stateBuffer[stateBuffer.length - 1].tMono;
    targetMono = Math.max(oldest, Math.min(newest + extrapolationLimitMs, targetMono));
    let aState = null;
    let bState = null;
    for (let i = 0; i < stateBuffer.length - 1; i++) {
      const a = stateBuffer[i];
      const b = stateBuffer[i + 1];
      if (a.tMono <= targetMono && targetMono <= b.tMono) {
        aState = a;
        bState = b;
        break;
      }
    }

    if (aState && bState) {
      const span = bState.tMono - aState.tMono;
      let alpha = span > 0 ? (targetMono - aState.tMono) / span : 1;
      if (alpha < 0) alpha = 0;
      else if (alpha > 1) alpha = 1;
      return {
        aState,
        bState,
        alpha,
        targetMono,
        extrapolationMs: 0,
      };
    }

    if (stateBuffer.length >= 2) {
      const aState = stateBuffer[stateBuffer.length - 2];
      const bState = stateBuffer[stateBuffer.length - 1];
      return {
        aState,
        bState,
        alpha: 1,
        targetMono,
        extrapolationMs: Math.max(0, targetMono - bState.tMono),
      };
    }

    const only = stateBuffer[0];
    return {
      aState: only,
      bState: only,
      alpha: 1,
      targetMono,
      extrapolationMs: Math.max(0, targetMono - only.tMono),
    };
  }

  function consumeAdaptiveDebugLine(perfNow = performance.now()) {
    if (!enableAdaptiveDelay) return null;
    if (spacingEma == null) return null;
    if (perfNow - lastAdaptivePrint <= 5000) return null;
    lastAdaptivePrint = perfNow;
    return `[adaptive] delay=${interpDelayMs.toFixed(1)}ms spacingEma=${spacingEma?.toFixed(2)} jitterEma=${jitterEma?.toFixed(2)} arrivalJitter=${arrivalJitterEma.toFixed(2)}ms arrivalGap=${arrivalGapMs.toFixed(1)}ms sourceGap=${sourceGapMs.toFixed(1)}ms underruns=${underrunFrames}/${renderedFrames} maxExtrap=${maxExtrapolationMs.toFixed(1)}ms buffer=${stateBuffer.length}`;
  }

  return {
    ingestSnapshot,
    reset,
    sampleAt,
    getDiagnostics,
    getGeneration: () => generation,
    getInterpolationFrame,
    consumeAdaptiveDebugLine,
    hasData,
    getBufferLength,
  };
}
