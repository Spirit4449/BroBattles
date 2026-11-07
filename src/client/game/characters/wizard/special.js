import { actionElapsedMs, playSpriteAnimation } from "../shared/animationState.js";
import { playPlayerSound } from "../../audio/playerAudio";
import { playWizardSuperCast } from "./superCast";

// Runs on every client for the caster (local owner and remote viewers alike);
// the teammate beams arrive separately with `wizard:arcane-surge`. The owner's
// pose already started on the key press, so this continues it rather than
// restarting it, and the cast effect joins at the pose's current frame.
export function perform(
  scene,
  player,
  playersInTeam,
  opponentPlayers,
  username,
  gameId,
  isOwner = false,
) {
  if (!scene || !player) return;
  playSpriteAnimation({
    scene,
    sprite: player,
    character: "wizard",
    logical: "special",
    fallback: "throw",
    remote: !isOwner,
  });
  try {
    playPlayerSound(scene, player, "wizard-special", {
      volume: 0.5,
      rate: 1,
    });
  } catch (_) {}
  playWizardSuperCast(scene, player, { elapsedMs: actionElapsedMs(player, "special") });
}
