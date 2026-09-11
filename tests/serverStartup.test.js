const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

for (const mode of ['development', 'production']) {
  test(`${mode} server loads its real imports and registers routes before acquiring the database`, () => {
    const root = path.resolve(__dirname, '..');
    const script = `
      const Module = require('node:module');
      const originalLoad = Module._load;
      Module._load = function(request, parent, isMain) {
        // No local credentials or persistent database operations in this smoke test.
        if (request === 'dotenv') return { config() {} };
        if (request === './services/runtimeOwnershipService' && parent.filename.endsWith('/src/server/server.js')) {
          return { acquireRuntimeOwnership() { console.log('SERVER_BOOTSTRAP_READY'); process.exit(0); } };
        }
        return originalLoad.apply(this, arguments);
      };
      require('./src/server/server.js');
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: root,
      env: { PATH: process.env.PATH, NODE_ENV: mode, COOKIE_SECRET: 'isolated-startup-smoke-test' },
      encoding: 'utf8', timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /SERVER_BOOTSTRAP_READY/);
  });
}
