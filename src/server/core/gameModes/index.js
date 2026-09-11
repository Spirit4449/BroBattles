const gameModesCatalog = require("../../../shared/gameModes.catalog.json");
const { DuelsGameMode } = require("./DuelsGameMode");
const { BankBustGameMode } = require("./bankBust/BankBustGameMode.js");
const { UnimplementedGameMode } = require("./UnimplementedGameMode");

const MODE_RUNTIMES = { duels: DuelsGameMode, 'bank-bust': BankBustGameMode };

const MODE_BY_ID = new Map(
  (Array.isArray(gameModesCatalog?.modes) ? gameModesCatalog.modes : []).map(
    (mode) => [String(mode?.id || ""), mode],
  ),
);

function createGameModeRuntime(room) {
  const modeId = String(room?.matchData?.modeId || "duels");
  const descriptor = MODE_BY_ID.get(modeId) || MODE_BY_ID.get("duels") || {};

  const Runtime = MODE_RUNTIMES[descriptor.runtimeClass] || UnimplementedGameMode;
  return new Runtime(room, descriptor);
}

module.exports = {
  createGameModeRuntime,
};
