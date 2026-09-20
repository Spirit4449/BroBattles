const {
  fs,
  path
} = require('./store');
const REPO = path.resolve(__dirname, '../../..');
async function catalog(repo = REPO) {
  const registry = JSON.parse(await fs.readFile(path.join(repo, 'src/shared/skinsCatalog.json'), 'utf8'));
  const files = await fs.readdir(path.join(repo, 'src/shared/characters'));
  const items = [];
  for (const file of files.filter(f => f.endsWith('.json'))) {
    const meta = JSON.parse(await fs.readFile(path.join(repo, 'src/shared/characters', file), 'utf8'));
    if (!meta.key) continue;
    const variants = [{
      id: meta.key,
      label: meta.key,
      gameAssets: {
        spritesheetUrl: `/assets/${meta.key}/spritesheet.webp`,
        animationsUrl: `/assets/${meta.key}/animations.json`
      }
    }, ...(registry.characters[meta.key]?.skins || []).filter(s => s.id !== registry.characters[meta.key]?.defaultSkinId)];
    for (const variant of variants) {
      const sheet = variant.gameAssets?.spritesheetUrl,
        atlas = variant.gameAssets?.animationsUrl;
      if (!sheet || !atlas) continue;
      const file = path.join(repo, 'public', sheet),
        json = path.join(repo, 'public', atlas);
      try {
        await fs.access(file);
        await fs.access(json);
        items.push({
          id: variant.id,
          label: variant.name ? `${meta.key} · ${variant.name}` : meta.key,
          character: meta.key,
          file,
          atlas: json
        });
      } catch {/* only discover installed art */}
    }
  }
  return items;
}
async function compatibility(p, repo = REPO) {
  const characters = [...new Set(p.imports.map(i => i.character).filter(Boolean))];
  const runtime = [];
  for (const character of characters) {
    if (!/^[a-z0-9-]+$/.test(character)) continue;
    const file = path.join(repo, 'src/characters', character, 'anim.js');
    try {
      const definitions = await fs.readFile(file, 'utf8');
      const entry = {
        character,
        source: `src/characters/${character}/anim.js`,
        definitions
      };
      try {
        // Execute only the repository's trusted animation declarations against a
        // recording scene. Never evaluate imported project or asset contents.
        const names = Object.values(p.frames).map(f => f.name),
          recorded = new Map();
        const scene = {
          textures: {
            exists: key => key === character,
            get: () => ({
              getFrameNames: () => names
            })
          },
          anims: {
            exists: key => recorded.has(key),
            remove: key => recorded.delete(key),
            create: config => recorded.set(config.key, config),
            generateFrameNames: (key, options) => Array.from({
              length: options.end - (options.start || 0) + 1
            }, (_, i) => ({
              key,
              frame: `${options.prefix}${String(i + (options.start || 0)).padStart(options.zeroPad || 0, '0')}`
            }))
          }
        };
        const source = definitions.replace(/import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];?/g, '').replace('export function animations', 'function animations');
        const tuning = JSON.parse(await fs.readFile(path.join(repo, 'src/shared/characters/thorg.json'), 'utf8')).stats.tuning.attack.sweep;
        require('node:vm').runInNewContext(`${source}\nanimations(scene);`, {
          scene,
          createAnimationBuilder: require(path.join(repo, 'src/characters/shared/animationBuilder')).createAnimationBuilder,
          THORG_SWEEP: tuning
        }, {
          timeout: 1000
        });
        const aliases = {
          throw: 'attack',
          sliding: 'wall',
          ducking: 'unassigned',
          powerup: 'unassigned'
        };
        entry.animations = [...recorded.values()].map(config => {
          const key = config.key.slice(character.length + 1),
            a = p.animations.find(a => a.key === (aliases[key] || key));
          const order = config.frames.map(f => f.frame),
            expected = a?.frames.map(id => p.frames[id].name) || [];
          return {
            key: config.key,
            projectAnimation: a?.key || null,
            frameRate: config.frameRate || null,
            duration: config.duration || null,
            repeat: config.repeat,
            frames: config.frames,
            missingFrames: order.filter(name => !names.includes(name)),
            differences: {
              order: JSON.stringify(order) !== JSON.stringify(expected),
              fps: !!config.duration || config.frameRate !== a?.fps,
              repeat: config.repeat !== (a?.loop ? -1 : 0),
              perFrameDuration: config.frames.some(f => f.duration)
            }
          };
        });
      } catch (error) {
        entry.inspectionError = error.message;
      }
      runtime.push(entry);
    } catch {/* external projects have no runtime source */}
  }
  return {
    warning: 'Project playback settings do not alter game runtime timing, order, aliases, or effects. Compare these definitions before integrating exports.',
    mappings: p.animations.map(a => ({
      animation: a.key,
      fps: a.fps,
      loop: a.loop,
      frames: a.frames.map(id => p.frames[id].name)
    })),
    runtime
  };
}
module.exports = {
  catalog,
  compatibility,
  REPO
};
