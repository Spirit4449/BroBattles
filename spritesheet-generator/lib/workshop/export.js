const archiver = require('archiver');
const {
  createWriteStream
} = require('node:fs');
const {
  fs,
  path,
  read,
  fail
} = require('./store');
const {
  sharp,
  rendered
} = require('./images');
const {
  validate
} = require('./review');
async function exportBundle(root, out, options = {}) {
  const p = await read(root);
  if (!p.normalized) fail('Normalize the project explicitly to 256×256 before export.');
  const ids = p.animations.flatMap(a => a.frames);
  if (!ids.length) fail('No frames to export.');
  const names = ids.map(id => p.frames[id].name);
  if (new Set(names).size !== names.length) fail('Frame names must be unique before atlas export. Rename duplicates.');
  const columns = Math.max(8, ...p.animations.map(a => a.frames.length));
  if (columns * 256 * p.animations.length * 256 > 64 * 1024 * 1024) fail('Atlas exceeds 64 megapixels; reduce frame count.');
  const report = await validate(root, p),
    layers = [],
    frames = [];
  for (let row = 0; row < p.animations.length; row++) {
    const a = p.animations[row];
    for (let column = 0; column < a.frames.length; column++) {
      const f = p.frames[a.frames[column]],
        x = column * 256,
        y = row * 256;
      layers.push({
        input: await rendered(root, f, 256),
        left: x,
        top: y
      });
      frames.push({
        filename: f.name,
        frame: {
          x,
          y,
          w: 256,
          h: 256
        },
        rotated: false,
        trimmed: false,
        spriteSourceSize: {
          x: 0,
          y: 0,
          w: 256,
          h: 256
        },
        sourceSize: {
          w: 256,
          h: 256
        }
      });
    }
  }
  await fs.mkdir(out, {
    recursive: true
  });
  const width = columns * 256,
    height = p.animations.length * 256;
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#00000000'
    }
  }).composite(layers).webp({
    lossless: true,
    effort: 6
  }).toFile(path.join(out, 'spritesheet.webp'));
  await sharp(await rendered(root, p.frames[p.portrait || ids[0]], 256)).webp({
    lossless: true
  }).toFile(path.join(out, 'body.webp'));
  const files = {
    'animations.json': {
      frames,
      meta: {
        app: 'Bro Battles Sprite Workshop',
        version: '1',
        image: 'spritesheet.webp',
        size: {
          w: width,
          h: height
        },
        scale: 1
      }
    },
    'animation-settings.json': {
      version: 1,
      cellSize: 256,
      animations: p.animations.map((a, row) => ({
        ...a,
        row,
        frames: a.frames.map(id => p.frames[id].name)
      }))
    },
    'review.json': report
  };
  for (const [file, value] of Object.entries(files)) await fs.writeFile(path.join(out, file), JSON.stringify(value, null, 2) + '\n');
  await fs.writeFile(path.join(out, 'import-notes.md'), `# ${p.name}\n\n256×256 cells; ${columns} columns. Missing animations: ${report.missingAnimations.join(', ') || 'none'}.\n\n${report.compatibility.warning}\n\nSee review.json for mappings and runtime animation definitions. No live assets were changed.\n`);
  const artifacts = ['spritesheet.webp', 'body.webp', ...Object.keys(files), 'import-notes.md'];
  if (options.zip) {
    await new Promise((resolve, reject) => {
      const output = createWriteStream(path.join(out, 'bundle.zip')),
        zip = archiver('zip', {
          zlib: {
            level: 9
          }
        });
      output.on('close', resolve);
      output.on('error', reject);
      zip.on('error', reject);
      zip.pipe(output);
      for (const name of artifacts) zip.file(path.join(out, name), {
        name,
        date: new Date('2000-01-01T00:00:00Z')
      });
      zip.finalize();
    });
    artifacts.push('bundle.zip');
  }
  return {
    revision: p.revision,
    out,
    artifacts,
    missingAnimations: report.missingAnimations,
    clippedFrames: report.frames.filter(f => f.clipped).map(f => f.id)
  };
}
module.exports = {
  exportBundle
};
