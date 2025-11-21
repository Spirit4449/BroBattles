import * as NinjaSpecial from "./ninja/special";

const specials = {
  ninja: NinjaSpecial,
};

export function performSpecial(
  character,
  scene,
  player,
  playersInTeam,
  opponentPlayers,
  username,
  gameId,
  isOwner = false
) {
  const module = specials[character];
  if (module && typeof module.perform === "function") {
    module.perform(
      scene,
      player,
      playersInTeam,
      opponentPlayers,
      username,
      gameId,
      isOwner
    );
  } else {
    console.warn(`No special attack defined for ${character}`);
  }
}
