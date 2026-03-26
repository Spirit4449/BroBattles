const CLIENT_NETTEST_STORAGE_KEY = "bb_nettest";

function readClientNetTestFlag() {
  try {
    if (typeof window === "undefined") return false;
    const qp = new URLSearchParams(window.location.search || "");
    const queryValue = String(qp.get("nettest") || "").toLowerCase();
    if (queryValue === "1" || queryValue === "true" || queryValue === "on") {
      return true;
    }
    const localValue = String(
      window.localStorage?.getItem(CLIENT_NETTEST_STORAGE_KEY) || "",
    ).toLowerCase();
    return localValue === "1" || localValue === "true" || localValue === "on";
  } catch (_) {
    return false;
  }
}

function readClientNetTestLabel() {
  try {
    if (typeof window === "undefined") return "";
    const qp = new URLSearchParams(window.location.search || "");
    const queryValue = String(qp.get("netlabel") || "").trim();
    if (queryValue) return queryValue;
    return String(window.localStorage?.getItem("bb_nettest_label") || "").trim();
  } catch (_) {
    return "";
  }
}

function formatNumber(value, digits = 1) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(digits) : "n/a";
}

function createEmptySummary() {
  return {
    frames: 0,
    frameDtTotal: 0,
    frameDtMax: 0,
    frameHitches50: 0,
    frameHitches100: 0,
    inputsSent: 0,
    inputGapTotal: 0,
    inputGapCount: 0,
    inputGapMax: 0,
    inputDistMax: 0,
    inputSpeedMax: 0,
    snapshots: 0,
    snapshotGapTotal: 0,
    snapshotGapCount: 0,
    snapshotGapMax: 0,
    lateSnapshots: 0,
    outOfOrderSnapshots: 0,
    snapshotJumpCount: 0,
    snapshotJumpMax: 0,
    actionsReceived: 0,
    attacksReceived: 0,
    actionsSent: 0,
    specialsSent: 0,
    jumpIntentsSent: 0,
    lastLocalX: null,
    lastLocalY: null,
    lastRemoteX: null,
    lastRemoteY: null,
  };
}

const clientNetTestState = {
  enabled: readClientNetTestFlag(),
  startedAt: Date.now(),
  lastFlushAt: Date.now(),
  label: readClientNetTestLabel(),
  username: "",
  matchId: "",
  summary: createEmptySummary(),
};

function basePrefix() {
  const label = clientNetTestState.label || "client";
  const user = clientNetTestState.username || "?";
  const matchId = clientNetTestState.matchId || "?";
  return `[NETTEST][${label}][user=${user}][match=${matchId}]`;
}

function emitLine(kind, fields = "") {
  if (!clientNetTestState.enabled) return;
  const suffix = fields ? ` ${fields}` : "";
  console.log(`${basePrefix()}[${kind}]${suffix}`);
}

