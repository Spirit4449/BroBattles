#!/usr/bin/env node
// Usage: node scripts/art/pixel-cards/build.cjs <card-id ...> [--install]
// Renders each card into output/pixel-cards/<id>/ and, with --install,
// replaces its exports in public/assets/player-cards and updates the catalog.
const { build } = require('./lib.cjs');
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const install = process.argv.includes('--install');
(async () => {
  for (const id of ids) {
    const t = Date.now();
    const { sizes, width, height } = await build(require(`./cards/${id}.cjs`), { install });
    console.log(`${id}: ${width}x${height} webm ${(sizes.webm / 1024).toFixed(0)}KB mov ${(sizes.mov / 1024).toFixed(0)}KB poster ${(sizes.poster / 1024).toFixed(0)}KB${install ? ' (installed)' : ''} ${((Date.now() - t) / 1000).toFixed(0)}s`);
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
