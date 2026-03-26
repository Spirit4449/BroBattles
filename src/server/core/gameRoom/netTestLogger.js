function isServerNetTestEnabled() {
  const value = String(process.env.NETTEST_LOGS || "").toLowerCase();
  return value === "1" || value === "true" || value === "on";
}

function createPlayerSummary() {
  return {
    inputs: 0,
    inputGapTotal: 0,
    inputGapCount: 0,
    inputGapMax: 0,
    inputDistMax: 0,
    inputSpeedMax: 0,
    inputClamps: 0,
    intents: 0,
    actions: 0,
    attacks: 0,
    specials: 0,
    lastInputAt: 0,
    lastX: null,
    lastY: null,
  };
}

function roomPrefix(room) {
  return `[NETTEST][server][match=${room.matchId}]`;
}

function playerPrefix(room, playerName) {
  return `${roomPrefix(room)}[player=${playerName}]`;
}

function emit(room, kind, text) {
  if (!room?._netTestEnabled) return;
  console.log(`${roomPrefix(room)}[${kind}] ${text}`);
}

function emitPlayer(room, playerName, kind, text) {
  if (!room?._netTestEnabled) return;
  console.log(`${playerPrefix(room, playerName)}[${kind}] ${text}`);
}

function ensurePlayerSummary(room, playerName) {
  if (!room._netTest) room._netTest = { lastFlushAt: Date.now(), players: new Map(), snapshots: 0 };
  let summary = room._netTest.players.get(playerName);
  if (!summary) {
    summary = createPlayerSummary();
    room._netTest.players.set(playerName, summary);
  }
  return summary;
}

function fmt(value, digits = 1) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(digits) : "n/a";
}

function noteRoomCreated(room) {
  if (!room?._netTestEnabled) return;
  emit(
    room,
    "start",
    `players=${Array.isArray(room.matchData?.players) ? room.matchData.players.length : 0} map=${room.matchData?.map ?? "?"} mode=${room.matchData?.modeId || room.matchData?.mode || "?"}`,
  );
}

function noteSnapshot(room, snapMono) {
  if (!room?._netTestEnabled) return;
  if (!room._netTest) room._netTest = { lastFlushAt: Date.now(), players: new Map(), snapshots: 0 };
  room._netTest.snapshots += 1;
  flushIfDue(room, snapMono);
}

function noteInput(room, playerData, now, delta) {
  if (!room?._netTestEnabled || !playerData?.name) return;
  const summary = ensurePlayerSummary(room, playerData.name);
  summary.inputs += 1;
  if (summary.lastInputAt > 0) {
    const gap = Math.max(0, now - summary.lastInputAt);
    summary.inputGapTotal += gap;
    summary.inputGapCount += 1;
    if (gap > summary.inputGapMax) summary.inputGapMax = gap;
    const dist = Math.hypot(Number(delta?.dx) || 0, Number(delta?.dy) || 0);
    if (dist > summary.inputDistMax) summary.inputDistMax = dist;
    if (gap > 0) {
      const speed = (dist * 1000) / gap;
      if (speed > summary.inputSpeedMax) summary.inputSpeedMax = speed;
    }
    if (dist >= 60 || gap >= 90) {
      emitPlayer(
        room,
        playerData.name,
        "input-spike",
        `gap=${fmt(gap, 1)}ms dist=${fmt(dist, 1)}px dx=${fmt(delta?.dx, 1)} dy=${fmt(delta?.dy, 1)} x=${fmt(playerData.x, 1)} y=${fmt(playerData.y, 1)}`,
      );
    }
  }
  summary.lastInputAt = now;
  summary.lastX = Number(playerData.x);
  summary.lastY = Number(playerData.y);
}

function noteInputClamp(room, playerData, details) {
  if (!room?._netTestEnabled || !playerData?.name) return;
  const summary = ensurePlayerSummary(room, playerData.name);
  summary.inputClamps += 1;
  emitPlayer(
    room,
    playerData.name,
    "input-clamp",
    `dx=${fmt(details?.absDX, 1)} maxDX=${fmt(details?.maxDX, 1)} dy=${fmt(details?.absDY, 1)} maxDY=${fmt(details?.maxDY, 1)} dt=${fmt(details?.dtMove, 1)}ms`,
  );
}

function noteIntent(room, playerData, intentData) {
  if (!room?._netTestEnabled || !playerData?.name) return;
  const summary = ensurePlayerSummary(room, playerData.name);
  summary.intents += 1;
  if (intentData?.isJumping) {
    emitPlayer(
      room,
      playerData.name,
      "intent-jump",
      `seq=${Number(intentData?.sequence) || -1} dir=${Number(intentData?.direction) || 0}`,
    );
  }
}

function noteAction(room, playerData, type) {
  if (!room?._netTestEnabled || !playerData?.name) return;
  const summary = ensurePlayerSummary(room, playerData.name);
  summary.actions += 1;
  const normalized = String(type || "");
  if (normalized) summary.attacks += 1;
  if (normalized.includes("special")) summary.specials += 1;
  emitPlayer(room, playerData.name, "action", `type=${normalized || "unknown"}`);
}

function flushIfDue(room, now = Date.now()) {
  if (!room?._netTestEnabled || !room._netTest) return;
  const elapsed = now - room._netTest.lastFlushAt;
  if (elapsed < 2000) return;
  emit(room, "summary", `sec=${fmt((Date.now() - room.startTime) / 1000, 1)} snaps=${room._netTest.snapshots}`);
  for (const [playerName, summary] of room._netTest.players.entries()) {
    const avgGap =
      summary.inputGapCount > 0 ? summary.inputGapTotal / summary.inputGapCount : 0;
    emitPlayer(
      room,
      playerName,
      "summary",
      [
        `inputs=${summary.inputs}`,
        `inputAvg=${fmt(avgGap, 1)}ms`,
        `inputMax=${fmt(summary.inputGapMax, 1)}ms`,
        `inputDistMax=${fmt(summary.inputDistMax, 1)}px`,
        `inputSpeedMax=${fmt(summary.inputSpeedMax, 1)}pxps`,
        `clamps=${summary.inputClamps}`,
        `intents=${summary.intents}`,
        `actions=${summary.actions}`,
        `specials=${summary.specials}`,
        `pos=(${fmt(summary.lastX, 1)},${fmt(summary.lastY, 1)})`,
      ].join(" "),
    );
    room._netTest.players.set(playerName, createPlayerSummary());
  }
  room._netTest.snapshots = 0;
  room._netTest.lastFlushAt = now;
}

module.exports = {
  isServerNetTestEnabled,
  noteRoomCreated,
  noteSnapshot,
  noteInput,
  noteInputClamp,
  noteIntent,
  noteAction,
  flushIfDue,
};

