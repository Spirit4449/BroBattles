import { createAnimationBuilder } from '../shared/animationBuilder';
export function animations(scene) {
  const NAME = "gloop";
  if (!scene?.textures?.exists(NAME)) return;

  const { make } = createAnimationBuilder(scene, NAME);

  make(`${NAME}-idle`, "idle", 8, -1);
  make(`${NAME}-running`, ["run", "running", "walk"], 16, -1);
  make(`${NAME}-jumping`, ["jump", "jumping"], 10, 0);
  make(`${NAME}-falling`, ["fall", "falling"], 10, 0);
  make(`${NAME}-sliding`, ["fall", "slide", "sliding"], 8, 0);
  make(`${NAME}-throw`, ["attack", "throw"], 18, 0);
  make(`${NAME}-special`, ["special", "attack", "throw"], 18, 0);
  make(`${NAME}-dying`, ["die", "dying", "death", "dead"], 10, 0);
}
