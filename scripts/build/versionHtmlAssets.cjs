const { createHash } = require('node:crypto');

// Keep old URLs for compatibility; new page loads receive content-addressed
// bundles so every CDN region and browser requests the deployed release.
class VersionHtmlAssetsPlugin {
  apply(compiler) {
    const { Compilation, sources } = compiler.webpack;
    compiler.hooks.thisCompilation.tap('VersionHtmlAssets', compilation => {
      compilation.hooks.processAssets.tap({name:'VersionHtmlAssets',stage:Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE}, () => {
        for (const html of compilation.getAssets().filter(a => a.name.endsWith('.html'))) {
          const content = html.source.source().toString().replace(/(["'])(\/bundles\/[^"'?\s]+\.(?:js|css))\1/g, (match, quote, url) => {
            const asset = compilation.getAsset(url.slice(1));
            if (!asset) return match;
            const hash = createHash('sha256').update(asset.source.buffer()).digest('hex').slice(0,16);
            const name = asset.name.replace(/\.(js|css)$/, `.${hash}.$1`);
            if (!compilation.getAsset(name)) compilation.emitAsset(name, asset.source, { ...asset.info, immutable: true });
            return `${quote}/${name}${quote}`;
          });
          compilation.updateAsset(html.name, new sources.RawSource(content));
        }
      });
    });
  }
}
module.exports = VersionHtmlAssetsPlugin;
