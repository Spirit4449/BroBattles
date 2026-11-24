import { characterDefinitions } from "../../../../shared/characters/index.js";
import { playSpriteAnimation } from "../shared/animationState.js";
import { playPlayerSound } from "../../audio/playerAudio";
import { playSurgeOrbit } from "./surgeFusion";

// Runs on every client for the caster (local owner and remote viewers alike);
// the teammate beams arrive separately with `ozzy:arcane-surge`. The owner's
// pose already started on the key press, so this continues it rather than
// restarting it. The cast's flames are drawn into the pose itself
// (characters/ozzy/anim.js).

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
  // Every powerup the surge can grant circles him from the book strike until
  // they fuse on the staff (surgeFusion.js).
  playSurgeOrbit(scene, player);
  try {
    playPlayerSound(scene, player, "ozzy-special");
  } catch (_) {}
}
