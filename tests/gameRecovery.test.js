const { loadClientModule } = require('./helpers/clientModule');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe("Recovery actions", () => {
  const api = {};
  loadClientModule(require.resolve("../src/client/game/match/gameErrorActions.js"), { exports: api });

  test("game errors map to the action that resolves them", () => {
    const actionFor = (code) => api.resolveGameErrorAction({ code }).action;
    assert.equal(actionFor("UNAUTHORIZED"), "login");
    assert.equal(actionFor("BANNED"), "banned");
    assert.equal(actionFor("CLIENT_UPDATE_REQUIRED"), "reload");
    assert.equal(actionFor("MATCH_FINISHED"), "lobby");
    assert.equal(actionFor("ROOM_NOT_FOUND"), "lobby");
    assert.equal(actionFor("MM_SUSPENDED"), "lobby");
  });

  test("unknown game errors offer a retry", () => {
    assert.equal(api.resolveGameErrorAction({ message: "boom" }).action, "reload");
    assert.equal(api.resolveGameErrorAction(undefined).action, "reload");
  });

  test("editor playtests never navigate away from the editor", () => {
    const ctx = { editorPlaytest: true };
    assert.equal(api.resolveGameErrorAction({ code: "MATCH_FINISHED" }, ctx).action, "dismiss");
    assert.equal(api.resolveGameErrorAction({ code: "UNAUTHORIZED" }, ctx).action, "dismiss");
    assert.equal(api.resolveGameErrorAction({ code: "CLIENT_UPDATE_REQUIRED" }, ctx).action, "reload");
  });

  test('live ban notifications and banned reconnects leave the game for account support', () => {
    const { EventEmitter } = require('node:events');
    const { createClientModuleGraph } = require('./helpers/clientModule');
    const socket = new EventEmitter();
    const destinations = [];
    const window = { location: { pathname: '/', search: '', replace: value => destinations.push(value) } };
    createClientModuleGraph({ globals: { window }, imports: { 'socket.io-client': { io: () => socket } } }).load('src/client/lib/socket.js');
    socket.emit('connect_error', new Error('Network unavailable'));
    assert.deepEqual(destinations, []);
    socket.emit('auth:banned', { reason: 'Restriction' });
    socket.emit('connect_error', new Error('Account banned'));
    assert.deepEqual(destinations, ['/banned', '/banned']);
  });
});

describe("Stale matches", () => {
  const { buildGameDataForMatch } = require('../src/server/services/match/gameDataService');
  const { registerPageRoutes } = require('../src/server/routes/modules/pageRoutes');

  test("unavailable match data reports the correct recovery code", async () => {
for (const [rows, code] of [
    [[], 'MATCH_UNAVAILABLE'],
    [[{ status: 'completed' }], 'MATCH_ENDED'],
    [[{ status: 'cancelled' }], 'MATCH_ENDED'],
    [[{ status: 'queued' }], 'MATCH_NOT_READY'],
  ]) {
    {
      const result = await buildGameDataForMatch({
        db: { runQuery: async () => rows },
        requireCurrentUser: async () => ({ user_id: 1 }),
        req: { body: { matchId: 7 } }, res: {},
      });
      assert.equal(result.ok, false);
      assert.equal(result.payload.code, code);
    }
  }
});

  test("game pages serve playable matches and redirect stale ones", async () => {
for (const status of [null, 'completed', 'cancelled', 'live', 'queued']) {
    {
      const routes = new Map();
      registerPageRoutes({
        app: { get: (path, handler) => routes.set(path, handler) },
        db: { runQuery: async () => status ? [{ status }] : [] },
        requireCurrentUser: async () => null,
        pageRoot: '/pages', distDir: '/dist',
      });
      let redirect, file;
      await routes.get('/game/:matchid')({ params: { matchid: '7' } }, {
        redirect: value => { redirect = value; }, sendFile: value => { file = value; },
      });
      if (status === 'live' || status === 'queued') assert.equal(file, '/pages/game.html');
      else assert.equal(redirect, '/');
    }
  }
});
});

test('the first guest battle owns tutorial DOM and socket listeners until it is destroyed', () => {
  const { createBrowserFixture } = require('./helpers/browserFixture');
  const { SOCKET_EVENTS } = require('../src/shared/net/socketEvents');
  const f = createBrowserFixture();
  const { createBattleTutorialController } = f.load('src/client/game/hud/battleTutorialController.js');
  const controllerFor = (matchId, isGuest) =>
    createBattleTutorialController({ socket: f.socket, getGameData: () => ({ matchId, isGuest }) });
  assert.equal(controllerFor('member-match', false).initialize(), false);
  const first = controllerFor('guest-match', true);
  assert.equal(first.initialize(), true);
  assert.equal(first.initialize(), true);
  assert.equal(f.document.querySelectorAll('#battle-tutorial').length, 1);
  assert.equal(f.socket.listenerCount(SOCKET_EVENTS.GAME_CHAT_MESSAGE), 1);
  first.destroy();
  assert.equal(f.document.getElementById('battle-tutorial'), null);
  assert.equal(f.socket.listenerCount(SOCKET_EVENTS.GAME_CHAT_MESSAGE), 0);
  assert.equal(controllerFor('later-match', true).initialize(), false);
  assert.equal(f.document.getElementById('battle-tutorial'), null);
});

test('tutorial hints follow remapped keys while a wall-jump hint is visible', () => {
  const { createBrowserFixture } = require('./helpers/browserFixture');
  const f = createBrowserFixture();
  const settings = f.load('src/client/site/preferences.js');
  const { createBattleTutorialController } = f.load('src/client/game/hud/battleTutorialController.js');
  const tutorial = createBattleTutorialController({
    socket: f.socket,
    getGameData: () => ({ matchId: 'wall', isGuest: true }),
    getPlayer: () => ({ active: true, body: { touching: { left: true } } }),
    isBattleReady: () => true,
  });
  assert.ok(tutorial.initialize());
  tutorial.update();
  assert.ok(f.document.querySelector('kbd[data-codes="KeyW"]'));
  settings.saveSettings({ keys: { ...settings.getSettings().keys, up: 75 } });
  const hint = f.document.querySelector('kbd[data-codes="KeyK"]');
  assert.equal(hint.textContent, 'K');
  f.window.dispatchEvent(Object.assign(new f.window.Event('keydown'), { code: 'KeyK' }));
  assert.ok(hint.classList.contains('is-down'));
  tutorial.destroy();
});
