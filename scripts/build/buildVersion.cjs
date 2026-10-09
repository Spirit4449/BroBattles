const { execFileSync } = require('node:child_process');
const path = require('node:path');
const release = require('../../src/shared/site/siteConfig.json').version;
function createBuildVersion({ cwd = path.resolve(__dirname, '../..'), mode = 'production' } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = git('rev-parse', 'HEAD');
  const shallow = git('rev-parse', '--is-shallow-repository') === 'true';
  if (shallow) throw new Error('Build numbering requires full Git history. Run git fetch --unshallow before building.');
  const build = Number(git('rev-list', '--count', 'HEAD'));
  const dirty = !!git('status', '--porcelain', '--untracked-files=normal');
  return { version: release, build, commit, dirty, mode, builtAt: new Date().toISOString() };
}
class BuildVersionPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('BuildVersionPlugin', compilation => {
      const stamp = createBuildVersion({ mode: compiler.options.mode });
      compilation.hooks.processAssets.tap({ name: 'BuildVersionPlugin', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
        compilation.emitAsset('build-version.json', new compiler.webpack.sources.RawSource(JSON.stringify(stamp, null, 2)));
      });
    });
  }
}
module.exports = { createBuildVersion, BuildVersionPlugin };
