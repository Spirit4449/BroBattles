const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGameDataForMatch } = require('../src/server/services/gameDataService');
const { registerPageRoutes } = require('../src/server/routes/modules/pageRoutes');

for (const [rows, code] of [
  [[], 'MATCH_UNAVAILABLE'],
  [[{ status: 'completed' }], 'MATCH_ENDED'],
  [[{ status: 'cancelled' }], 'MATCH_ENDED'],
  [[{ status: 'queued' }], 'MATCH_NOT_READY'],
]) {
  test(`game data identifies ${code} (${rows[0]?.status || 'missing'})`, async () => {
    const result = await buildGameDataForMatch({
      db: { runQuery: async () => rows },
      requireCurrentUser: async () => ({ user_id: 1 }),
      req: { body: { matchId: 7 } }, res: {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.payload.code, code);
  });
}

for (const status of [null, 'completed', 'cancelled', 'live', 'queued']) {
  test(`game page handles ${status || 'missing'} matches`, async () => {
    const routes = new Map();
    registerPageRoutes({
      app: { get: (path, handler) => routes.set(path, handler) },
      db: { runQuery: async () => status ? [{ status }] : [] },
      pageRoot: '/pages', distDir: '/dist',
    });
    let redirect, file;
    await routes.get('/game/:matchid')({ params: { matchid: '7' } }, {
      redirect: value => { redirect = value; }, sendFile: value => { file = value; },
    });
    if (status === 'live' || status === 'queued') assert.equal(file, '/pages/game.html');
    else assert.equal(redirect, '/');
  });
}
