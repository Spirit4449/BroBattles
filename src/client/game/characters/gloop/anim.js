import movementPhysics from '../../../../shared/physics/movementPhysics.json';
import { createAnimationBuilder } from '../shared/animationBuilder';
export function animations(scene) {
  const NAME = "gloop";
  if (!scene?.textures?.exists(NAME)) return;

  const { make, findFrames } = createAnimationBuilder(scene, NAME);

  // Breathe out through the same poses, avoiding the largest-to-smallest jump.
  make(`${NAME}-idle`, "idle", 4, -1,
    [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1].map(i => `idle0${i}`));
  // One roll covers roughly two body widths; playback scales with actual speed.
  const runningFrames = findFrames(["run", "running", "walk"]);
  make(`${NAME}-running`, ["run", "running", "walk"], runningFrames.length * movementPhysics.maxSpeed / (47 * 1.2 * 2), -1);
  for (const direction of ['dashright', 'dashdiagonal', 'dashup']) {
    const frames = findFrames(direction);
    if (frames.length) make(`${NAME}-${direction}`, direction,
      frames.length * 1000 / movementPhysics.dashDurationMs, 0);
  }
  make(`${NAME}-jumping`, ["jump", "jumping"], 10, 0);
  make(`${NAME}-falling`, ["fall", "falling"], 10, 0);
  make(`${NAME}-sliding`, ["wall", "slide", "sliding"], 8, -1);
  make(`${NAME}-throw`, ["attack", "throw"], 18, 0);
  make(`${NAME}-special`, ["special", "attack", "throw"], 18, 0);
  // Metadata keeps physics-driven playback restricted to this authored atlas.
  for (const [suffix, motion] of Object.entries({
    running: { kind: 'running', speed: movementPhysics.maxSpeed },
    jumping: { kind: 'jumping', speed: movementPhysics.jumpSpeed },
    falling: { kind: 'falling', speed: movementPhysics.jumpSpeed },
  })) {
    const animation = scene.anims.get?.(`${NAME}-${suffix}`);
    if (animation) animation.bbMotion = motion;
  }
  make(`${NAME}-dying`, ["die", "dying", "death", "dead"], 10, 0);
}
