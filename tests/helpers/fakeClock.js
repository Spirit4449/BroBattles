const TEST_NOW = Date.UTC(2026, 10, 12, 12);

function installFakeClock(t, { apis = ['Date'], now = TEST_NOW } = {}) {
  t.mock.timers.enable({ apis, now });
  return t.mock.timers;
}

module.exports = { TEST_NOW, installFakeClock };
