const {
  spawn
} = require('node:child_process');
const {
  fs,
  path,
  randomUUID,
  fail,
  local,
  transact,
  animation,
  number
} = require('./store');
const {
  image,
  sharp,
  saveFrame,
  LIMIT
} = require('./images');
const ALIASES = {
  idle: 'idle',
  stand: 'idle',
  running: 'running',
  run: 'running',
  walk: 'running',
  move: 'running',
  jumping: 'jumping',
  jump: 'jumping',
  falling: 'falling',
  fall: 'falling',
  attack: 'attack',
  throw: 'attack',
  dying: 'dying',
  die: 'dying',
  death: 'dying',
  dead: 'dying',
  wall: 'wall',
  slide: 'wall',
  sliding: 'wall',
  special: 'special',
  ultimate: 'special',
  ult: 'special'
};
function infer(name) {
  const prefix = String(name).toLowerCase().replace(/\.[^.]+$/, '').replace(/[\d_-]+$/, '');
  return ALIASES[prefix] || 'unassigned';
}
function run(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let error = '';
    proc.stderr.on('data', b => {
      error = (error + b).slice(-4000);
    });
    proc.on('error', e => reject(new Error(e.code === 'ENOENT' ? `${command} is unavailable. Install FFmpeg for video import.` : e.message)));
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${error}`)));
  });
}
async function importAssets(root, revision, opts) {
  return transact(root, revision, async p => {
    const kind = opts.kind || 'images';
    if (!['images', 'grid', 'atlas', 'video'].includes(kind)) fail('Unknown import kind.');
    const inputs = opts.files || (opts.file ? [opts.file] : []);
    if (!inputs.length) fail('No source files.');
    const originals = [];
    for (const file of inputs) {
      const ref = `sources/${randomUUID()}${path.extname(file).toLowerCase()}`;
      await fs.copyFile(file, local(root, ref));
      originals.push(ref);
    }
    let atlas;
    if (kind === 'atlas') {
      if (!opts.atlas) fail('Atlas JSON is required.');
      atlas = JSON.parse(await fs.readFile(opts.atlas, 'utf8'));
      const ref = `sources/${randomUUID()}.json`;
      await fs.copyFile(opts.atlas, local(root, ref));
      originals.push(ref);
    }
    const added = [];
    async function add(input, name, source, inferred = opts.animation || 'idle') {
      const data = await saveFrame(root, input),
        id = randomUUID();
      const a = animation(p, inferred);
      p.frames[id] = {
        id,
        name,
        source,
        ...data,
        transform: {
          scale: 1,
          x: 0,
          y: 0,
          anchorX: data.width / 2,
          anchorY: data.height
        }
      };
      a.frames.push(id);
      added.push(id);
      if (!p.portrait) p.portrait = id;
    }
    if (kind === 'atlas') {
      const entries = Array.isArray(atlas.frames) ? atlas.frames : Object.entries(atlas.frames || {}).map(([filename, f]) => ({
        ...f,
        filename
      }));
      if (!entries.length) fail('Atlas has no frames.');
      for (const f of entries) {
        if (typeof f.filename !== 'string' || !f.filename.trim()) fail('Atlas frames require nonempty names.');
        const r = f.frame;
        if (!r || ![r.x, r.y, r.w, r.h].every(Number.isInteger) || r.w <= 0 || r.h <= 0 || r.x < 0 || r.y < 0) fail('Invalid atlas rectangle.');
        let crop = image(local(root, originals[0])).extract({
          left: r.x,
          top: r.y,
          width: r.w,
          height: r.h
        });
        if (f.rotated) crop = crop.rotate(270);
        const b = await crop.png().toBuffer();
        const m = await image(b).metadata();
        const s = f.sourceSize || {
            w: m.width,
            h: m.height
          },
          offset = f.spriteSourceSize || {
            x: 0,
            y: 0
          };
        if (s.w * s.h > LIMIT || ![s.w, s.h, offset.x, offset.y].every(Number.isInteger) || s.w < m.width + offset.x || s.h < m.height + offset.y || offset.x < 0 || offset.y < 0) fail('Invalid atlas source size/offset.');
        const restored = await sharp({
          create: {
            width: s.w,
            height: s.h,
            channels: 4,
            background: '#00000000'
          }
        }).composite([{
          input: b,
          left: offset.x,
          top: offset.y
        }]).png().toBuffer();
        await add(restored, String(f.filename), originals[0], opts.animation || infer(f.filename));
      }
    } else if (kind === 'grid') {
      const w = number(opts.width, 1, 8192, 'grid width'),
        h = number(opts.height, 1, 8192, 'grid height');
      if (!Number.isInteger(w) || !Number.isInteger(h)) fail('Grid dimensions must be integers.');
      const input = local(root, originals[0]),
        m = await image(input).metadata();
      if (m.width % w || m.height % h) fail('Grid dimensions must divide the image exactly.');
      const keys = opts.rows || [opts.animation || 'idle'];
      for (let y = 0; y < m.height; y += h) for (let x = 0; x < m.width; x += w) {
        const key = keys[Math.floor(y / h)] || keys[keys.length - 1];
        await add(await image(input).extract({
          left: x,
          top: y,
          width: w,
          height: h
        }).png().toBuffer(), `${key}${String(animation(p, key).frames.length).padStart(2, '0')}`, originals[0], key);
      }
    } else if (kind === 'video') {
      const fps = number(opts.extractFps ?? 12, 0.1, 120, 'extraction FPS');
      const work = await fs.mkdtemp(path.join(root, '.video-'));
      try {
        await run(opts.ffmpeg || 'ffmpeg', ['-nostdin', '-v', 'error', '-i', local(root, originals[0]), '-vf', `fps=${fps}`, '-frames:v', '2000', path.join(work, '%06d.png')]);
        const files = (await fs.readdir(work)).filter(n => n.endsWith('.png')).sort();
        if (!files.length) fail('Video produced no frames.');
        if (files.length === 2000) fail('Video exceeds 2000 extracted frames; shorten the clip or reduce extraction FPS.');
        for (const f of files) await add(path.join(work, f), `${opts.animation || 'idle'}${String(added.length).padStart(2, '0')}`, originals[0]);
      } finally {
        await fs.rm(work, {
          recursive: true,
          force: true
        });
      }
    } else {
      const files = originals.map((ref, index) => ({
        ref,
        file: opts.names?.[index] || inputs[index]
      })).sort((a, b) => a.file.localeCompare(b.file, undefined, {
        numeric: true
      }));
      for (const {
        ref,
        file
      } of files) await add(local(root, ref), path.basename(file, path.extname(file)), ref);
    }
    p.normalized = false;
    p.imports.push({
      kind,
      sourceNames: opts.names || inputs.map(f => path.basename(f)),
      sources: originals,
      frames: added,
      character: opts.character || null,
      note: kind === 'atlas' ? 'Source names and canvas offsets preserved. Runtime may use different frame order, timing, aliases, and effects; see compatibility report.' : ''
    });
  });
}
module.exports = {
  importAssets,
  infer,
  run
};
