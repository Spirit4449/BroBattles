// Shared atlas mechanics; character modules retain their frame order and timing.
function createAnimationBuilder(scene, textureKey) {
  const texture = scene.textures.get(textureKey);
  const names = texture?.getFrameNames?.() || [];
  const byName = new Map(names.map(name => [name.toLowerCase(), name]));
  const getFrame = name => byName.get(String(name).toLowerCase()) || null;
  const findFrames = prefixes => names.filter(name =>
    (Array.isArray(prefixes) ? prefixes : [prefixes]).some(prefix => name.toLowerCase().startsWith(prefix)),
  ).sort((a, b) => {
    const left = /([0-9]+)(?!.*[0-9])/.exec(a);
    const right = /([0-9]+)(?!.*[0-9])/.exec(b);
    return left && right ? Number(left[1]) - Number(right[1]) : a.localeCompare(b);
  });
  function make(key, prefixes, frameRate, repeat, order) {
    if (scene.anims.exists(key)) return;
    const frames = order && order.every(getFrame) ? order.map(getFrame) : findFrames(prefixes);
    if (!frames.length) return;
    scene.anims.create({ key, frames: frames.map(frame => ({ key: textureKey, frame })), frameRate, repeat });
  }
  return { make, findFrames, getFrame };
}
module.exports = { createAnimationBuilder };
