const settings = require('../../../../../public/assets/ninja/skins/ninja-arena-sovereign/animation-settings.json');

function hasSovereignAnimations(texture) {
  return texture?.key === 'ninja__ninja-arena-sovereign' && texture.has?.('throwHigh00');
}

function registerSovereignAnimations(scene, texture) {
  for (const [suffix, clip] of Object.entries(settings.animations)) {
    const key = `${texture.key}-${suffix}`;
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: clip.frames.map(frame => ({ key: texture.key, frame })),
      frameRate: clip.frameRate,
      repeat: clip.repeat,
    });
  }
}

module.exports = { hasSovereignAnimations, registerSovereignAnimations, sovereignThrowSettings: settings.throw };
