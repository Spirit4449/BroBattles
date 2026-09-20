const fs = require('node:fs/promises');
const path = require('node:path');
const {
  randomUUID
} = require('node:crypto');
const ROWS = ['idle', 'running', 'jumping', 'falling', 'attack', 'dying', 'wall', 'special'];
function fail(message, code = 'INVALID') {
  const e = new Error(message);
  e.code = code;
  throw e;
}
function local(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) fail('Expected a project-relative path.');
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) fail('Path leaves project.');
  return resolved;
}
async function atomic(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n');
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, {
      force: true
    });
  }
}
async function read(root) {
  const p = JSON.parse(await fs.readFile(path.join(root, 'project.json'), 'utf8'));
  if (p.version !== 1) fail('Unsupported project version.');
  return p;
}
async function init(root, name = path.basename(root)) {
  await fs.mkdir(root, {
    recursive: true
  });
  const lock = path.join(root, '.lock');
  try {
    await fs.mkdir(lock);
  } catch {
    fail('Project is busy.', 'CONFLICT');
  }
  try {
    try {
      await fs.access(path.join(root, 'project.json'));
      fail('Project already exists.');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    for (const d of ['sources', 'frames', 'revisions']) await fs.mkdir(path.join(root, d), {
      recursive: true
    });
    const p = {
      version: 1,
      id: randomUUID(),
      name,
      revision: 0,
      cellSize: 256,
      normalized: false,
      animations: ROWS.map(key => ({
        key,
        fps: 12,
        loop: ['idle', 'running', 'falling', 'wall'].includes(key),
        frames: []
      })),
      frames: {},
      portrait: null,
      imports: [],
      past: [],
      future: []
    };
    await atomic(path.join(root, 'project.json'), p);
    return p;
  } finally {
    await fs.rmdir(lock);
  }
}
function snapshot(p) {
  const {
    revision,
    past,
    future,
    ...data
  } = p;
  return data;
}
async function transact(root, revision, action) {
  const lock = path.join(root, '.lock');
  try {
    await fs.mkdir(lock);
  } catch (e) {
    if (e.code === 'EEXIST') fail('Project is busy; retry after refreshing.', 'CONFLICT');
    throw e;
  }
  try {
    const p = await read(root);
    if (!Number.isInteger(revision) || p.revision !== revision) fail(`Revision conflict: expected ${revision}, current ${p.revision}. Refresh before retrying.`, 'CONFLICT');
    const before = structuredClone(snapshot(p));
    await action(p);
    const saved = `revisions/${p.revision}-${randomUUID()}.json`;
    await atomic(local(root, saved), before);
    p.past.push(saved);
    p.future = [];
    p.revision++;
    await atomic(path.join(root, 'project.json'), p);
    return p;
  } finally {
    await fs.rmdir(lock);
  }
}
async function history(root, revision, direction) {
  const lock = path.join(root, '.lock');
  try {
    await fs.mkdir(lock);
  } catch {
    fail('Project is busy.', 'CONFLICT');
  }
  try {
    const p = await read(root);
    if (p.revision !== revision) fail('Revision conflict. Refresh before retrying.', 'CONFLICT');
    const from = direction === 'undo' ? 'past' : 'future',
      to = direction === 'undo' ? 'future' : 'past';
    if (!p[from].length) fail(`Nothing to ${direction}.`);
    const next = JSON.parse(await fs.readFile(local(root, p[from].pop()), 'utf8'));
    const saved = `revisions/${p.revision}-${randomUUID()}.json`;
    await atomic(local(root, saved), snapshot(p));
    p[to].push(saved);
    const result = {
      ...next,
      revision: p.revision + 1,
      past: p.past,
      future: p.future
    };
    await atomic(path.join(root, 'project.json'), result);
    return result;
  } finally {
    await fs.rmdir(lock);
  }
}
function animation(p, key) {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(key || '')) fail('Animation keys must be lowercase identifiers.');
  let a = p.animations.find(a => a.key === key);
  if (!a) {
    a = {
      key,
      fps: 12,
      loop: false,
      frames: []
    };
    p.animations.push(a);
  }
  return a;
}
function number(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) fail(`Invalid ${label}: expected ${min}–${max}.`);
  return value;
}
module.exports = {
  fs,
  path,
  randomUUID,
  ROWS,
  fail,
  local,
  atomic,
  read,
  init,
  transact,
  history,
  animation,
  number
};
