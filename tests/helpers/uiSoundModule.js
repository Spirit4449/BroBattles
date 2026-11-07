const { loadClientModule } = require('./clientModule');

function loadUISounds(globals = {}) {
  const { getSettings = () => ({ sfx: 1 }), subscribeSettings = () => {}, ...browser } = globals;
  return loadClientModule(require.resolve('../../src/client/ui/uiSounds.js'), {
    ...browser,
    require: name => name.includes('preferences') ? { getSettings, subscribeSettings }
      : { shouldMuteClientDefaultLogs: () => true },
  });
}

module.exports = { loadUISounds };
