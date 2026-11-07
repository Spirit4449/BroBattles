import { createAnimationBuilder } from "../shared/animationBuilder";
import { THORG_SWEEP, THORG_ATTACK_FRAMES } from "../../../../shared/characters/thorgSweep";
import movementPhysics from "../../../../shared/physics/movementPhysics.json";

export function animations(scene, NAME = "thorg") {
  const { make, getFrame, findFrames } = createAnimationBuilder(scene, NAME);
  const makeSweep = () => {
    if (scene.anims.exists(`${NAME}-throw`)) return;
    const ordered = findFrames("throw").map((n) => getFrame(n)).filter(Boolean);
    if (!ordered.length) return;

    // Phaser adds per-frame duration to its base interval. A single total
    // duration keeps the video poses on the shared weapon sweep clock.
    const animation = scene.anims.create({
      key: `${NAME}-throw`,
      frames: ordered.map((f, index) => ({
        key: NAME,
        frame: f,
        duration: THORG_ATTACK_FRAMES[index].durationMs - 1,
      })),
      frameRate: 1000,
      repeat: 0,
    });
    // Phaser's duration omits frame-specific additions. Expose the complete
    // duration to shared animation locks while retaining its base frame clock.
    if (animation)
      animation.duration = THORG_SWEEP.windupMs + THORG_SWEEP.strikeMs + THORG_SWEEP.recoveryMs;
  };

  make(`${NAME}-running`, ["running", "run"], 16, -1);
  make(`${NAME}-idle`, ["idle", "stand", "idle_"], 4, -1);
  make(`${NAME}-jumping`, ["jumping", "jump"], 24, 0);
  // Thorg only has a single sliding frame, so keep it held instead of
  // letting the non-looping animation complete and disappear between updates.
  make(`${NAME}-sliding`, ["wall", "slide", "sliding"], 10, -1);
  // The video's first falling frame is the exact final jump pose.
  make(`${NAME}-falling`, ["falling"], 8, -1);
  make(`${NAME}-powerup`, ["powerup"], 18, 0);
  make(`${NAME}-special`, ["powerup"], 18, 0);
  make(`${NAME}-ducking`, ["duck"], 1, -1);
  for (const direction of ["dashright", "dashdiagonal", "dashup"]) {
    make(`${NAME}-${direction}`, [direction], 3 * 1000 / movementPhysics.dashDurationMs, 0);
  }
  makeSweep();
  make(`${NAME}-dying`, ["dying", "death", "dead"], 28 / 3, 0);
}
