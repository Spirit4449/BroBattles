import settings from '../../../public/assets/ninja/animation-settings.json';

// Logical keys remain compatible with movement and returning-shuriken combat.
export function animations(scene) {
  const aliases = { attack: 'throw', wall: 'sliding' };
  for (const row of settings.animations) {
    if (!row.frames.length || row.key === 'unused-original') continue;
    const key = 'ninja-' + (aliases[row.key] || row.key);
    if (scene.anims.exists(key)) continue;
    scene.anims.create({ key,
      frames: row.frames.map(frame => ({ key: 'ninja', frame })),
      frameRate: row.fps, repeat: row.loop ? -1 : 0,
    });
  }
  // Older candidate settings may lack a dedicated special row.
  const attack = settings.animations.find(row => row.key === 'attack');
  if (attack && !scene.anims.exists('ninja-special')) scene.anims.create({
    key: 'ninja-special', frames: attack.frames.map(frame => ({ key: 'ninja', frame })),
    frameRate: attack.fps, repeat: 0,
  });
}
