const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('rapid reward impacts overlap in a bounded reusable pool and honor volume settings', () => {
  const clones = [];
  let settingsListener;
  class AudioStub {
    addEventListener() {}
    removeEventListener() {}
    load() {}
    cloneNode() { const audio = new AudioStub(); clones.push(audio); return audio; }
    play() { return Promise.resolve(); }
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/uiSounds.js'), 'utf8')
    .replace(/^import .*;$/gm, '').replaceAll('export function', 'function');
  const playSound = vm.runInNewContext(source + '; playSound', {
    Audio: AudioStub,
    getSettings: () => ({ sfx: .5 }),
    subscribeSettings: listener => { settingsListener = listener; },
    shouldMuteClientDefaultLogs: () => true,
  });
  for (let i = 0; i < 56; i++) playSound('rewardCoinImpact', .12, { overlap: true, maxVoices: 8, playbackRate: 1.2 });
  assert.equal(clones.length, 8);
  assert.ok(clones.every(voice => voice.volume === .06 && voice.playbackRate === 1.2));
  settingsListener({ sfx: 0 });
  assert.ok(clones.every(voice => voice.volume === 0));
  clones.forEach(voice => voice.onended());
  playSound('rewardCoinImpact', .12, { overlap: true, maxVoices: 8 });
  assert.equal(clones.length, 8, 'finished voices are reused rather than allocated again');
});

test('reveal choir grows with currency value and preserves unlock rarity floors', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/rewardPresentation.js'), 'utf8').replaceAll('export function', 'function');
  const { rewardSound, currencyParticleCount } = vm.runInNewContext(source + '; ({ rewardSound, currencyParticleCount })');
  const currency = (amount, type = 'coins') => ({ kind: 'currency', currency: type, amount });
  const tiers = ['rewardCoins', 'rewardGems', 'rewardUnlock', 'rewardEpic', 'rewardLegendary'];
  [50, 400, 1500, 5000, 10000].forEach((value, i) => {
    assert.equal(rewardSound([currency(value)]), tiers[i]);
    assert.equal(rewardSound([currency(value / 20, 'gems')]), tiers[i]);
  });
  assert.equal(rewardSound([currency(750), currency(750)]), 'rewardUnlock');
  assert.equal(rewardSound([{kind: 'skin'}]), 'rewardEpic');
  assert.equal(rewardSound([{kind: 'icon'}]), 'rewardUnlock');
  assert.equal(rewardSound([currency(1)], 'legendary'), 'rewardLegendary');
  assert.equal(currencyParticleCount('coins', 50), 2);
  assert.equal(currencyParticleCount('gems', 5), 4);
  assert.equal(currencyParticleCount('coins', 10000), 57);
  assert.equal(currencyParticleCount('coins', 50000), 96);
});
