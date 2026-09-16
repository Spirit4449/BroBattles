import { createAnimationBuilder } from '../shared/animationBuilder';
export function animations(scene) {
  const NAME = "gloop";
  if (!scene?.textures?.exists(NAME)) return;

  const { make } = createAnimationBuilder(scene, NAME);

  // Breathe out through the same poses, avoiding the largest-to-smallest jump.
  make(`${NAME}-idle`, "idle", 8, -1,
    [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1].map(i => `idle0${i}`));
  make(`${NAME}-running`, ["run", "running", "walk"], 16, -1);
  make(`${NAME}-jumping`, ["jump", "jumping"], 10, 0);
  make(`${NAME}-falling`, ["fall", "falling"], 10, 0);
  make(`${NAME}-sliding`, ["wall", "slide", "sliding"], 8, -1);
  make(`${NAME}-throw`, ["attack", "throw"], 18, 0);
  make(`${NAME}-special`, ["special", "attack", "throw"], 18, 0);
  make(`${NAME}-dying`, ["die", "dying", "death", "dead"], 10, 0);
}
