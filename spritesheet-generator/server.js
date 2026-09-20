const express = require('express');
const multer = require('multer');
const {
  fs,
  path,
  randomUUID,
  read,
  init,
  fail,
  local
} = require('./lib/workshop/store');
const {
  importAssets
} = require('./lib/workshop/import');
const {
  edit
} = require('./lib/workshop/edit');
const {
  image,
  rendered
} = require('./lib/workshop/images');
const {
  validate,
  renderReview,
  previewSize
} = require('./lib/workshop/review');
const {
  exportBundle
} = require('./lib/workshop/export');
const {
  catalog
} = require('./lib/workshop/catalog');
async function createApp({
  projects = path.join(__dirname, 'projects')
} = {}) {
  projects = path.resolve(projects);
  await fs.mkdir(projects, {
    recursive: true
  });
  const uploads = path.join(projects, '.uploads');
  await fs.mkdir(uploads, {
    recursive: true
  });
  const upload = multer({
    dest: uploads,
    limits: {
      fileSize: 512 * 1024 * 1024,
      files: 400
    }
  });
  const app = express();
  // The workshop is a local filesystem tool. Reject browser requests from other origins.
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return res.status(403).json({
      error: 'Local requests only.'
    });
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return res.status(403).json({
      error: 'Cross-origin requests are not allowed.'
    });
    next();
  });
  app.use(express.json({
    limit: '8mb'
  }));
  const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  function root(id) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) fail('Invalid project ID.');
    return local(projects, id);
  }
  app.get('/api/catalog', route(async (_req, res) => res.json((await catalog()).map(({
    file,
    atlas,
    ...item
  }) => item))));
  app.get('/api/projects', route(async (_req, res) => {
    const result = [];
    for (const entry of await fs.readdir(projects, {
      withFileTypes: true
    })) if (entry.isDirectory() && !entry.name.startsWith('.')) {
      try {
        const p = await read(root(entry.name));
        result.push({
          key: entry.name,
          name: p.name,
          revision: p.revision
        });
      } catch {/* ignore nonprojects */}
    }
    res.json(result);
  }));
  app.post('/api/projects', route(async (req, res) => {
    const key = randomUUID();
    const project = await init(root(key), String(req.body.name || 'Untitled character').slice(0, 120));
    res.json({
      key,
      project
    });
  }));
  app.get('/api/projects/:id', route(async (req, res) => res.json(await read(root(req.params.id)))));
  app.post('/api/projects/:id/edit', route(async (req, res) => {
    if (!Array.isArray(req.body.ops) || req.body.ops.some(o => o.op === 'replace')) fail('Use the replacement upload endpoint for images.');
    res.json(await edit(root(req.params.id), req.body.revision, req.body.ops));
  }));
  app.post('/api/projects/:id/catalog', route(async (req, res) => {
    const item = (await catalog()).find(i => i.id === req.body.catalogId);
    if (!item) fail('Unknown catalog entry.');
    res.json(await importAssets(root(req.params.id), req.body.revision, {
      kind: 'atlas',
      file: item.file,
      atlas: item.atlas,
      character: item.character
    }));
  }));
  app.post('/api/projects/:id/import', upload.array('files'), route(async (req, res) => {
    const files = req.files || [];
    try {
      const options = JSON.parse(req.body.options || '{}');
      const images = files.filter(f => !f.originalname.toLowerCase().endsWith('.json')).sort((a, b) => a.originalname.localeCompare(b.originalname, undefined, {
        numeric: true
      }));
      // Preserve original names and extensions for portable source provenance.
      const named = [];
      for (const f of images) {
        const dest = `${f.path}-${path.basename(f.originalname)}`;
        await fs.rename(f.path, dest);
        f.path = dest;
        named.push(dest);
      }
      if (options.replace) {
        if (named.length !== 1) fail('Upload one replacement image.');
        res.json(await edit(root(req.params.id), Number(req.body.revision), [{
          op: 'replace',
          ids: [options.replace],
          file: named[0]
        }]));
      } else {
        res.json(await importAssets(root(req.params.id), Number(req.body.revision), {
          kind: options.kind,
          files: named,
          names: images.map(f => f.originalname),
          atlas: files.find(f => f.originalname.toLowerCase().endsWith('.json'))?.path,
          animation: options.animation || undefined,
          width: options.width,
          height: options.height,
          rows: options.rows,
          extractFps: options.extractFps
        }));
      }
    } finally {
      await Promise.all(files.map(f => fs.rm(f.path, {
        force: true
      })));
    }
  }));
  app.get('/api/projects/:id/frames/:frame', route(async (req, res) => {
    const dir = root(req.params.id),
      p = await read(dir),
      f = p.frames[req.params.frame];
    if (!f) fail('Frame not found.');
    res.set('Cache-Control', 'no-store').type('png').send(req.query.native === '1' ? await image(local(dir, f.file)).png().toBuffer() : await rendered(dir, f, previewSize(p)));
  }));
  app.get('/api/projects/:id/validate', route(async (req, res) => res.json(await validate(root(req.params.id)))));
  for (const command of ['render', 'export']) app.post(`/api/projects/:id/${command}`, route(async (req, res) => {
    const dir = root(req.params.id),
      p = await read(dir),
      outputId = `${command}-${p.revision}-${randomUUID()}`,
      out = path.join(dir, 'output', outputId);
    const result = command === 'render' ? await renderReview(dir, out, {
      animation: req.body.animation,
      frame: req.body.frame
    }) : await exportBundle(dir, out, {
      zip: true
    });
    res.json({
      ...result,
      out: undefined,
      urls: result.artifacts.map(file => ({
        file,
        url: `/api/projects/${req.params.id}/output/${outputId}/${file}`
      }))
    });
  }));
  app.get('/api/projects/:id/output/:output/:file', route(async (req, res) => {
    if (!/^[a-z0-9-]+$/.test(req.params.output) || !/^[a-zA-Z0-9_.-]+$/.test(req.params.file)) fail('Invalid output path.');
    res.sendFile(local(root(req.params.id), `output/${req.params.output}/${req.params.file}`));
  }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use((e, _req, res, _next) => res.status(e.code === 'CONFLICT' ? 409 : 400).json({
    error: e.message,
    code: e.code || 'ERROR'
  }));
  return app;
}
async function start(options = {}) {
  const app = await createApp(options),
    port = options.port ?? Number(process.env.PORT || 3015);
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`Sprite Workshop: http://127.0.0.1:${server.address().port}`);
      resolve();
    });
    server.on('error', reject);
  });
}
if (require.main === module) start().catch(e => {
  console.error(e.message);
  process.exitCode = 1;
});
module.exports = {
  createApp,
  start
};
