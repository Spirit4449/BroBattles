#!/usr/bin/env node
// Longest unbroken stretches a CPU profile spent below one function, and where
// each went: finds single long calls (a 400 ms bot tick) that totals hide.
//   node scripts/dev/cpuprofile-spans.cjs <file.cpuprofile> [--under "tick src/server/core/bots/controller"] [--top 5]
const fs = require('node:fs');
const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const file = argv.find(a => a.endsWith('.cpuprofile'));
const under = opt('under', 'tick src/server/core/bots/controller');
const top = Number(opt('top', 5));
const prof = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = new Map(prof.nodes.map(n => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
const label = (n) => `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url || '').replace(/^.*\/(src|node_modules)\//, '$1/')}:${n.callFrame.lineNumber + 1}`;
const stackOf = (id) => { const s = []; for (let c = id; c != null; c = parent.get(c)) s.push(label(nodes.get(c))); return s; };
const spans = []; let cur = null;
for (let i = 0; i < prof.samples.length; i++) {
  const stack = stackOf(prof.samples[i]), dt = (prof.timeDeltas[i + 1] ?? 0) / 1000;
  const at = stack.findIndex(f => f.includes(under));
  if (at < 0) { if (cur) spans.push(cur); cur = null; continue; }
  cur ||= { ms: 0, frames: new Map() };
  cur.ms += dt;
  // Attribute to each frame between the function and the leaf.
  for (const f of new Set(stack.slice(0, at))) cur.frames.set(f, (cur.frames.get(f) || 0) + dt);
}
if (cur) spans.push(cur);
for (const s of spans.sort((a, b) => b.ms - a.ms).slice(0, top)) {
  console.log(`\n${s.ms.toFixed(0)} ms unbroken below ${under}`);
  for (const [f, ms] of [...s.frames].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${ms.toFixed(0).padStart(6)} ms  ${f}`);
}
