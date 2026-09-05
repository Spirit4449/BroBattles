class BaseGameMode {
  constructor(room, descriptor = {}) {
    this.room = room;
    this.descriptor = descriptor || {};
    this.modeId = String(room?.matchData?.modeId || descriptor?.id || "duels");
    this.modeVariantId = room?.matchData?.modeVariantId || null;
  }

  getModeState() {
    if (!this.room) return null;
    if (this.room.modeState == null) {
      this.room.modeState = this.createRoomState();
    }
    return this.room.modeState;
  }

  createRoomState() {
    return null;
  }

  validateSelection() {
    return { ok: true };
  }

  onStart() {}

  tick() {}

  handlePlayerAction() {
    return { handled: false };
  }

  getMatchDurationMs() {
    return null;
  }

  supportsSuddenDeath() {
    return true;
  }

  onTimerExpired() {
    return this.evaluateVictoryState();
  }

  onPlayerDeath() {
    return { shouldCheckVictory: true };
  }

  getRespawnPlan() {
    return null;
  }

  evaluateVictoryState() {
    return null;
  }

  buildModeState() {
    return null;
  }

  /**
   * Describes what a bot will eventually optimize for in this mode.
   *
   * BotController currently records this directive for observability only and
   * deliberately continues to use its existing combat/navigation tactics.
   * Modes can add a goal, target, or interaction here as their objective AI is
   * implemented without coupling that knowledge to the generic bot runtime.
   */
  getBotObjective(playerData) {
    const objective = this.descriptor?.botObjective || {};
    return {
      kind: String(objective.kind || "eliminate-opponents"),
      label: String(objective.label || "Eliminate opponents"),
      team: playerData?.team || null,
      targetTeam: null,
      target: null,
      goal: null,
      interaction: null,
    };
  }
}

module.exports = { BaseGameMode };
