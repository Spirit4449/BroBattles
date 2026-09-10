// Normalize the visible bounds at load time, keeping every original flame
// frame. This corrects size changes baked into the sheet without changing
// the projectile's scale, cast tween, or timing.
export function getSteadyFireballTexture(scene) {
  const key = "wizard-fireball-steady";
  if (scene.textures.exists(key)) return key;
  if (!scene.textures.exists("wizard-fireball")) return null;
  const source = scene.textures.get("wizard-fireball");
  const names = source.getFrameNames().filter(name => name !== "__BASE");
  if (!names.length) return "wizard-fireball";
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 370;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const frames = names.map(name => {
    const frame = source.get(name);
    context.clearRect(0, 0, 240, 370);
    context.drawImage(frame.source.image, frame.cutX, frame.cutY,
      frame.cutWidth, frame.cutHeight, 0, 0, 240, 370);
    const pixels = context.getImageData(0, 0, 240, 370).data;
    let left = 240, top = 370, right = -1, bottom = -1;
    for (let y = 0; y < 370; y++) {
      for (let x = 0; x < 240; x++) {
        if (pixels[(y * 240 + x) * 4 + 3] < 64) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    return { name, frame, left, top, width: right - left + 1, height: bottom - top + 1 };
  });
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const width = median(frames.map(frame => frame.width));
  const height = median(frames.map(frame => frame.height));
  const texture = scene.textures.createCanvas(key, 240 * names.length, 370);
  const output = texture.getContext();
  frames.forEach(({ name, frame, left, top, width: w, height: h }, index) => {
    if (w > 0 && h > 0) {
      output.drawImage(frame.source.image,
        frame.cutX + left * frame.cutWidth / 240,
        frame.cutY + top * frame.cutHeight / 370,
        w * frame.cutWidth / 240, h * frame.cutHeight / 370,
        index * 240 + (240 - width) / 2, (370 - height) / 2, width, height);
    }
    texture.add(name, 0, index * 240, 0, 240, 370);
  });
  texture.refresh();
  return key;
}
