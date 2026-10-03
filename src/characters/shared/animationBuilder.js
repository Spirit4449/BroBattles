// Shared atlas mechanics; character modules retain their frame order and timing.
function createAnimationBuilder(scene, textureKey) {
  const texture = scene.textures.get(textureKey);
  const names = texture?.getFrameNames?.() || [];
  const byName = new Map(names.map(name => [name.toLowerCase(), name]));
  const getFrame = name => byName.get(String(name).toLowerCase()) || null;
  // Parse and sort once per atlas setup, rather than once for every animation.
  const sorted = names.map(name => ({ name, lower: name.toLowerCase(),
    number: /([0-9]+)(?!.*[0-9])/.exec(name)?.[1] }));
  sorted.sort((a, b) => a.number !== undefined && b.number !== undefined
    ? Number(a.number) - Number(b.number) || a.name.localeCompare(b.name)
    : a.name.localeCompare(b.name));
  const findFrames = prefixes => {
    const alternatives = (Array.isArray(prefixes) ? prefixes : [prefixes])
      .map(prefix => String(prefix).toLowerCase());
    return sorted.filter(frame => alternatives.some(prefix => frame.lower.startsWith(prefix)))
      .map(frame => frame.name);
  };
  function make(key, prefixes, frameRate, repeat, order) {
    if (scene.anims.exists(key)) return;
    const frames = order && order.every(getFrame) ? order.map(getFrame) : findFrames(prefixes);
    if (!frames.length) return;
    scene.anims.create({ key, frames: frames.map(frame => ({ key: textureKey, frame })), frameRate, repeat });
  }
  return { make, findFrames, getFrame };
}
module.exports = { createAnimationBuilder };
