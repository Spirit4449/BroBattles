import { THORG_SWEEP } from "../../shared/thorgSweep";

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

  const make = (key, prefixes, frameRate, repeat, order) => {
    if (scene.anims.exists(key)) return; // don't duplicate
    const found = findFrames(prefixes);
    const frames = order && order.every((name) => getFrame(name))
      ? order.map(getFrame) : found;
    if (!frames.length) return; // skip if not present
    scene.anims.create({
      key,
      frames: frames.map((f) => ({ key: NAME, frame: f })),
      frameRate,
      repeat,
    });
  };

  const makeSweep = () => {
    const ordered = ["throw00", "throw01", "throw02", "throw03", "throw04"]
      .map((n) => getFrame(n))
      .filter(Boolean);
    if (scene.anims.exists(`${NAME}-throw`)) {
      scene.anims.remove(`${NAME}-throw`);
    }
    if (!ordered.length) return;

    // Phaser adds per-frame duration to its base interval. A single total
    // duration keeps the forearm poses on the shared weapon sweep clock.
    scene.anims.create({
      key: `${NAME}-throw`,
      frames: ordered.map((f) => ({
        key: NAME,
        frame: f,
      })),
      duration: THORG_SWEEP.windupMs + THORG_SWEEP.strikeMs + 100,
      repeat: 0,
    });
  };

  // Try reasonable prefix variants for robustness across atlases
  // Alternate lifted strides and planted contact poses, including the loop seam.
  make(`${NAME}-running`, ["running", "run"], 8, -1,
    ["running01", "running00", "running03", "running04", "running02", "running05"]);
  make(`${NAME}-idle`, ["idle", "stand", "idle_"], 6, -1);
  make(`${NAME}-jumping`, ["jumping", "jump"], 16, 0);
  // Thorg only has a single sliding frame, so keep it held instead of
  // letting the non-looping animation complete and disappear between updates.
  make(`${NAME}-sliding`, ["wall", "slide", "sliding"], 10, -1);
  // Keep both hands raised and gently alternate the two airborne poses.
  make(`${NAME}-falling`, ["falling00", "falling01"], 6, -1);
  make(`${NAME}-powerup`, ["powerup"], 10, 0);
  make(`${NAME}-special`, ["powerup"], 10, 0);
  make(`${NAME}-ducking`, ["duck"], 1, -1);
  makeSweep();
  make(`${NAME}-dying`, ["dying", "death", "dead"], 10, 0);
}
