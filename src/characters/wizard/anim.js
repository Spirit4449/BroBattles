export function animations(scene) {
  const NAME = "wizard";
  if (!scene?.textures?.exists(NAME)) return;
  const tex = scene.textures.get(NAME);
  const allNames = (tex && tex.getFrameNames && tex.getFrameNames()) || [];
  if (!allNames.length) return;

  const findFrames = (candidates) => {
    const matched = [];
    for (const frame of allNames) {
      const lower = frame.toLowerCase();
      if (candidates.some((prefix) => lower.startsWith(prefix))) {
        matched.push(frame);
      }
    }
    matched.sort((a, b) => {
      const ra = /([0-9]+)(?!.*[0-9])/.exec(a);
      const rb = /([0-9]+)(?!.*[0-9])/.exec(b);
      if (ra && rb) return Number(ra[1]) - Number(rb[1]);
      return a.localeCompare(b);
    });
    return matched;
  };

  const ensureAnim = (key, prefixes, frameRate, repeat) => {
    if (scene.anims.exists(key)) return;
    const frames = findFrames(prefixes);
    if (!frames.length) return;
    scene.anims.create({
      key,
      frames: frames.map((f) => ({ key: NAME, frame: f })),
      frameRate,
      repeat,
    });
  };

  ensureAnim(`${NAME}-idle`, ["idle", "stand"], 6, -1);
  ensureAnim(`${NAME}-running`, ["run", "walk", "move"], 14, -1);
  ensureAnim(`${NAME}-jumping`, ["jump"], 18, 0);
  ensureAnim(`${NAME}-falling`, ["fall"], 18, 0);
  ensureAnim(`${NAME}-sliding`, ["wall", "slide", "sliding"], 20, 2);
  ensureAnim(`${NAME}-throw`, ["throw", "attack"], 17, 0);
  ensureAnim(`${NAME}-dying`, ["death", "die"], 10, 0);
}
