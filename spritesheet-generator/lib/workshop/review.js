const {
  fs,
  path,
  local,
  read,
  fail
} = require('./store');
const {
  sharp,
  image,
  rendered
} = require('./images');
const {
  compatibility
} = require('./catalog');
const crypto = require('node:crypto');
function previewSize(p) {
  return p.normalized ? 256 : Math.max(256, ...Object.values(p.frames).flatMap(f => [f.width, f.height]));
}
async function validate(root, p) {
  p ||= await read(root);
  const report = {
    revision: p.revision,
    normalized: p.normalized,
    missingAnimations: p.animations.filter(a => !a.frames.length).map(a => a.key),
    warnings: [],
    frames: [],
    animations: []
  };
  if (!p.normalized) report.warnings.push('Explicit normalization is required before standardized export.');
  const hashes = new Map(),
    samples = new Map();
  for (const f of Object.values(p.frames)) {
    const {
      data,
      info
    } = await image(local(root, f.file)).ensureAlpha().raw().toBuffer({
      resolveWithObject: true
    });
    let minX = info.width,
      minY = info.height,
      maxX = -1,
      maxY = -1,
      mass = 0,
      sx = 0,
      sy = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * 4 + 3];
      if (!alpha) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      mass += alpha;
      sx += x * alpha;
      sy += y * alpha;
    }
    const t = f.transform,
      x = 128 - t.anchorX * t.scale + t.x,
      y = 256 - t.anchorY * t.scale + t.y;
    const clipped = !!mass && (x + minX * t.scale < 0 || y + minY * t.scale < 0 || x + (maxX + 1) * t.scale > 256 || y + (maxY + 1) * t.scale > 256);
    const hash = crypto.createHash('sha256').update(`${info.width}x${info.height}`).update(data).digest('hex');
    report.frames.push({
      id: f.id,
      name: f.name,
      empty: !mass,
      clipped,
      bounds: mass ? {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
      } : null,
      centroid: mass ? {
        x: sx / mass,
        y: sy / mass
      } : null,
      duplicateOf: hashes.get(hash) || null
    });
    hashes.set(hash, hashes.get(hash) || f.id);
    const sample = await image(await rendered(root, f, 256)).resize(64, 64).ensureAlpha().raw().toBuffer();
    samples.set(f.id, sample);
  }
  const byId = new Map(report.frames.map(f => [f.id, f]));
  for (const a of p.animations) {
    const differences = [];
    for (let i = 0; i < a.frames.length; i++) {
      if (!a.loop && i === a.frames.length - 1) break;
      const from = a.frames[i],
        to = a.frames[(i + 1) % a.frames.length],
        l = samples.get(from),
        r = samples.get(to);
      let delta = 0;
      for (let j = 0; j < l.length; j += 4) {
        for (let c = 0; c < 3; c++) delta += Math.abs(l[j + c] * l[j + 3] / 255 - r[j + c] * r[j + 3] / 255);
        delta += Math.abs(l[j + 3] - r[j + 3]);
      }
      const f = byId.get(from),
        t = byId.get(to);
      differences.push({
        from,
        to,
        seam: i === a.frames.length - 1,
        difference: delta / (l.length * 255),
        centroidDistance: f.centroid && t.centroid ? Math.hypot(f.centroid.x - t.centroid.x, f.centroid.y - t.centroid.y) : null,
        boundsChanged: JSON.stringify(f.bounds) !== JSON.stringify(t.bounds)
      });
    }
    report.animations.push({
      animation: a.key,
      differences
    });
  }
  report.warnings.push('Metrics are review signals, not proof of smooth motion or BB art style.');
  report.compatibility = await compatibility(p);
  return report;
}
function xml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
  })[c]);
}
async function renderReview(root, out, options = {}) {
  const p = await read(root),
    size = previewSize(p);
  const animations = options.animation ? p.animations.filter(a => a.key === options.animation) : p.animations;
  if (!animations.length) fail('Animation not found.');
  await fs.mkdir(out, {
    recursive: true
  });
  const report = await validate(root, p);
  await fs.writeFile(path.join(out, 'review.json'), JSON.stringify(report, null, 2));
  const artifacts = [];
  for (const a of animations.filter(a => a.frames.length)) {
    const thumb = 128,
      label = 28,
      cols = Math.min(8, a.frames.length),
      rows = Math.ceil(a.frames.length / cols);
    const layers = [],
      buffers = [];
    for (let i = 0; i < a.frames.length; i++) {
      const f = p.frames[a.frames[i]],
        png = await rendered(root, f, size);
      buffers.push(png);
      const x = i % cols * thumb,
        y = Math.floor(i / cols) * (thumb + label);
      layers.push({
        input: await image(png).resize(thumb, thumb).png().toBuffer(),
        left: x,
        top: y
      });
      layers.push({
        input: Buffer.from(`<svg width="128" height="28"><rect width="128" height="28" fill="#182333"/><text x="5" y="18" fill="white" font-family="sans-serif" font-size="11">${i + 1} · ${xml(f.name.slice(0, 17))}</text></svg>`),
        left: x,
        top: y + thumb
      });
    }
    const contact = `${a.key}-contact.png`;
    await sharp({
      create: {
        width: cols * thumb,
        height: rows * (thumb + label),
        channels: 4,
        background: '#364657'
      }
    }).composite(layers).png().toFile(path.join(out, contact));
    artifacts.push(contact);
    const animated = `${a.key}.webp`;
    await fs.writeFile(path.join(out, animated), await require('./animatedWebp').animatedWebp(buffers, size, a.fps, a.loop));
    artifacts.push(animated);
    const seam = `${a.key}-seam.png`;
    await sharp({
      create: {
        width: size * 2,
        height: size,
        channels: 4,
        background: '#00000000'
      }
    }).composite([{
      input: buffers[buffers.length - 1],
      left: 0,
      top: 0
    }, {
      input: buffers[0],
      left: size,
      top: 0
    }]).png().toFile(path.join(out, seam));
    artifacts.push(seam);
  }
  if (options.frame) {
    if (!p.frames[options.frame]) fail('Frame not found.');
    await image(await rendered(root, p.frames[options.frame], size)).resize(size * 2, size * 2, {
      kernel: 'nearest'
    }).png().toFile(path.join(out, 'frame.png'));
    artifacts.push('frame.png');
  }
  return {
    revision: p.revision,
    out,
    artifacts: [...artifacts, 'review.json'],
    report
  };
}
module.exports = {
  validate,
  renderReview,
  previewSize
};
