import * as NinjaSpecial from "./ninja/special";
import * as ThorgSpecial from "./thorg/special";
import * as DravenSpecial from "./draven/special";
import * as WizardSpecial from "./wizard/special";
import * as HuntressSpecial from "./huntress/special";
import * as GloopSpecial from "./gloop/special";

const specials = {
  ninja: NinjaSpecial,
  thorg: ThorgSpecial,
  draven: DravenSpecial,
  wizard: WizardSpecial,
  huntress: HuntressSpecial,
  gloop: GloopSpecial,
};

export function performSpecial(
  character,
  scene,
  player,
  playersInTeam,
  opponentPlayers,
  username,
  gameId,
  isOwner = false,
  specialData = null,
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
      isOwner,
      specialData,
    );
  } else {
    console.warn(`No special attack defined for ${character}`);
  }
}
