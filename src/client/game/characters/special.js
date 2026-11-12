import * as NinjaSpecial from "./ninja/special";
import * as ThorgSpecial from "./thorg/special";
import * as DravenSpecial from "./draven/special";
import * as OzzySpecial from "./ozzy/special";
import * as SparrowSpecial from "./sparrow/special";
import * as GloopSpecial from "./gloop/special";

const specials = {
  ninja: NinjaSpecial,
  thorg: ThorgSpecial,
  draven: DravenSpecial,
  ozzy: OzzySpecial,
  sparrow: SparrowSpecial,
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
    if (player) player._superBarLaunch = (player._superBarLaunch || 0) + 1;
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
