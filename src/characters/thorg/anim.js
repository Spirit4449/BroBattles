import { createAnimationBuilder } from '../shared/animationBuilder';
import { THORG_SWEEP } from "../../shared/thorgSweep";

export function animations(scene) {
  const NAME = "thorg";
  const { make, getFrame } = createAnimationBuilder(scene, NAME);

  const makeSweep = () => {
    const ordered = ["throw00", "throw01", "throw02", "throw03", "throw04"]
      .map((n) => getFrame(n))
      .filter(Boolean);
    if (scene.anims.exists(`${NAME}-throw`)) {
      scene.anims.remove(`${NAME}-throw`);
    }
    if (!ordered.length) return;

    // Phaser adds per-frame duration to its base interval. A single total
    // duration keeps the forearm poses on the shared weapon sweep clock.
    scene.anims.create({
      key: `${NAME}-throw`,
      frames: ordered.map((f) => ({
        key: NAME,
        frame: f,
      })),
      duration: THORG_SWEEP.windupMs + THORG_SWEEP.strikeMs + 100,
      repeat: 0,
    });
  };

  // Try reasonable prefix variants for robustness across atlases
  // Alternate lifted strides and planted contact poses, including the loop seam.
  make(`${NAME}-running`, ["running", "run"], 8, -1,
    ["running01", "running00", "running03", "running04", "running02", "running05"]);
  make(`${NAME}-idle`, ["idle", "stand", "idle_"], 6, -1);
  make(`${NAME}-jumping`, ["jumping", "jump"], 16, 0);
  // Thorg only has a single sliding frame, so keep it held instead of
  // letting the non-looping animation complete and disappear between updates.
  make(`${NAME}-sliding`, ["wall", "slide", "sliding"], 10, -1);
  // Keep both hands raised and gently alternate the two airborne poses.
  make(`${NAME}-falling`, ["falling00", "falling01"], 6, -1);
  make(`${NAME}-powerup`, ["powerup"], 10, 0);
  make(`${NAME}-special`, ["powerup"], 10, 0);
  make(`${NAME}-ducking`, ["duck"], 1, -1);
  makeSweep();
  make(`${NAME}-dying`, ["dying", "death", "dead"], 10, 0);
}
