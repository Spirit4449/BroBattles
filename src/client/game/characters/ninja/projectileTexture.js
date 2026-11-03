import { teamColor, TEAM_RED } from "../../../../shared/projectilePresentation";

// Skin artwork changes presentation only; projectile tuning remains shared.
// The default shuriken has a red copy for enemy throws; `team` carries the
// owner's team colour when the owner sprite is not known.
export function ninjaProjectileTexture(scene, owner, team = owner) {
  const skin = owner?._bbSkinTextureKey || owner?.texture?.key;
  const key = skin && `${skin}-weapon`;
  if (key && scene.textures?.exists(`${key}-spin`)) return `${key}-spin`;
  if (key && scene.textures?.exists(key)) return key;
  return teamColor(team) === TEAM_RED && scene.textures?.exists('shuriken-red') ? 'shuriken-red' : 'shuriken';
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
