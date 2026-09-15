// Skin artwork changes presentation only; projectile tuning remains shared.
export function ninjaProjectileTexture(scene, owner) {
  const skin = owner?._bbSkinTextureKey || owner?.texture?.key;
  const key = skin && `${skin}-weapon`;
  return key && scene.textures?.exists(key) ? key : 'shuriken';
}
