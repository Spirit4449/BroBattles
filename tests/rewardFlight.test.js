const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/rewardPresentation.js'), 'utf8').replaceAll('export function', 'function');
const { currencyParticleCount, currencyFlightPlan, currencyRewardImage } = vm.runInNewContext(source + '; ({ currencyParticleCount, currencyFlightPlan, currencyRewardImage })');

test('reward bursts grow with value, remain bounded, and never invent pieces for zero rewards', () => {
  for (const currency of ['coins', 'gems']) {
    const amounts = currency === 'coins' ? [50, 300, 1200, 6000, 1000000] : [5, 15, 50, 250, 1000000];
    const counts = amounts.map(amount => currencyParticleCount(currency, amount));
    for (let i = 1; i < counts.length; i++) assert.ok(counts[i] > counts[i - 1]);
    assert.ok(counts.every((count, i) => count <= amounts[i] && count <= 96));
    assert.equal(currencyParticleCount(currency, 0), 0);
    assert.equal(currencyParticleCount(currency, -10), 0);
    assert.match(currencyRewardImage(currency, amounts[0]), /\/currency\/.*-small\.webp$/);
  }
});

test('varied flight curves all arrive at the wallet and finish in a bounded time', () => {
  const sourceRect = { left: 300, top: 400, width: 180, height: 180 };
  const targetRect = { left: 100, top: 20, width: 100, height: 40 };
  const plans = Array.from({ length: 96 }, (_, index) => {
    let seed = index + 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    return currencyFlightPlan({ sourceRect, targetRect, index, count: 96, random });
  });
  assert.equal(new Set(plans.map(plan => plan.keyframes[10].transform)).size, 96);
  for (const plan of plans) {
    assert.match(plan.keyframes.at(-1).transform, /^translate3d\(134px,24px,0\)/);
    assert.equal(plan.keyframes[0].opacity, 0);
    assert.equal(plan.keyframes.at(-1).opacity, 1);
    assert.ok(plan.duration + plan.delay < 3400);
    assert.ok(plan.keyframes.every(frame => !/NaN|Infinity/.test(frame.transform)));
  }
});
