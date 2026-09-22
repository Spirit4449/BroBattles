import { createAnimationBuilder } from "../shared/animationBuilder";
import { THORG_SWEEP, THORG_ATTACK_FRAMES } from "../../shared/thorgSweep";

export function animations(scene, NAME = "thorg") {
  const { make, getFrame, findFrames } = createAnimationBuilder(scene, NAME);
  const videoFrames =
    scene.textures.get(NAME)?.customData?.meta?.bbVideoFrames === true;

  const makeSweep = () => {
    const ordered = (
      videoFrames
        ? findFrames("throw")
        : ["throw00", "throw01", "throw02", "throw03", "throw04"]
    )
      .map((n) => getFrame(n))
      .filter(Boolean);
    if (scene.anims.exists(`${NAME}-throw`)) {
      scene.anims.remove(`${NAME}-throw`);
    }
    if (!ordered.length) return;

    // Phaser adds per-frame duration to its base interval. A single total
    // duration keeps the video poses on the shared weapon sweep clock.
    const animation = scene.anims.create({
      key: `${NAME}-throw`,
      frames: ordered.map((f, index) => ({
        key: NAME,
        frame: f,
        ...(videoFrames
          ? {
              duration: THORG_ATTACK_FRAMES[index].durationMs - 1,
            }
          : {}),
      })),
      ...(videoFrames
        ? { frameRate: 1000 }
        : { duration: THORG_SWEEP.windupMs + THORG_SWEEP.strikeMs + THORG_SWEEP.recoveryMs }),
      repeat: 0,
    });
    // Phaser's duration omits frame-specific additions. Expose the complete
    // duration to shared animation locks while retaining its base frame clock.
    if (videoFrames && animation)
      animation.duration = THORG_SWEEP.windupMs + THORG_SWEEP.strikeMs + THORG_SWEEP.recoveryMs;
  };

  // Try reasonable prefix variants for robustness across atlases
  // Video run poses are already ordered through one complete stride cycle.
  make(
    `${NAME}-running`,
    ["running", "run"],
    videoFrames ? 16 : 8,
    -1,
    videoFrames
      ? undefined
      : [
          "running01",
          "running00",
          "running03",
          "running04",
          "running02",
          "running05",
        ],
  );
  make(`${NAME}-idle`, ["idle", "stand", "idle_"], videoFrames ? 4 : 6, -1);
  make(`${NAME}-jumping`, ["jumping", "jump"], videoFrames ? 24 : 16, 0);
  // Thorg only has a single sliding frame, so keep it held instead of
  // letting the non-looping animation complete and disappear between updates.
  make(`${NAME}-sliding`, ["wall", "slide", "sliding"], 10, -1);
  // The video's first falling frame is the exact final jump pose.
  make(
    `${NAME}-falling`,
    videoFrames ? ["falling"] : ["falling00", "falling01"],
    videoFrames ? 8 : 5,
    -1,
  );
  make(`${NAME}-powerup`, ["powerup"], videoFrames ? 18 : 10, 0);
  make(`${NAME}-special`, ["powerup"], videoFrames ? 18 : 10, 0);
  make(`${NAME}-ducking`, ["duck"], 1, -1);
  makeSweep();
  make(`${NAME}-dying`, ["dying", "death", "dead"], videoFrames ? 28 / 3 : 10, 0);
}
