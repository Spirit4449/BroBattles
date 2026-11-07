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
  // The super charges with the staff raised, plants it, then flickers between
  // the two blast frames through the cast lock instead of freezing on one.
  // superCast.js times its effect to these frames.
  const ensureSpecialAnim = () => {
    if (scene.anims.exists(`${NAME}-special`)) return;
    const frames = findFrames(["special"]);
    if (frames.length < 6) return ensureAnim(`${NAME}-special`, ["special"], 12, 0);
    const order = [0, 1, 2, 3, 4, 5];
    const ms = [110, 110, 110, 90, 100, 100];
    for (let i = 0; i < 10; i++) { order.push(i % 2 ? 5 : 4); ms.push(110); }
    const BASE_MS = 20; // Phaser adds each frame's duration to 1000 / frameRate.
    scene.anims.create({
      key: `${NAME}-special`,
      frames: order.map((index, i) => ({ key: NAME, frame: frames[index], duration: ms[i] - BASE_MS })),
      frameRate: 1000 / BASE_MS,
      repeat: 0,
    });
  };

  ensureAnim(`${NAME}-idle`, ["idle", "stand"], 6, -1);
  ensureAnim(`${NAME}-running`, ["run", "walk", "move"], 18, -1);
  ensureAnim(`${NAME}-jumping`, ["jump"], 18, 0);
  ensureAnim(`${NAME}-falling`, ["fall"], 18, 0);
  ensureAnim(`${NAME}-sliding`, ["sing", "slide", "sliding"], 20, 2);
  ensureOrderedAttack();
  ensureSpecialAnim();
  ensureAnim(`${NAME}-dying`, ["dying", "death", "die"], 10, 0);
}
