const {
  transact,
  history,
  animation,
  fail,
  number,
  local,
  randomUUID
} = require('./store');
const {
  image,
  sharp,
  saveFrame
} = require('./images');
function targets(p, op) {
  const ids = op.ids || (op.animation ? animation(p, op.animation).frames : []);
  if (!Array.isArray(ids) || !ids.length || ids.some(id => !Object.hasOwn(p.frames, id)) || new Set(ids).size !== ids.length) fail('Select valid, unique frame IDs.');
  return ids;
}
async function edit(root, revision, ops) {
  if (!Array.isArray(ops) || !ops.length) fail('Expected a nonempty operations array.');
  if (ops.length === 1 && ['undo', 'redo'].includes(ops[0].op)) return history(root, revision, ops[0].op);
  return transact(root, revision, async p => {
    for (const op of ops) {
      if (op.op === 'animation') {
        const a = animation(p, op.animation);
        if (op.fps !== undefined) a.fps = number(op.fps, 0.1, 120, 'FPS');
        if (op.loop !== undefined) {
          if (typeof op.loop !== 'boolean') fail('loop must be boolean.');
          a.loop = op.loop;
        }
        continue;
      }
      if (op.op === 'normalize') {
        const frames = Object.values(p.frames);
        if (!frames.length) fail('Import frames before normalizing.');
        const scale = number(op.scale ?? Math.min(256 / Math.max(...frames.map(f => f.width)), 256 / Math.max(...frames.map(f => f.height))), 0.001, 32, 'scale');
        for (const f of frames) f.transform = {
          scale,
          x: 0,
          y: 0,
          anchorX: f.width / 2,
          anchorY: f.height
        };
        p.normalized = true;
        continue;
      }
      if (op.op === 'reorder') {
        const a = animation(p, op.animation);
        if (!Array.isArray(op.ids) || op.ids.length !== a.frames.length || new Set(op.ids).size !== a.frames.length || op.ids.some(id => !a.frames.includes(id))) fail('Reorder must contain every animation frame exactly once.');
        a.frames = [...op.ids];
        continue;
      }
      if (op.op === 'blank') {
        const a = animation(p, op.animation),
          id = randomUUID();
        const data = await saveFrame(root, await sharp({
          create: {
            width: 256,
            height: 256,
            channels: 4,
            background: '#00000000'
          }
        }).png().toBuffer());
        p.frames[id] = {
          id,
          name: `${a.key}-${id.slice(0, 8)}`,
          source: null,
          ...data,
          transform: {
            scale: 1,
            x: 0,
            y: 0,
            anchorX: 128,
            anchorY: 256
          }
        };
        a.frames.splice(op.index === undefined ? a.frames.length : number(op.index, 0, a.frames.length, 'index'), 0, id);
        if (!p.portrait) p.portrait = id;
        continue;
      }
      const ids = targets(p, op);
      if (op.op === 'portrait') {
        if (ids.length !== 1) fail('Choose one portrait frame.');
        p.portrait = ids[0];
        continue;
      }
      if (op.op === 'delete') {
        p.animations.forEach(a => {
          a.frames = a.frames.filter(id => !ids.includes(id));
        });
        ids.forEach(id => delete p.frames[id]);
        if (ids.includes(p.portrait)) p.portrait = p.animations.flatMap(a => a.frames)[0] || null;
        continue;
      }
      if (op.op === 'assign') {
        const dest = animation(p, op.to);
        p.animations.forEach(a => {
          a.frames = a.frames.filter(id => !ids.includes(id));
        });
        dest.frames.splice(op.index === undefined ? dest.frames.length : number(op.index, 0, dest.frames.length, 'index'), 0, ...ids);
        continue;
      }
      for (const id of ids) {
        const f = p.frames[id];
        if (op.op === 'duplicate') {
          const copy = structuredClone(f);
          copy.id = randomUUID();
          copy.name = `${f.name}-copy-${copy.id.slice(0, 6)}`;
          p.frames[copy.id] = copy;
          const a = p.animations.find(a => a.frames.includes(id));
          a.frames.splice(a.frames.indexOf(id) + 1, 0, copy.id);
        } else if (op.op === 'transform') {
          for (const key of ['x', 'y', 'anchorX', 'anchorY', 'scale']) if (op[key] !== undefined) f.transform[key] = number(op[key], key === 'scale' ? 0.001 : -8192, key === 'scale' ? 32 : 8192, key);
        } else if (op.op === 'rename') {
          if (ids.length !== 1 || typeof op.name !== 'string' || !op.name.trim() || op.name.length > 200) fail('A single frame and nonempty name are required.');
          f.name = op.name.trim();
        } else if (op.op === 'crop') {
          const rect = {
            left: op.x,
            top: op.y,
            width: op.width,
            height: op.height
          };
          if (!Object.values(rect).every(Number.isInteger) || rect.left < 0 || rect.top < 0 || rect.width < 1 || rect.height < 1 || rect.left + rect.width > f.width || rect.top + rect.height > f.height) fail('Crop must be inside the source canvas.');
          Object.assign(f, await saveFrame(root, await image(local(root, f.file)).extract(rect).png().toBuffer()));
          f.transform.anchorX -= rect.left;
          f.transform.anchorY -= rect.top;
        } else if (op.op === 'replace') {
          if (!op.file) fail('Replacement image path is required.');
          const source = `sources/${randomUUID()}.png`;
          const {
            fs
          } = require('./store');
          await image(op.file).png().toFile(local(root, source));
          Object.assign(f, await saveFrame(root, local(root, source)));
          f.source = source;
          p.normalized = false;
        } else if (op.op === 'key' || op.op === 'paint') {
          const {
            data,
            info
          } = await image(local(root, f.file)).ensureAlpha().raw().toBuffer({
            resolveWithObject: true
          });
          const color = op.color || '#00ff00';
          if (!/^#[0-9a-f]{6}$/i.test(color)) fail('Expected #rrggbb color.');
          const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
          if (op.op === 'key') {
            const tolerance = number(op.tolerance ?? 26, 0, 441, 'tolerance');
            for (let i = 0; i < data.length; i += 4) if (Math.hypot(data[i] - rgb[0], data[i + 1] - rgb[1], data[i + 2] - rgb[2]) <= tolerance) data[i + 3] = 0;
          } else {
            const radius = number(op.radius ?? 3, 0.5, 128, 'brush radius');
            if (!Array.isArray(op.points) || !op.points.length || op.points.length > 20000) fail('Expected brush points.');
            for (const point of op.points) {
              if (!Array.isArray(point) || point.length !== 2) fail('Invalid brush point.');
              const x = number(point[0], 0, info.width, 'brush x'),
                y = number(point[1], 0, info.height, 'brush y');
              for (let yy = Math.max(0, Math.floor(y - radius)); yy < Math.min(info.height, Math.ceil(y + radius)); yy++) for (let xx = Math.max(0, Math.floor(x - radius)); xx < Math.min(info.width, Math.ceil(x + radius)); xx++) {
                if (Math.hypot(xx - x, yy - y) > radius) continue;
                const i = (yy * info.width + xx) * 4;
                if (op.erase) data[i + 3] = 0;else {
                  rgb.forEach((c, j) => {
                    data[i + j] = c;
                  });
                  data[i + 3] = 255;
                }
              }
            }
          }
          Object.assign(f, await saveFrame(root, await sharp(data, {
            raw: info
          }).png().toBuffer()));
        } else fail(`Unknown edit operation: ${op.op}`);
      }
    }
  });
}
module.exports = {
  edit
};
