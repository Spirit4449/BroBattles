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
  make(`${NAME}-throw`, ["attack", "throw"], 24, 0);
  // Hold the drawn bow, snap the release, then recover without a long aura.
  make(`${NAME}-special`, ["special", "attack", "throw"], 20, 0,
    ["attack00", "attack01", "attack02", "attack02", "attack03", "attack04", "attack05"]);
  make(`${NAME}-dying`, ["die", "dying", "death", "dead"], 10, 0);
}
