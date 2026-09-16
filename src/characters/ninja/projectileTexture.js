// Skin artwork changes presentation only; projectile tuning remains shared.
export function ninjaProjectileTexture(scene, owner) {
  const skin = owner?._bbSkinTextureKey || owner?.texture?.key;
  const key = skin && `${skin}-weapon`;
  if (key && scene.textures?.exists(`${key}-spin`)) return `${key}-spin`;
  return key && scene.textures?.exists(key) ? key : 'shuriken';
}

export function animateNinjaProjectile(sprite, key, elapsed, rotationSpeed, direction) {
  if (key.endsWith('-weapon-spin')) {
    sprite.setAngularVelocity?.(0);
    sprite.setRotation(0);
    const frame = Math.floor(elapsed / 65) % 8;
    sprite.setFrame?.(direction < 0 ? (8-frame)%8 : frame);
  } else {
    sprite.setRotation(elapsed*rotationSpeed*Math.PI/180000*direction);
  }
}
