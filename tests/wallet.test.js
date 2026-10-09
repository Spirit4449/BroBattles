const test = require('node:test');
const assert = require('node:assert/strict');

test('confirmed purchases update shared balances and every subscribed view, preserving absent currency', async () => {
  const { applyWallet, subscribeWallet, walletRevision } = await import('../src/client/lobby/wallet.mjs');
  const user = { coins: 900, gems: 80 };
  const header = { textContent: '' };
  const oldDocument = globalThis.document;
  globalThis.document = { getElementById: id => id === 'coin-count' ? header : null };
  const shop = {}, profile = {}, character = {};
  const unsubscribes = [shop, profile, character].map(view => subscribeWallet((wallet, owner) => {
    assert.equal(owner, user);
    Object.assign(view, wallet);
  }));
  try {
    const beforePurchase = walletRevision();
    applyWallet(user, { coins: 350 });
    assert.equal(header.textContent, '350');
    for (const view of [shop, profile, character]) assert.deepEqual(view, { coins: 350, gems: 80 });
    assert.equal(applyWallet(user, { coins: 900, gems: 80 }, beforePurchase), false);
    assert.equal(user.coins, 350, 'an older background response cannot undo a purchase');
    applyWallet(user, { coins: 0, gems: 0 });
    for (const view of [shop, profile, character]) assert.deepEqual(view, { coins: 0, gems: 0 });
    applyWallet(user, { coins: NaN, gems: -1 });
    assert.deepEqual(user, { coins: 0, gems: 0 });
  } finally {
    unsubscribes.forEach(unsubscribe => unsubscribe());
    globalThis.document = oldDocument;
  }
});
