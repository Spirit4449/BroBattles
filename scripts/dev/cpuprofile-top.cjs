#!/usr/bin/env node
// Summarize a V8 .cpuprofile (node --cpu-prof): top functions by self and
// inclusive time, so a profile from the Pi can be read over SSH.
//   node scripts/dev/cpuprofile-top.cjs <file.cpuprofile|dir> [--top 25] [--filter bots]
//     [--under "tick src/server/core/bots/controller"]  (only samples below a frame)
const fs = require('node:fs');
const path = require('node:path');
const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
let file = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true);
if (!file) { console.error('usage: cpuprofile-top.cjs <file|dir> [--top N] [--filter text]'); process.exit(2); }
if (fs.statSync(file).isDirectory()) {
  const latest = fs.readdirSync(file).filter(f => f.endsWith('.cpuprofile'))
    .map(f => path.join(file, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  file = latest;
}
const top = Number(opt('top', 25));
const filter = opt('filter', null);
const under = opt('under', null);
const prof = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = new Map(prof.nodes.map(n => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
const dt = new Map();
for (let i = 0; i < prof.samples.length; i++) dt.set(prof.samples[i], (dt.get(prof.samples[i]) || 0) + (prof.timeDeltas[i] || 0));
const label = (n) => {
  const f = n.callFrame; const url = (f.url || '').replace(/^.*\/(src|scripts|tests|node_modules)\//, '$1/');
  return `${f.functionName || '(anon)'} ${url}:${f.lineNumber + 1}`;
};
const self = new Map(), incl = new Map();
let total = 0;
const below = (id) => { for (let cur = id; cur != null; cur = parent.get(cur)) if (label(nodes.get(cur)).includes(under)) return true; return false; };
for (const [id, us] of dt) {
  if (under && !below(id)) continue;
  total += us;
  const n = nodes.get(id);
  const key = label(n);
  self.set(key, (self.get(key) || 0) + us);
  const seen = new Set();
  for (let cur = id; cur != null; cur = parent.get(cur)) {
    const k = label(nodes.get(cur));
    if (seen.has(k)) continue; seen.add(k);
    incl.set(k, (incl.get(k) || 0) + us);
  }
}
const show = (map, title) => {
  console.log(`\n${title} (total ${(total / 1000).toFixed(0)}ms)`);
  [...map].filter(([k]) => !filter || k.includes(filter)).sort((a, b) => b[1] - a[1]).slice(0, top)
    .forEach(([k, us]) => console.log(`${(us / 1000).toFixed(0).padStart(7)}ms ${(100 * us / total).toFixed(1).padStart(5)}%  ${k}`));
};
console.log(path.basename(file));
show(self, 'self time');
show(incl, 'inclusive time');
