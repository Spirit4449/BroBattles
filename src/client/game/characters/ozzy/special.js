import { characterDefinitions } from "../../../../shared/characters/index.js";
import { actionElapsedMs, playSpriteAnimation } from "../shared/animationState.js";
import { playPlayerSound } from "../../audio/playerAudio";
import { playOzzySuperCast } from "./superCast";

// Runs on every client for the caster (local owner and remote viewers alike);
// the teammate beams arrive separately with `ozzy:arcane-surge`. The owner's
// pose already started on the key press, so this continues it rather than
// restarting it, and the cast effect joins at the pose's current frame.

const { key: NAME } = characterDefinitions.ozzy;

export function perform({ scene, player, isOwner = false }) {
  if (!scene || !player) return;
  playSpriteAnimation({
    scene,
    sprite: player,
    character: NAME,
    logical: "special",
    fallback: "throw",
    remote: !isOwner,
  });
  try {
    playPlayerSound(scene, player, "ozzy-special");
  } catch (_) {}
  playOzzySuperCast(scene, player, { elapsedMs: actionElapsedMs(player, "special") });
}
