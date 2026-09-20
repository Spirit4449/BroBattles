const { BannerPlugin } = require('webpack');
const fs = require('node:fs');
const path = require('node:path');
const bindings = 'window,document,location,setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame,cancelAnimationFrame,fetch,Audio,ResizeObserver,MutationObserver,IntersectionObserver';

// Lexical wrappers give every mounted bundle (including lazy chunks) a lifetime
// without globally patching browser APIs or rewriting each feature module.
class PageRuntimePlugin {
  apply(compiler) {
    const exclude = /bundles\/navigation(?:\.|$)/;
    new BannerPlugin({ raw: true, test: /\.js$/, exclude, banner: `;(function(__scope){if(!__scope)return;(function({${bindings}}){` }).apply(compiler);
    new BannerPlugin({ raw: true, footer: true, test: /\.js$/, exclude, banner: '\n})(__scope);})(window.__BB_NAVIGATION__ ? window.__BB_NAVIGATION__.scriptScope() : window);' }).apply(compiler);
    compiler.hooks.thisCompilation.tap('BattlePreload', compilation => {
      compilation.hooks.processAssets.tap({ name: 'BattlePreload', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
        const root = path.resolve(compiler.context, 'public/assets');
        const urls = compilation.getAssets().filter(asset => /^bundles\/mode-.*\.(js|css)$/.test(asset.name)).map(asset => `/${asset.name}`);
        // Characters/skins come from the current lobby roster. This manifest
        // contains only shared assets and optional mode chunks.
        for (const folder of ['movement', 'parachutes', 'tombstones']) {
          const dir = path.join(root, folder);
          if (fs.existsSync(dir)) for (const file of fs.readdirSync(dir)) {
            if (/\.(webp|mp3|wav)$/.test(file) && fs.statSync(path.join(dir, file)).size < 1024 * 1024) urls.push(`/assets/${folder}/${file}`);
          }
        }
        urls.push(...['coin.webp', 'gem.webp', 'spectate.webp', 'death.mp3', 'you-death.mp3', 'damage.mp3', 'win.mp3', 'lose.mp3', 'noammo.mp3', 'coin.mp3', 'gem.mp3'].map(name => `/assets/${name}`));
        compilation.emitAsset('battle-preload.json', new compiler.webpack.sources.RawSource(JSON.stringify(urls)));
      });
    });
  }
}
module.exports = PageRuntimePlugin;
