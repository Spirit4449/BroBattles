const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { isolateDevAssetResponse } = require('../src/server/helpers/devAssetMiddleware');

for (const state of ['headersSent', 'writableEnded', 'streaming', 'unhandled', 'error']) {
  test(`development asset handoff: ${state}`, () => {
    const response = new EventEmitter();
    const calls = [];
    const error = new Error('middleware failure');
    isolateDevAssetResponse((_req, res, next) => {
      if (state === 'streaming') res.emit('pipe', {});
      if (state === 'headersSent' || state === 'writableEnded') res[state] = true;
      next(state === 'error' ? error : undefined);
    })({}, response, value => calls.push(value));
    assert.deepEqual(calls, state === 'unhandled' ? [undefined] : state === 'error' ? [error] : []);
    assert.equal(response.listenerCount('pipe'), 0);
  });
}
