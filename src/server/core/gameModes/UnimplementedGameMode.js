const { BaseGameMode } = require("./BaseGameMode");

class UnimplementedGameMode extends BaseGameMode {
  buildModeState() {
    return {
      type: "unimplemented",
      modeId: this.modeId,
      modeVariantId: this.modeVariantId,
    };
  }
}

module.exports = { UnimplementedGameMode };
