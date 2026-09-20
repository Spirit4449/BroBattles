const {
  test
} = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const {
  spawnSync
} = require('node:child_process');
const {
  fs,
  path,
  init,
  read,
  ROWS,
  local
} = require('../lib/workshop/store');
const {
  sharp,
  rendered
} = require('../lib/workshop/images');
const {
  importAssets,
  run
} = require('../lib/workshop/import');
const {
  edit
} = require('../lib/workshop/edit');
const {
  validate,
  renderReview
} = require('../lib/workshop/review');
const {
  exportBundle
} = require('../lib/workshop/export');
const {
  catalog
} = require('../lib/workshop/catalog');
const {
  createApp
} = require('../server');
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-workshop-'));
  t.after(() => fs.rm(dir, {
    recursive: true,
    force: true
  }));
  const root = path.join(dir, 'project');
  await init(root, 'Test');
  return {
    dir,
    root
  };
}
async function png(file, width = 16, height = 16, color = '#ff0000ff') {
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color
    }
  }).png().toFile(file);
  return file;
}
async function pixels(input) {
  return sharp(input).ensureAlpha().raw().toBuffer();
}
async function imported(t) {
  const f = await fixture(t),
    file = await png(path.join(f.dir, 'idle00.png'));
  const p = await importAssets(f.root, 0, {
    file,
    kind: 'images',
    animation: 'idle'
  });
  return {
    ...f,
    file,
    p,
    id: p.animations[0].frames[0]
  };
}
test('fixed rows, persistent IDs, concurrent revision rejection, undo/redo and atomic batches', async t => {
  const {
    root,
    p,
    id
  } = await imported(t);
  assert.deepEqual(p.animations.map(a => a.key), ROWS);
  let q = await edit(root, 1, [{
    op: 'duplicate',
    ids: [id]
  }]);
  const clone = q.animations[0].frames[1];
  q = await edit(root, 2, [{
    op: 'reorder',
    animation: 'idle',
    ids: [clone, id]
  }]);
  assert.deepEqual((await read(root)).animations[0].frames, [clone, id]);
  await assert.rejects(edit(root, 1, [{
    op: 'delete',
    ids: [id]
  }]), {
    code: 'CONFLICT'
  });
  await assert.rejects(edit(root, 3, [{
    op: 'delete',
    ids: [id]
  }, {
    op: 'invalid',
    ids: [clone]
  }]));
  assert.equal((await read(root)).revision, 3);
  assert.ok((await read(root)).frames[id]);
  q = await edit(root, 3, [{
    op: 'delete',
    ids: [id]
  }]);
  assert.equal(q.portrait, clone);
  q = await edit(root, 4, [{
    op: 'undo'
  }]);
  assert.ok(q.frames[id]);
  q = await edit(root, 5, [{
    op: 'redo'
  }]);
  assert.equal(q.frames[id], undefined);
  const results = await Promise.allSettled([edit(root, 6, [{
    op: 'animation',
    animation: 'idle',
    fps: 8
  }]), edit(root, 6, [{
    op: 'animation',
    animation: 'idle',
    fps: 9
  }])]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});
test('restores trimmed atlas offsets without changing source pixels', async t => {
  const {
    root,
    dir
  } = await fixture(t);
  const file = await png(path.join(dir, 'sheet.png'), 2, 3);
  const atlas = path.join(dir, 'atlas.json');
  await fs.writeFile(atlas, JSON.stringify({
    frames: {
      idle00: {
        frame: {
          x: 0,
          y: 0,
          w: 2,
          h: 3
        },
        trimmed: true,
        spriteSourceSize: {
          x: 4,
          y: 5,
          w: 2,
          h: 3
        },
        sourceSize: {
          w: 10,
          h: 12
        }
      }
    }
  }));
  const p = await importAssets(root, 0, {
    kind: 'atlas',
    file,
    atlas
  });
  const f = p.frames[p.animations[0].frames[0]];
  assert.equal(f.width, 10);
  assert.equal(f.height, 12);
  const b = await pixels(local(root, f.file));
  assert.deepEqual([...b.subarray((5 * 10 + 4) * 4, (5 * 10 + 4) * 4 + 4)], [255, 0, 0, 255]);
  assert.equal(b[3], 0);
  assert.deepEqual(await pixels(file), await pixels(await sharp(local(root, f.file)).extract({
    left: 4,
    top: 5,
    width: 2,
    height: 3
  }).png().toBuffer()));
});
test('grid slicing, numeric image ordering, unknown atlas assignments and malformed input', async t => {
  const {
    root,
    dir
  } = await fixture(t);
  const file = await png(path.join(dir, 'grid.png'), 32, 32);
  let p = await importAssets(root, 0, {
    kind: 'grid',
    file,
    width: 16,
    height: 16,
    rows: ['idle', 'running']
  });
  assert.equal(p.animations[0].frames.length, 2);
  assert.equal(p.animations[1].frames.length, 2);
  const a = await png(path.join(dir, 'f10.png')),
    b = await png(path.join(dir, 'f2.png'));
  p = await importAssets(root, 1, {
    files: [a, b],
    animation: 'attack'
  });
  assert.deepEqual(p.animations[4].frames.map(id => p.frames[id].name), ['f2', 'f10']);
  await assert.rejects(importAssets(root, 2, {
    kind: 'grid',
    file,
    width: 15,
    height: 16
  }), /divide/);
  assert.equal((await read(root)).revision, 2);
  const bad = path.join(dir, 'bad.json');
  await fs.writeFile(bad, '{}');
  await assert.rejects(importAssets(root, 2, {
    kind: 'atlas',
    file,
    atlas: bad
  }), /no frames/);
});
test('crop preserves registration; edits retain originals; transforms and replacement are undoable', async t => {
  const {
    root,
    dir,
    id,
    p
  } = await imported(t);
  const original = await fs.readFile(local(root, p.frames[id].file));
  let q = await edit(root, 1, [{
    op: 'crop',
    ids: [id],
    x: 2,
    y: 3,
    width: 10,
    height: 10
  }]);
  assert.equal(q.frames[id].transform.anchorX, 6);
  assert.equal(q.frames[id].transform.anchorY, 13);
  q = await edit(root, 2, [{
    op: 'paint',
    ids: [id],
    points: [[5, 5]],
    color: '#0000ff',
    radius: 2
  }]);
  assert.deepEqual(await fs.readFile(local(root, p.frames[id].file)), original);
  q = await edit(root, 3, [{
    op: 'key',
    ids: [id],
    color: '#ff0000',
    tolerance: 0
  }, {
    op: 'transform',
    ids: [id],
    x: 10,
    scale: 2
  }]);
  assert.equal(q.frames[id].transform.x, 10);
  const replacement = await png(path.join(dir, 'replace.png'), 20, 20);
  q = await edit(root, 4, [{
    op: 'replace',
    ids: [id],
    file: replacement
  }]);
  assert.equal(q.frames[id].width, 20);
  q = await edit(root, 5, [{
    op: 'undo'
  }]);
  assert.equal(q.frames[id].width, 10);
});
test('explicit shared normalization, fixed export rows, transparent unused cells and deterministic atlas', async t => {
  const {
    root,
    dir,
    id
  } = await imported(t);
  await assert.rejects(exportBundle(root, path.join(dir, 'out')), /Normalize/);
  let p = await edit(root, 1, [{
    op: 'assign',
    ids: [id],
    to: 'running'
  }, {
    op: 'normalize',
    scale: 1
  }]);
  assert.equal(p.frames[id].transform.scale, 1);
  const out = path.join(dir, 'out');
  const result = await exportBundle(root, out, {
    zip: true
  });
  assert.ok(result.missingAnimations.includes('idle'));
  const atlas = JSON.parse(await fs.readFile(path.join(out, 'animations.json')));
  assert.equal(atlas.frames[0].frame.y, 256);
  assert.equal(atlas.meta.size.w, 2048);
  assert.equal(atlas.meta.size.h, 2048);
  const blank = await pixels(await sharp(path.join(out, 'spritesheet.webp')).extract({
    left: 0,
    top: 0,
    width: 256,
    height: 256
  }).png().toBuffer());
  assert.ok(blank.every(n => n === 0));
  const exported = await sharp(path.join(out, 'spritesheet.webp')).extract({
    left: 0,
    top: 256,
    width: 256,
    height: 256
  }).png().toBuffer();
  assert.deepEqual(await pixels(exported), await pixels(await rendered(root, p.frames[id], 256)));
  const bytes = await fs.readFile(path.join(out, 'spritesheet.webp'));
  await exportBundle(root, out);
  assert.deepEqual(await fs.readFile(path.join(out, 'spritesheet.webp')), bytes);
  p = await edit(root, 2, Array.from({
    length: 8
  }, () => ({
    op: 'duplicate',
    ids: [id]
  })));
  await exportBundle(root, out);
  assert.equal(JSON.parse(await fs.readFile(path.join(out, 'animations.json'))).meta.size.w, 9 * 256);
});
test('review reports empty, clipped, duplicate frames and seam differences; render WebP is animated', async t => {
  const {
    root,
    dir,
    id
  } = await imported(t);
  const p = await edit(root, 1, [{
    op: 'duplicate',
    ids: [id]
  }, {
    op: 'blank',
    animation: 'idle'
  }, {
    op: 'normalize',
    scale: 1
  }, {
    op: 'transform',
    ids: [id],
    x: 400
  }]);
  const report = await validate(root);
  assert.ok(report.frames.some(f => f.empty));
  assert.ok(report.frames.some(f => f.clipped));
  assert.ok(report.frames.some(f => f.duplicateOf));
  assert.equal(report.animations[0].differences.at(-1).seam, true);
  const out = path.join(dir, 'review');
  await renderReview(root, out, {
    animation: 'idle',
    frame: id
  });
  const meta = await sharp(path.join(out, 'idle.webp'), {
    animated: true
  }).metadata();
  assert.ok(meta.pages >= 2);
  assert.equal(meta.pageHeight, 256);
  assert.ok((await fs.stat(path.join(out, 'frame.png'))).size > 0);
  assert.equal(p.revision, 2);
});
test('video import separates extraction rate from playback; missing FFmpeg and corrupt input fail cleanly', async t => {
  const {
      root,
      dir
    } = await fixture(t),
    video = path.join(dir, 'clip.mp4');
  await run('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x32:r=10:d=1', '-pix_fmt', 'yuv420p', video]);
  const p = await importAssets(root, 0, {
    kind: 'video',
    file: video,
    extractFps: 5
  });
  assert.equal(p.animations[0].frames.length, 5);
  assert.equal(p.animations[0].fps, 12);
  await assert.rejects(importAssets(root, 1, {
    kind: 'video',
    file: video,
    ffmpeg: '/missing/ffmpeg'
  }), /unavailable/);
  const corrupt = path.join(dir, 'corrupt.png');
  await fs.writeFile(corrupt, 'no image');
  await assert.rejects(importAssets(root, 1, {
    file: corrupt
  }));
  assert.equal((await read(root)).revision, 1);
});
test('all registered characters and skins import every atlas frame', async t => {
  const {
    dir
  } = await fixture(t);
  const entries = await catalog();
  assert.equal(new Set(entries.map(e => e.character)).size, 6);
  for (const entry of entries) {
    const root = path.join(dir, entry.id);
    await init(root, entry.label);
    const p = await importAssets(root, 0, {
      kind: 'atlas',
      file: entry.file,
      atlas: entry.atlas,
      character: entry.character
    });
    const original = JSON.parse(await fs.readFile(entry.atlas, 'utf8'));
    const count = Array.isArray(original.frames) ? original.frames.length : Object.keys(original.frames).length;
    assert.equal(Object.keys(p.frames).length, count, entry.id);
    assert.equal(p.animations.flatMap(a => a.frames).length, count, entry.id);
  }
});
test('HTTP and CLI share edits and export pixels; API rejects stale revisions and cross-origin writes', async t => {
  const {
    dir
  } = await fixture(t);
  const projects = path.join(dir, 'projects');
  const app = await createApp({
    projects
  });
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, data, headers = {}) => fetch(base + url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(data)
  });
  const created = await (await post('/api/projects', {
    name: 'API'
  })).json();
  const root = path.join(projects, created.key);
  let response = await post(`/api/projects/${created.key}/edit`, {
    revision: 0,
    ops: [{
      op: 'blank',
      animation: 'idle'
    }]
  });
  assert.equal(response.status, 200);
  const cliRoot = path.join(dir, 'cli');
  await fs.cp(root, cliRoot, {
    recursive: true
  });
  const ops = [{
      op: 'normalize'
    }, {
      op: 'animation',
      animation: 'idle',
      fps: 8
    }],
    opFile = path.join(dir, 'ops.json');
  await fs.writeFile(opFile, JSON.stringify(ops));
  response = await post(`/api/projects/${created.key}/edit`, {
    revision: 1,
    ops
  });
  assert.equal(response.status, 200);
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../cli.js'), 'edit', '--project', cliRoot, '--revision', '1', '--ops', opFile, '--json'], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const a = await read(root),
    b = await read(cliRoot);
  assert.deepEqual(a.animations, b.animations);
  assert.deepEqual(a.frames, b.frames);
  await exportBundle(root, path.join(dir, 'a'));
  await exportBundle(cliRoot, path.join(dir, 'b'));
  assert.deepEqual(await fs.readFile(path.join(dir, 'a/spritesheet.webp')), await fs.readFile(path.join(dir, 'b/spritesheet.webp')));
  response = await post(`/api/projects/${created.key}/edit`, {
    revision: 0,
    ops
  });
  assert.equal(response.status, 409);
  response = await post('/api/projects', {
    name: 'blocked'
  }, {
    Origin: 'https://example.com'
  });
  assert.equal(response.status, 403);
});
test('runtime compatibility reports actual reordered poses and per-frame holds', async t => {
  const {
    dir
  } = await fixture(t);
  const {
    compatibility
  } = require('../lib/workshop/catalog');
  for (const character of ['thorg', 'gloop', 'wizard']) {
    const entry = (await catalog()).find(e => e.id === character),
      root = path.join(dir, character);
    await init(root, character);
    const p = await importAssets(root, 0, {
      kind: 'atlas',
      file: entry.file,
      atlas: entry.atlas,
      character
    });
    const report = await compatibility(p),
      runtime = report.runtime[0];
    assert.equal(runtime.inspectionError, undefined);
    if (character === 'thorg') assert.equal(runtime.animations.find(a => a.key === 'thorg-running').differences.order, true);
    if (character === 'gloop') assert.equal(runtime.animations.find(a => a.key === 'gloop-idle').frames.length, 14);
    if (character === 'wizard') assert.equal(runtime.animations.find(a => a.key === 'wizard-throw').differences.perFrameDuration, true);
  }
});
test('rotated atlas restoration, ambiguous prefixes, animation transparency and timing', async t => {
  const {
    root,
    dir
  } = await fixture(t);
  const original = await sharp({
    create: {
      width: 4,
      height: 6,
      channels: 4,
      background: '#00000000'
    }
  }).composite([{
    input: await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: '#ff0000'
      }
    }).png().toBuffer(),
    left: 0,
    top: 0
  }]).png().toBuffer();
  const sheet = path.join(dir, 'rotated.png');
  await sharp(original).rotate(90).png().toFile(sheet);
  const atlas = path.join(dir, 'atlas.json');
  await fs.writeFile(atlas, JSON.stringify({
    frames: [{
      filename: 'mystery00',
      frame: {
        x: 0,
        y: 0,
        w: 6,
        h: 4
      },
      rotated: true,
      sourceSize: {
        w: 4,
        h: 6
      },
      spriteSourceSize: {
        x: 0,
        y: 0
      }
    }]
  }));
  let p = await importAssets(root, 0, {
    kind: 'atlas',
    file: sheet,
    atlas
  });
  const id = p.animations.find(a => a.key === 'unassigned').frames[0];
  assert.deepEqual(await pixels(local(root, p.frames[id].file)), await pixels(original));
  p = await edit(root, 1, [{
    op: 'assign',
    ids: [id],
    to: 'idle'
  }, {
    op: 'blank',
    animation: 'idle'
  }, {
    op: 'normalize',
    scale: 1
  }, {
    op: 'animation',
    animation: 'idle',
    fps: 10
  }]);
  const buffers = await Promise.all(p.animations[0].frames.map(id => rendered(root, p.frames[id], 256)));
  const encoded = await require('../lib/workshop/animatedWebp').animatedWebp(buffers, 256, 10, true);
  const meta = await sharp(encoded, {
    animated: true
  }).metadata();
  assert.equal(meta.pages, 2);
  assert.deepEqual(meta.delay, [100, 100]);
  assert.equal(meta.loop, 0);
  const decoded = await sharp(encoded, {
    animated: true
  }).ensureAlpha().raw().toBuffer();
  assert.ok(decoded.subarray(256 * 256 * 4).every(value => value === 0), 'transparent second frame must clear prior pixels');
});
