const gameModesCatalog = require("../../../shared/gameModes.catalog.json");
const { DuelsGameMode } = require("./DuelsGameMode");
const { BankBustGameMode } = require("./BankBustGameMode");
const { UnimplementedGameMode } = require("./UnimplementedGameMode");

const MODE_BY_ID = new Map(
  (Array.isArray(gameModesCatalog?.modes) ? gameModesCatalog.modes : []).map(
    (mode) => [String(mode?.id || ""), mode],
  ),
);

function createGameModeRuntime(room) {
  const modeId = String(room?.matchData?.modeId || "duels");
  const descriptor = MODE_BY_ID.get(modeId) || MODE_BY_ID.get("duels") || {};

  if (String(descriptor?.runtimeClass || "") === "duels") {
    return new DuelsGameMode(room, descriptor);
  }
  if (String(descriptor?.runtimeClass || "") === "bank-bust") {
    return new BankBustGameMode(room, descriptor);
  }

  return new UnimplementedGameMode(room, descriptor);
}

module.exports = {
  createGameModeRuntime,
};
