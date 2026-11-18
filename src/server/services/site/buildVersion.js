const { getConfig } = require("../../config");
const fs = require('node:fs');
const path = require('node:path');
function readBuildVersion() {
  try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../dist/build-version.json'), 'utf8')); }
  catch (_) { return null; }
}
function createVersionService({ build = readBuildVersion(), fetchImpl = globalThis.fetch, now = Date.now,
  repository = getConfig().version.repository,
  branch = getConfig().version.branch, token = getConfig().version.token,
  production = getConfig().isProd } = {}) {
  let cached, expires = 0, pending;
  return async function getVersion() {
    const base = { ...build, branch, status: 'unknown', checkedAt: null };
    if (!production) return { ...base, status: 'development' };
    if (!build?.commit) return base;
    if (cached && now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      let result = base;
      try {
        if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository');
        const response = await fetchImpl(`https://api.github.com/repos/${repository}/commits/${encodeURIComponent(branch)}`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Bro-Battles-Version', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('Version check failed');
        const { sha } = await response.json();
        if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid commit');
        result = { ...base, latestCommit: sha, checkedAt: new Date(now()).toISOString(),
          status: build.dirty ? 'modified' : sha === build.commit ? 'current' : 'different' };
      } catch (_) { /* Unknown is preferable to a stale claim that production is current. */ }
      cached = result; expires = now() + 60000;
      return result;
    })();
    try { return await pending; } finally { pending = null; }
  };
}
module.exports = { createVersionService };
