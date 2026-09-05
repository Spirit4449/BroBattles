const BOT_OBJECTIVE_SCHEMA_VERSION = 1;
const DEFAULT_OBJECTIVE_KIND = "eliminate-opponents";

function finitePoint(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function normalizeTarget(target) {
  if (!target || typeof target !== "object") return null;
  const position = finitePoint(target);
  return {
    id: target.id == null ? null : String(target.id),
    type: target.type == null ? null : String(target.type),
    team: target.team == null ? null : String(target.team),
    ...(position || {}),
  };
}

function normalizeBotObjective(room, player, objective = {}) {
  return {
    schemaVersion: BOT_OBJECTIVE_SCHEMA_VERSION,
    modeId: String(room?.gameMode?.modeId || room?.matchData?.modeId || "duels"),
    kind: String(objective?.kind || DEFAULT_OBJECTIVE_KIND),
    label: String(objective?.label || "Eliminate opponents"),
    team: objective?.team ?? player?.team ?? null,
    targetTeam: objective?.targetTeam ?? null,
    target: normalizeTarget(objective?.target),
    goal: finitePoint(objective?.goal),
    interaction:
      objective?.interaction == null ? null : String(objective.interaction),

    // Objective directives are intentionally informational for now. A future
    // planner can opt into them without changing today's bot behavior.
    behavior: "standard-combat",
  };
}

function resolveBotObjective(room, player, context = {}) {
  const objective = room?.gameMode?.getBotObjective?.(player, context) || {};
  return normalizeBotObjective(room, player, objective);
}

module.exports = {
  BOT_OBJECTIVE_SCHEMA_VERSION,
  DEFAULT_OBJECTIVE_KIND,
  normalizeBotObjective,
  resolveBotObjective,
};
