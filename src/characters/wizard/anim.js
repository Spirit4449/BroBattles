import { createAnimationBuilder } from '../shared/animationBuilder';
export function animations(scene) {
  const NAME = "wizard";
  if (!scene?.textures?.exists(NAME)) return;
  const { make: ensureAnim, findFrames } = createAnimationBuilder(scene, NAME);

  const ensureOrderedAttack = () => {
    if (scene.anims.exists(`${NAME}-throw`)) return;
    const frames = findFrames(["attack", "throw"]);
    if (!frames.length) return;
    scene.anims.create({
      key: `${NAME}-throw`,
      frames: frames.map((f, index) => ({
        key: NAME,
        frame: f,
        // Hold the later cast frames slightly longer so the release reads clearly.
        duration: index >= frames.length - 2 ? 80 : 58,
      })),
      frameRate: 18,
      repeat: 0,
    });
  };
  const ensureAuraAnim = () => {
    const auraKey = `${NAME}-aura-loop`;
    if (scene.anims.exists(auraKey) || !scene.textures?.exists("wizard-aura")) {
      return;
    }
    const auraTex = scene.textures.get("wizard-aura");
    const auraNames =
      (auraTex && auraTex.getFrameNames && auraTex.getFrameNames()) || [];
    const frames = auraNames
      .filter((frame) => /^aura/i.test(String(frame)))
      .sort((a, b) => {
        const ra = /([0-9]+)(?!.*[0-9])/.exec(a);
        const rb = /([0-9]+)(?!.*[0-9])/.exec(b);
        if (ra && rb) return Number(ra[1]) - Number(rb[1]);
        return String(a).localeCompare(String(b));
      });
    if (!frames.length) return;
    scene.anims.create({
      key: auraKey,
      frames: frames.map((frame) => ({
        key: "wizard-aura",
        frame,
      })),
      frameRate: 10,
      repeat: 0,
    });
  };

  ensureAnim(`${NAME}-idle`, ["idle", "stand"], 6, -1);
  ensureAnim(`${NAME}-running`, ["run", "walk", "move"], 18, -1);
  ensureAnim(`${NAME}-special`, ["special"], 12, 0);
  ensureAnim(`${NAME}-jumping`, ["jump"], 18, 0);
  ensureAnim(`${NAME}-falling`, ["fall"], 18, 0);
  ensureAnim(`${NAME}-sliding`, ["sing", "slide", "sliding"], 20, 2);
  ensureOrderedAttack();
  ensureAuraAnim();
  ensureAnim(`${NAME}-dying`, ["dying", "death", "die"], 10, 0);
}
