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
   * Supplies objective details to the bot controller. bots/objectives.js
   * normalizes these fields and selects standard combat or Bank Bust planning.
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
