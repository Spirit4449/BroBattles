import { getResolvedCharacterSpecialConfig } from "../../../../shared/characters/characterTuning.js";
import { aimFacesLeft, faceAttack } from "../shared/flipLock";

const SWARM = getResolvedCharacterSpecialConfig("ninja", "swarm");
// Tuning lives in src/shared/characters/ninja.json (special.swarm).
const SWARM_LOCK_MS = SWARM.count * SWARM.releaseMs + SWARM.lockPaddingMs;

// The shards themselves are server projectiles drawn by ninja/network.js.
export function perform(
  scene,
  player,
  playersInTeam,
  opponentPlayers,
  username,
  gameId,
  isOwner = false,
  specialData = null,
) {
  // Face the aim (left or right) for the whole barrage. The owner already
  // turned on the key press (predictNinja); this covers remote viewers and
  // re-holds the facing for the full release.
  if (player) faceAttack(scene, player, aimFacesLeft(specialData, player.flipX), SWARM_LOCK_MS);
}
