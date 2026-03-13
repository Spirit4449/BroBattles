export function animations(scene) {
  const NAME = "thorg";
  const tex = scene.textures.get(NAME);
  const allNames = (tex && tex.getFrameNames()) || [];
  const lower = new Map(allNames.map((n) => [n.toLowerCase(), n]));

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

  // Try reasonable prefix variants for robustness across atlases
  make(`${NAME}-running`, ["running", "run"], 9, 0);
  make(`${NAME}-idle`, ["idle", "stand", "idle_"], 3, -1);
  make(`${NAME}-jumping`, ["jumping", "jump"], 7, 0);
  make(`${NAME}-sliding`, ["wall", "slide", "sliding"], 20, 2);
  make(`${NAME}-falling`, ["falling", "fall"], 8, 0);
  make(`${NAME}-throw`, ["throw", "attack", "attack_throw"], 7, 0);
  make(`${NAME}-dying`, ["dying", "death", "dead"], 10, 0);
}
