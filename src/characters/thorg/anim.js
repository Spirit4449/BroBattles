export function animations(scene) {
  const NAME = "thorg";
  const tex = scene.textures.get(NAME);
  const allNames = (tex && tex.getFrameNames()) || [];
  const lower = new Map(allNames.map((n) => [n.toLowerCase(), n]));

  const getFrame = (name) => lower.get(String(name).toLowerCase()) || null;

  const findFrames = (candidates) => {
    // candidates: array of lowercase prefixes to try (e.g., ["running", "run"])
    // Return sorted frame names by numeric suffix when present.
    const matched = [];
    for (const name of allNames) {
      const ln = name.toLowerCase();
      if (candidates.some((p) => ln.startsWith(p))) {
        matched.push(name);
      }
    }
    // Sort by trailing number if any, else lexicographically
    matched.sort((a, b) => {
      const ra = /(\d+)(?=\D*$)/.exec(a);
      const rb = /(\d+)(?=\D*$)/.exec(b);
      if (ra && rb) return parseInt(ra[1], 10) - parseInt(rb[1], 10);
      return a.localeCompare(b);
    });
    return matched;
  };

  const make = (key, prefixes, frameRate, repeat) => {
    if (scene.anims.exists(key)) return; // don't duplicate
    const frames = findFrames(prefixes);
    if (!frames.length) return; // skip if not present
    scene.anims.create({
      key,
      frames: frames.map((f) => ({ key: NAME, frame: f })),
      frameRate,
      repeat,
    });
  };

  const makeThrowLiftSlam = () => {
    const ordered = ["throw00", "throw01", "throw02", "throw03", "throw04"]
      .map((n) => getFrame(n))
      .filter(Boolean);
    if (scene.anims.exists(`${NAME}-throw`)) {
      scene.anims.remove(`${NAME}-throw`);
    }
    if (!ordered.length) return;

    // Hold the lift frames longer, then accelerate through the downswing.
    const durations = [150, 100, 95, 100, 100];
    scene.anims.create({
      key: `${NAME}-throw`,
      frames: ordered.map((f, i) => ({
        key: NAME,
        frame: f,
        duration: durations[Math.min(i, durations.length - 1)],
      })),
      frameRate: 10,
      repeat: 0,
    });
  };

  // Try reasonable prefix variants for robustness across atlases
  make(`${NAME}-running`, ["running", "run"], 9, 0);
  make(`${NAME}-idle`, ["idle", "stand", "idle_"], 3, -1);
  make(`${NAME}-jumping`, ["jumping", "jump"], 7, 0);
  // Thorg only has a single sliding frame, so keep it held instead of
  // letting the non-looping animation complete and disappear between updates.
  make(`${NAME}-sliding`, ["wall", "slide", "sliding"], 10, -1);
  make(`${NAME}-falling`, ["falling", "fall"], 8, 0);
  makeThrowLiftSlam();
  make(`${NAME}-dying`, ["dying", "death", "dead"], 10, 0);
}
