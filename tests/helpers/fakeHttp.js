function fakeRes({ statusField = 'statusCode', bodyField = 'body', ...extensions } = {}) {
  return {
    [statusField]: 200,
    [bodyField]: null,
    status(code) { this[statusField] = code; return this; },
    json(body) { this[bodyField] = body; return this; },
    ...extensions,
  };
}

function fakeReq(overrides = {}) {
  return {
    method: 'GET',
    headers: {},
    body: {},
    params: {},
    query: {},
    signedCookies: {},
    get(name) { return this.headers[name.toLowerCase()]; },
    ...overrides,
  };
}

module.exports = { fakeReq, fakeRes };
