export function animations(scene) {
  const NAME = "gloop";
  if (!scene?.textures?.exists(NAME)) return;

  const tex = scene.textures.get(NAME);
  const allNames = (tex && tex.getFrameNames && tex.getFrameNames()) || [];
  if (!allNames.length) return;

  const findFrames = (prefixes) => {
    const wanted = Array.isArray(prefixes) ? prefixes : [prefixes];
    return allNames
      .filter((frame) => {
        const lower = String(frame || "").toLowerCase();
        return wanted.some((prefix) => lower.startsWith(prefix));
      })
      .sort((a, b) => {
        const ra = /([0-9]+)(?!.*[0-9])/.exec(a);
        const rb = /([0-9]+)(?!.*[0-9])/.exec(b);
        if (ra && rb) return Number(ra[1]) - Number(rb[1]);
        return String(a).localeCompare(String(b));
      });
  };

  const make = (key, prefixes, frameRate, repeat) => {
    if (scene.anims.exists(key)) return;
    const frames = findFrames(prefixes);
    if (!frames.length) return;
    scene.anims.create({
      key,
      frames: frames.map((frame) => ({ key: NAME, frame })),
      frameRate,
      repeat,
    });
  };

  make(`${NAME}-idle`, "idle", 8, -1);
  make(`${NAME}-running`, ["run", "running", "walk"], 16, -1);
  make(`${NAME}-jumping`, ["jump", "jumping"], 10, 0);
  make(`${NAME}-falling`, ["fall", "falling"], 10, 0);
  make(`${NAME}-sliding`, ["fall", "slide", "sliding"], 8, 0);
  make(`${NAME}-throw`, ["attack", "throw"], 18, 0);
  make(`${NAME}-special`, ["special", "attack", "throw"], 18, 0);
  make(`${NAME}-dying`, ["die", "dying", "death", "dead"], 10, 0);
}