function flushClientNetTestSummary(force = false) {
  if (!clientNetTestState.enabled) return;
  const now = Date.now();
  const elapsed = now - clientNetTestState.lastFlushAt;
  if (!force && elapsed < 2000) return;

  const s = clientNetTestState.summary;
  const fps =
    elapsed > 0 ? (s.frames * 1000) / elapsed : 0;
  const avgFrame =
    s.frames > 0 ? s.frameDtTotal / s.frames : 0;
  const avgInputGap =
    s.inputGapCount > 0 ? s.inputGapTotal / s.inputGapCount : 0;
  const avgSnapGap =
    s.snapshotGapCount > 0 ? s.snapshotGapTotal / s.snapshotGapCount : 0;

  emitLine(
    "summary",
    [
      `sec=${formatNumber((now - clientNetTestState.startedAt) / 1000, 1)}`,
      `fps=${formatNumber(fps, 1)}`,
      `frameAvg=${formatNumber(avgFrame, 1)}ms`,
      `frameMax=${formatNumber(s.frameDtMax, 1)}ms`,
      `hitch50=${s.frameHitches50}`,
      `hitch100=${s.frameHitches100}`,
      `inputs=${s.inputsSent}`,
      `inputAvg=${formatNumber(avgInputGap, 1)}ms`,
      `inputMax=${formatNumber(s.inputGapMax, 1)}ms`,
      `sendDistMax=${formatNumber(s.inputDistMax, 1)}px`,
      `sendSpeedMax=${formatNumber(s.inputSpeedMax, 1)}pxps`,
      `snaps=${s.snapshots}`,
      `snapAvg=${formatNumber(avgSnapGap, 1)}ms`,
      `snapMax=${formatNumber(s.snapshotGapMax, 1)}ms`,
      `late=${s.lateSnapshots}`,
      `ooo=${s.outOfOrderSnapshots}`,
      `jumpCount=${s.snapshotJumpCount}`,
      `jumpMax=${formatNumber(s.snapshotJumpMax, 1)}px`,
      `actionsRx=${s.actionsReceived}`,
      `attacksRx=${s.attacksReceived}`,
      `actionsTx=${s.actionsSent}`,
      `specialsTx=${s.specialsSent}`,
      `jumpsTx=${s.jumpIntentsSent}`,
      `local=(${formatNumber(s.lastLocalX, 1)},${formatNumber(s.lastLocalY, 1)})`,
      `remote=(${formatNumber(s.lastRemoteX, 1)},${formatNumber(s.lastRemoteY, 1)})`,
    ].join(" "),
  );

  clientNetTestState.summary = createEmptySummary();
  clientNetTestState.lastFlushAt = now;
}

export function isClientNetTestEnabled() {
  return clientNetTestState.enabled;
}

export function shouldMuteClientDefaultLogs() {
  return clientNetTestState.enabled;
}

export function configureClientNetTest({ label = "", username = "", matchId = "" } = {}) {
  if (!clientNetTestState.enabled) return;
  if (label) clientNetTestState.label = String(label);
  if (username) clientNetTestState.username = String(username);
  if (matchId) clientNetTestState.matchId = String(matchId);
  emitLine("start", `ts=${clientNetTestState.startedAt}`);
}

export function noteClientFrame(dtMs) {
  if (!clientNetTestState.enabled) return;
  const s = clientNetTestState.summary;
  const dt = Math.max(0, Number(dtMs) || 0);
  s.frames += 1;
  s.frameDtTotal += dt;
  if (dt > s.frameDtMax) s.frameDtMax = dt;
  if (dt >= 50) s.frameHitches50 += 1;
  if (dt >= 100) s.frameHitches100 += 1;
  flushClientNetTestSummary(false);
}

export function noteClientInputSent({
  now = Date.now(),
  previousState = null,
  currentState = null,
  previousSentAt = 0,
}) {
  if (!clientNetTestState.enabled) return;
  const s = clientNetTestState.summary;
  s.inputsSent += 1;
  const gap = previousSentAt > 0 ? Math.max(0, now - previousSentAt) : 0;
  if (gap > 0) {
    s.inputGapTotal += gap;
    s.inputGapCount += 1;
    if (gap > s.inputGapMax) s.inputGapMax = gap;
  }
  const dx =
    Number(currentState?.x) - Number(previousState?.x);
  const dy =
    Number(currentState?.y) - Number(previousState?.y);
  const dist = Math.hypot(Number.isFinite(dx) ? dx : 0, Number.isFinite(dy) ? dy : 0);
  if (dist > s.inputDistMax) s.inputDistMax = dist;
  if (gap > 0) {
    const speed = (dist * 1000) / gap;
    if (speed > s.inputSpeedMax) s.inputSpeedMax = speed;
    if (dist >= 60 || gap >= 90) {
      emitLine(
        "input-spike",
        `gap=${formatNumber(gap, 1)}ms dist=${formatNumber(dist, 1)}px x=${formatNumber(currentState?.x, 1)} y=${formatNumber(currentState?.y, 1)} anim=${String(currentState?.animation || "n/a")}`,
      );
    }
  }
  s.lastLocalX = Number(currentState?.x);
  s.lastLocalY = Number(currentState?.y);
}

