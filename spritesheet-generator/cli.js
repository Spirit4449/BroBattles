#!/usr/bin/env node
const {
  parseArgs
} = require('node:util');
const {
  fs,
  path,
  read,
  init,
  fail
} = require('./lib/workshop/store');
const {
  importAssets
} = require('./lib/workshop/import');
const {
  edit
} = require('./lib/workshop/edit');
const {
  validate,
  renderReview
} = require('./lib/workshop/review');
const {
  exportBundle
} = require('./lib/workshop/export');
const {
  catalog
} = require('./lib/workshop/catalog');
const HELP = `Bro Battles Sprite Workshop
node cli.js <command> --project <directory> [options] [--json]
  init      --name <name>
  inspect   (or --catalog, no project required)
  import    --kind images|grid|atlas|video --file <path> (repeatable)
            [--atlas <json>] [--animation idle] [--width 256 --height 256]
            [--rows idle,running] [--extract-fps 12] [--catalog-id ninja]
  edit      --ops <JSON array file> --revision <current revision>
  validate
  render    --out <directory> [--animation idle] [--frame <id>]
  export    --out <directory> [--zip]
  serve     [--port 3015] [--projects <directory>]
Imports also require --revision. Edits: animation, normalize, reorder, blank,
portrait, delete, assign, duplicate, transform, rename, crop, replace, key,
paint, undo, redo. See README for operation fields and examples.`;
async function main(args = process.argv.slice(2)) {
  const strings = ['project', 'name', 'kind', 'atlas', 'animation', 'width', 'height', 'rows', 'extract-fps', 'catalog-id', 'ops', 'revision', 'out', 'frame', 'port', 'projects'];
  const {
    values: v,
    positionals
  } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      ...Object.fromEntries(strings.map(k => [k, {
        type: 'string'
      }])),
      file: {
        type: 'string',
        multiple: true
      },
      json: {
        type: 'boolean'
      },
      zip: {
        type: 'boolean'
      },
      catalog: {
        type: 'boolean'
      },
      help: {
        type: 'boolean'
      }
    }
  });
  const command = positionals[0];
  if (!command || v.help) return {
    help: HELP
  };
  if (command === 'serve') return require('./server').start({
    port: v.port ? Number(v.port) : undefined,
    projects: v.projects
  });
  if (command === 'inspect' && v.catalog) return {
    catalog: await catalog()
  };
  if (!v.project) fail('--project is required.');
  const root = path.resolve(v.project);
  if (command === 'init') return init(root, v.name);
  if (command === 'inspect') return read(root);
  if (command === 'import') {
    let options = {
      kind: v.kind,
      files: v.file,
      atlas: v.atlas,
      animation: v.animation,
      width: Number(v.width),
      height: Number(v.height),
      rows: v.rows?.split(','),
      extractFps: v['extract-fps'] ? Number(v['extract-fps']) : undefined
    };
    if (v['catalog-id']) {
      const item = (await catalog()).find(i => i.id === v['catalog-id']);
      if (!item) fail('Catalog entry not found.');
      options = {
        ...options,
        kind: 'atlas',
        file: item.file,
        atlas: item.atlas,
        character: item.character
      };
      delete options.files;
    }
    return importAssets(root, Number(v.revision), options);
  }
  if (command === 'edit') {
    if (!v.ops) fail('--ops JSON file is required.');
    return edit(root, Number(v.revision), JSON.parse(await fs.readFile(v.ops, 'utf8')));
  }
  if (command === 'validate') return validate(root);
  if (['render', 'export'].includes(command)) {
    if (!v.out) fail('--out is required.');
    const out = path.resolve(v.out);
    const live = path.resolve(__dirname, '../public');
    if (out === live || out.startsWith(live + path.sep) || out === root || ['sources', 'frames', 'revisions'].some(d => out === path.join(root, d) || out.startsWith(path.join(root, d) + path.sep))) fail('Choose a separate output directory, outside live game assets and project source folders.');
    return command === 'render' ? renderReview(root, out, {
      animation: v.animation,
      frame: v.frame
    }) : exportBundle(root, out, {
      zip: v.zip
    });
  }
  fail(`Unknown command: ${command}`);
}
if (require.main === module) main().then(result => {
  if (result) console.log(result.help || JSON.stringify(result, null, 2));
}).catch(e => {
  console.error(JSON.stringify({
    error: e.message,
    code: e.code || 'ERROR'
  }));
  process.exitCode = e.code === 'CONFLICT' ? 3 : 1;
});
module.exports = {
  main
};
