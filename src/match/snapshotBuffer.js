import { shouldMuteClientDefaultLogs } from "../lib/netTestLogger.js";

export function createSnapshotBuffer({
  maxStateBuffer = 120,
  initialInterpDelayMs = 50,
  minInterpDelayMs = 40,
  maxInterpDelayMs = 50,
  snapIntervalMs = 50,
  maxSpacingMs = 500,
  lateSnapshotThresholdMs = 140,
  largePositionDeltaPx = 90,
  spacingEmaAlpha = 0.12,
  enableAdaptiveDelay = false,
  enableClockCorrection = false,
  enableBacklogCatchup = false,
  extrapolationLimitMs = 1000,
} = {}) {
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

  function hasData() {
    return active && stateBuffer.length > 0;
  }

  function getBufferLength() {
    return stateBuffer.length;
  }

  function ingestSnapshot(snapshot, clientMonoNow = performance.now()) {
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
      const d = snapMono - prev;
      spacingMs = d;
      if (d >= 0 && d < maxSpacingMs) {
        snapshotSpacings.push(d);
        if (snapshotSpacings.length > 400) snapshotSpacings.splice(0, 200);

        spacingEma =
          spacingEma == null
            ? d
            : spacingEma + (d - spacingEma) * spacingEmaAlpha;
        const dev = Math.abs(d - (spacingEma || d));
        jitterEma =
          jitterEma == null
            ? dev
            : jitterEma + (dev - jitterEma) * spacingEmaAlpha;

        if (enableAdaptiveDelay && spacingEma != null && jitterEma != null) {
          let targetDelay = spacingEma * 3 + jitterEma * 2;
          if (targetDelay < minInterpDelayMs) targetDelay = minInterpDelayMs;
          if (targetDelay > maxInterpDelayMs) targetDelay = maxInterpDelayMs;
          interpDelayMs += (targetDelay - interpDelayMs) * 0.1;
        }
        if (d >= Math.max(lateSnapshotThresholdMs, snapIntervalMs * 2)) {
          lateSnapshot = true;
        }
      }

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

    if (
      typeof currentTickId === "number" &&
      typeof lastTickId === "number" &&
      currentTickId <= lastTickId
    ) {
      outOfOrderTick = true;
    }

    if (renderClockMono == null && typeof snapMono === "number") {
      renderClockMono = snapMono;
      lastFramePerfNow = clientMonoNow;
    }

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

        if (lagMs > 120) {
          const step = Math.min(lagMs * 0.12, 10);
          targetMono += step;
          renderClockMono = targetMono + interpDelayMs;
        }

        if (lagMs < -60) {
          const step = Math.min(-lagMs * 0.08, 8);
          targetMono -= step;
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
    return `[adaptive] delay=${interpDelayMs.toFixed(1)}ms spacingEma=${spacingEma?.toFixed(2)} jitterEma=${jitterEma?.toFixed(2)} buffer=${stateBuffer.length}`;
  }

  return {
    ingestSnapshot,
    getInterpolationFrame,
    consumeAdaptiveDebugLine,
    hasData,
    getBufferLength,
  };
}
