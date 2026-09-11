import { createAnimationBuilder } from '../shared/animationBuilder';
export function animations(scene) {
  const NAME = "huntress";
  if (!scene?.textures?.exists(NAME)) return;

  const { make } = createAnimationBuilder(scene, NAME);

  make(`${NAME}-idle`, ["idle", "stand"], 8, -1);
  make(`${NAME}-running`, ["run", "running", "walk"], 18, -1);
  make(`${NAME}-jumping`, ["jump", "jumping"], 14, 0);
  make(`${NAME}-falling`, ["fall", "falling"], 14, 0);
  make(`${NAME}-sliding`, ["slide", "sliding", "wall"], 6, 2);
  make(`${NAME}-throw`, ["attack", "throw"], 20, 0);
  make(`${NAME}-special`, ["special", "attack", "throw"], 18, 0);
  make(`${NAME}-dying`, ["die", "dying", "death", "dead"], 10, 0);
}
