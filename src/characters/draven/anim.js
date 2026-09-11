import { createAnimationBuilder } from '../shared/animationBuilder';
export function animations(scene) {
  const NAME = "draven";
  const { make } = createAnimationBuilder(scene, NAME);

  // Try reasonable prefix variants for robustness across atlases
  make(`${NAME}-running`, ["running", "run"], 15, 0);
  make(`${NAME}-idle`, ["idle", "stand", "idle_"], 2, -1);
  make(`${NAME}-jumping`, ["jumping", "jump"], 15, 0);
  make(`${NAME}-sliding`, ["wall", "slide", "sliding"], 20, 2);
  make(`${NAME}-falling`, ["falling", "fall"], 10, 0);
  make(`${NAME}-throw`, ["throw", "attack", "attack_throw"], 16, 0);
  make(`${NAME}-special`, ["special", "ultimate", "ult"], 12, -1);
  make(`${NAME}-dying`, ["dying", "death", "dead"], 10, 0);
}
