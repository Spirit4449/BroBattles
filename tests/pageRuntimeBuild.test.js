const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const webpack = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const PageRuntimePlugin = require('../scripts/build/pageRuntime.cjs');
const VersionHtmlAssetsPlugin = require('../scripts/build/versionHtmlAssets.cjs');

for (const mode of ['development', 'production']) {
  test(`${mode} builds keep entry and lazy CSS outside the script lifetime`, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-runtime-'));
    let compiler;
    try {
      await fs.writeFile(path.join(directory, 'entry.js'), "import './style.css'; window.load = () => import(/* webpackChunkName: 'lazy' */ './lazy.js');");
      await fs.writeFile(path.join(directory, 'lazy.js'), "import './lazy.css'; window.loaded = true;");
      await fs.writeFile(path.join(directory, 'style.css'), '.lobby { display: flex; }');
      await fs.writeFile(path.join(directory, 'lazy.css'), '.battle { position: fixed; }');
      compiler = webpack({mode, context:directory, entry:{index:'./entry.js'}, devtool:false,
        output:{path:path.join(directory,'dist'),filename:'bundles/[name].js'},
        module:{rules:[{test:/\.css$/,use:[MiniCssExtractPlugin.loader,require.resolve('css-loader')]}]},
        plugins:[new PageRuntimePlugin(),new MiniCssExtractPlugin({filename:'bundles/[name].css'}),
          { apply(compiler) { compiler.hooks.thisCompilation.tap('TemplateFixture', compilation => {
            compilation.hooks.processAssets.tap({ name: 'TemplateFixture', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
              compilation.emitAsset('game.html', new webpack.sources.RawSource('<link href="/bundles/index.css"><script src="/bundles/index.js"></script><script>loadScript("/bundles/lazy.js")</script>'));
            });
          }); } },
          ...(mode === 'production' ? [new VersionHtmlAssetsPlugin()] : [])]});
      const stats = await new Promise((resolve,reject)=>compiler.run((error,result)=>error?reject(error):resolve(result)));
      assert.equal(stats.hasErrors(),false,stats.toString({all:false,errors:true}));
      for (const name of ['index','lazy']) {
        const css = await fs.readFile(path.join(directory,`dist/bundles/${name}.css`),'utf8');
        assert.doesNotMatch(css,/__scope|__BB_NAVIGATION__/);
        const js = await fs.readFile(path.join(directory,`dist/bundles/${name}.js`),'utf8');
        assert.match(js,/scriptScope/);
      }
      const html = await fs.readFile(path.join(directory, 'dist/game.html'), 'utf8');
      const source = await fs.readFile(require.resolve('../src/navigation/preload.js'), 'utf8');
      const { getTemplateResources } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
      const urls = getTemplateResources(html);
      assert.equal(urls.length, 3);
      for (const url of urls) {
        if (mode === 'production') assert.match(url, /\.[a-f0-9]{16}\.(js|css)$/);
        assert.ok((await fs.stat(path.join(directory, 'dist', url.slice(1)))).size > 0);
      }
    } finally {
      if (compiler) await new Promise(resolve=>compiler.close(resolve));
      await fs.rm(directory,{recursive:true,force:true});
    }
  });
}