export function noteClientIntentSent(intent = {}) {
  if (!clientNetTestState.enabled) return;
  const s = clientNetTestState.summary;
  if (!intent?.isJumping) return;
  s.jumpIntentsSent += 1;
  emitLine(
    "jump-tx",
    `seq=${Number(intent?.sequence) || -1} dir=${Number(intent?.direction) || 0}`,
  );
}

export function noteClientActionSent(kind, payload = {}) {
  if (!clientNetTestState.enabled) return;
  const s = clientNetTestState.summary;
  const normalizedKind = String(kind || payload?.type || "action");
  s.actionsSent += 1;
  if (normalizedKind.includes("special")) s.specialsSent += 1;
  emitLine(
    "action-tx",
    `type=${normalizedKind} x=${formatNumber(payload?.x, 1)} y=${formatNumber(payload?.y, 1)} dir=${formatNumber(payload?.direction, 0)}`,
  );
}

export function noteClientSnapshot(snapshot, ingest = {}) {
  if (!clientNetTestState.enabled) return;
  const s = clientNetTestState.summary;
  s.snapshots += 1;
  const gap = Math.max(0, Number(ingest?.spacingMs) || 0);
  if (gap > 0) {
    s.snapshotGapTotal += gap;
    s.snapshotGapCount += 1;
    if (gap > s.snapshotGapMax) s.snapshotGapMax = gap;
  }
  if (ingest?.lateSnapshot) s.lateSnapshots += 1;
  if (ingest?.outOfOrderTick) s.outOfOrderSnapshots += 1;
  const jumps = Array.isArray(ingest?.positionJumps) ? ingest.positionJumps : [];
  s.snapshotJumpCount += jumps.length;
  for (const jump of jumps) {
    const dist = Number(jump?.distance) || 0;
    if (dist > s.snapshotJumpMax) s.snapshotJumpMax = dist;
    emitLine(
      "snapshot-jump",
      `tick=${snapshot?.tickId ?? "?"} player=${jump?.name || "?"} dist=${formatNumber(dist, 1)}px dx=${formatNumber(jump?.dx, 1)} dy=${formatNumber(jump?.dy, 1)} to=(${formatNumber(jump?.nextX, 1)},${formatNumber(jump?.nextY, 1)})`,
    );
  }
  if (ingest?.lateSnapshot) {
    emitLine(
      "snapshot-late",
      `tick=${snapshot?.tickId ?? "?"} gap=${formatNumber(ingest?.spacingMs, 1)}ms interp=${formatNumber(ingest?.interpDelayMs, 1)}ms`,
    );
  }
  if (ingest?.outOfOrderTick) {
    emitLine(
      "snapshot-ooo",
      `tick=${snapshot?.tickId ?? "?"} prev=${ingest?.previousTickId ?? "?"}`,
    );
  }

  const username = clientNetTestState.username;
  if (username && snapshot?.players?.[username]) {
    s.lastRemoteX = Number(snapshot.players[username].x);
    s.lastRemoteY = Number(snapshot.players[username].y);
  }
}

export function noteClientRemoteAction(packet) {
  if (!clientNetTestState.enabled) return;
  const s = clientNetTestState.summary;
  s.actionsReceived += 1;
  const type = String(packet?.action?.type || "");
  if (type) s.attacksReceived += 1;
  emitLine(
    "action-rx",
    `player=${packet?.playerName || "?"} type=${type || "unknown"} origin=(${formatNumber(packet?.origin?.x, 1)},${formatNumber(packet?.origin?.y, 1)})`,
  );
}

export function noteClientLifecycle(kind, extra = "") {
  if (!clientNetTestState.enabled) return;
  emitLine(kind, extra);
}
