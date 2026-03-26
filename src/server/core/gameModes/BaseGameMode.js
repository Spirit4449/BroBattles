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
}

module.exports = { BaseGameMode };
