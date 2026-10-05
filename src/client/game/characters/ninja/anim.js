import settings from '../../../../../public/assets/ninja/animation-settings.json';

// Logical keys remain compatible with movement and returning-shuriken combat.
export function animations(scene) {
  const aliases = { attack: 'throw', wall: 'sliding' };
  for (const row of settings.animations) {
    if (!row.frames.length || row.key === 'unused-original') continue;
    const key = 'ninja-' + (aliases[row.key] || row.key);
    if (scene.anims.exists(key)) continue;
    scene.anims.create({ key,
      frames: row.frames.map((frame, index) => ({ key: 'ninja', frame,
        // Phaser adds this to the base frame interval. Total holds let idle
        // linger naturally while the blink itself stays quick.
        ...(Number.isFinite(row.frameDurationsMs?.[index]) ? {
          duration: Math.max(0, row.frameDurationsMs[index] - 1000 / row.fps),
        } : {}),
      })),
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
