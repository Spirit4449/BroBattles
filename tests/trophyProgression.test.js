const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildTrophyRewardTrack, summarizeCurrencyRewards } = require('../src/server/helpers/trophySystem');
const { getModeUnlockReason } = require('../src/shared/trophyProgression');
const { grantTrophyItems } = require('../src/server/helpers/trophyRewardGrants');
const { registerTrophyRoutes } = require('../src/server/routes/modules/trophyRoutes');
const { getAutoUnlockIconIds } = require('../src/server/helpers/profileIconOwnership');
const { getAutoUnlockSkinIds } = require('../src/server/helpers/skinOwnership');
const { assertModeAccess } = require('../src/server/helpers/trophyModeAccess');

test('road starts at 50, grows in spacing, places unlocks on exact tiers and ends at 10,000', () => {
  const road = buildTrophyRewardTrack();
  assert.deepEqual(road.slice(0, 10).map(t => t.trophiesRequired), [50,100,150,200,250,300,350,400,450,500]);
  assert.equal(road.at(-1).trophiesRequired, 10000);
  assert.equal(new Set(road.map(t => t.tierId)).size, road.length);
  assert.equal(new Set(road.map(t => t.trophiesRequired)).size, road.length);
  for (let i = 1; i < road.length; i++) assert.ok(road[i].trophiesRequired - road[i-1].trophiesRequired <= 500);
  assert.equal(road.at(-1).trophiesRequired - road.at(-2).trophiesRequired, 500);
  for (const tier of road.filter(t => t.rewards.some(r => r.kind === 'mode'))) {
    assert.equal(tier.rewards.length, 1);
    const mode = require('../src/shared/gameModes.catalog.json').modes.find(m => m.id === tier.rewards[0].itemId);
    assert.equal(mode.unlockTrophies, tier.trophiesRequired);
    assert.notEqual(getModeUnlockReason(mode.id, { trophies: tier.trophiesRequired - 1 }), '');
    assert.equal(getModeUnlockReason(mode.id, { trophies: tier.trophiesRequired }), '');
  }
  for (const [threshold, item] of [[100,'capture-flag'],[250,'bank-bust'],[750,'airdrop'],[1500,'soccer'],[2000,'gloop'],[2500,'bedwars']]) {
    assert.ok(road.find(t => t.trophiesRequired === threshold).rewards.some(r => r.itemId === item));
  }
  assert.deepEqual(road.at(-1).rewards.map(r => r.kind).sort(), ['card','currency','currency','profileIcon','skin']);
  assert.deepEqual(summarizeCurrencyRewards(road.at(-1).rewards), { coins: 6000, gems: 250 });
});

test('all trophy art is bundled or explicitly awaits the user-supplied numeric icon', () => {
  const root = path.resolve(__dirname, '../public');
  for (const tier of buildTrophyRewardTrack()) for (const reward of tier.rewards) {
    if (!fs.existsSync(path.join(root, reward.image))) {
      assert.match(reward.itemId, /^(500|1000|5000|7500|10000)trophies$/);
      assert.ok(fs.existsSync(path.join(root, reward.fallbackImage)));
    }
  }
});

test('mode access uses the host peak for parties and personal unlocks for selection', async () => {
  for (const mode of ['duels','tower','bot-survival']) assert.equal(getModeUnlockReason(mode, { trophies: 0 }), '');
  assert.match(getModeUnlockReason('bank-bust', { trophies: 249 }), /250/);
  assert.equal(getModeUnlockReason('bank-bust', { trophies: 200, trophy_peak: 250 }), '');
  let host = { name: 'Leader', trophy_peak: 500 };
  const newcomer = { name: 'New player', trophy_peak: 249 };
  const db = { runQuery: async (sql, params) => {
    if (sql.includes('JOIN users')) {
      assert.match(sql, /ORDER BY pm.joined_at ASC, pm.name ASC LIMIT 1/);
      return [host];
    }
    return params[0] === 'Leader' ? [host] : [newcomer];
  } };
  await assert.doesNotReject(assertModeAccess(db, 'bank-bust', { partyId: 1 }));
  await assert.rejects(assertModeAccess(db, 'bank-bust', { actorName: 'New player' }), /New player: Unlock at 250/);
  await assert.doesNotReject(assertModeAccess(db, 'bank-bust', { actorName: 'Leader' }));
  await assert.rejects(assertModeAccess(db, 'bank-bust', { userId: 2 }), /Unlock at 250/);
  host = newcomer;
  await assert.rejects(assertModeAccess(db, 'bank-bust', { partyId: 1 }), /Unlock at 250/);

});

test('trophy cosmetics require a claim, and retired 200 icon is never auto-granted', () => {
  const player = { trophies: 10000, trophy_peak: 10000, char_levels: { ninja: 1, gloop: 1 } };
  const icons = getAutoUnlockIconIds(player);
  assert.ok(!icons.includes('200trophies'));
  assert.ok(!icons.includes('10000trophies'));
  assert.ok(!getAutoUnlockSkinIds(player).includes('ninja-arena-sovereign'));
});

class TrophyDb {
  constructor() {
    this.state = { user: { user_id: 1, trophies: 10000, trophy_peak: 10000, coins: 90, gems: 10, char_levels: { ninja: 1, gloop: 0 } }, claims: new Set(), grants: [] };
    this.lock = Promise.resolve();
  }
  async withTransaction(fn) {
    const previous = this.lock;
    let unlock; this.lock = new Promise(resolve => { unlock = resolve; });
    await previous;
    const before = structuredClone(this.state);
    try { return await fn(null, this.runQuery.bind(this)); }
    catch (error) { this.state = before; throw error; }
    finally { unlock(); }
  }
  async runQuery(sql, params = []) {
    if (sql.startsWith('SELECT tier_id')) return [...this.state.claims].map(tier_id => ({tier_id}));
    if (sql.startsWith('SELECT')) return [structuredClone(this.state.user)];
    if (sql.startsWith('INSERT IGNORE INTO user_trophy_reward_claims')) {
      if (this.state.claims.has(params[1])) return { affectedRows: 0 };
      this.state.claims.add(params[1]); return { affectedRows: 1 };
    }
    if (sql.startsWith('INSERT IGNORE INTO user_')) {
      if (this.failGrant) throw Object.assign(new Error('storage unavailable'), { httpStatus: 503 });
      this.state.grants.push(params[1]); return { affectedRows: 1 };
    }
    if (sql.startsWith('UPDATE users SET coins')) {
      this.state.user.coins += params[0]; this.state.user.gems += params[1]; return { affectedRows: 1 };
    }
    if (sql.startsWith('UPDATE users SET char_levels')) {
      const key = params[0].slice(2); this.state.user.char_levels[key] = Math.max(1, this.state.user.char_levels[key] || 0); return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query ${sql}`);
  }
}
function routeFixture(db) {
  const routes = new Map();
  registerTrophyRoutes({ app: { get: (p, h) => routes.set(p, h), post: (p, h) => routes.set(p, h) }, db, requireCurrentUser: async () => ({ user_id: 1 }) });
  return async (path, body = {}) => {
    const response = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await routes.get(path)({body}, response); return response;
  };
}

test('concurrent finale claims grant exactly one complete bundle', async () => {
  const db = new TrophyDb(); const call = routeFixture(db);
  const results = await Promise.all([call('/trophies/claim', {tierId:'trophy-tier-10000'}), call('/trophies/claim', {tierId:'trophy-tier-10000'})]);
  assert.deepEqual(results.map(r => r.code).sort(), [200,409]);
  assert.equal(db.state.user.coins, 6090); assert.equal(db.state.user.gems, 260);
  assert.deepEqual(db.state.grants.sort(), ['10000trophies','arena-crown','ninja-arena-sovereign']);
  assert.equal(results.find(r => r.code === 200).data.grants.length, 5);
});

test('a failed cosmetic grant rolls back the receipt and wallet and remains retryable', async () => {
  const db = new TrophyDb(); const call = routeFixture(db); db.failGrant = true;
  assert.equal((await call('/trophies/claim', {tierId:'trophy-tier-10000'})).code, 503);
  assert.equal(db.state.claims.size, 0); assert.equal(db.state.user.coins, 90);
  db.failGrant = false;
  assert.equal((await call('/trophies/claim', {tierId:'trophy-tier-10000'})).code, 200);
});

test('peak trophies preserve claim eligibility; future tiers cannot be forged', async () => {
  const db = new TrophyDb(); const call = routeFixture(db);
  db.state.user.trophies = 1700; db.state.user.trophy_peak = 2000;
  const road = (await call('/trophies/progression')).data;
  assert.equal(road.tiers.find(t => t.trophiesRequired === 2000).canClaim, true);
  assert.equal((await call('/trophies/claim', {tierId:'trophy-tier-2500'})).code, 400);
  assert.equal((await call('/trophies/claim', {tierId:'trophy-tier-2000'})).code, 200);
  assert.equal(db.state.user.char_levels.gloop, 1);
  assert.ok(db.state.grants.includes('gloop-default'));
  assert.equal((await call('/trophies/claim', {tierId:'trophy-tier-10001'})).code, 400);
});

test('Bro grants preserve an already upgraded character', async () => {
  const db = new TrophyDb(); db.state.user.char_levels.gloop = 8;
  await grantTrophyItems(db.runQuery.bind(db), 1, [{kind:'character',itemId:'gloop'}]);
  assert.equal(db.state.user.char_levels.gloop, 8);
});


test('currency caches use round amounts in both the road and claim payout', async () => {
  const road = buildTrophyRewardTrack();
  const currencies = road.flatMap(tier => tier.rewards).filter(reward => reward.kind === 'currency');
  assert.ok(currencies.filter(reward => reward.currency === 'gems').every(reward => reward.amount % 5 === 0));
  assert.ok(!currencies.some(reward => reward.currency === 'coins' && reward.amount === 900));
  for (const [currency, amount] of [['coins', 100], ['coins', 1000], ['coins', 1200], ['gems', 5], ['gems', 25], ['gems', 40], ['gems', 60]]) {
    const tier = road.find(tier => tier.rewards.length === 1 && tier.rewards[0].currency === currency && tier.rewards[0].amount === amount);
    assert.ok(tier, `${amount} ${currency} reward must exist`);
    const db = new TrophyDb();
    const before = db.state.user[currency];
    const response = await routeFixture(db)('/trophies/claim', { tierId: tier.tierId });
    assert.equal(response.code, 200);
    assert.equal(db.state.user[currency] - before, amount);
  }
});


test('regular currency caches start small and grow through the road', () => {
  const road = buildTrophyRewardTrack();
  for (const [currency, first, last] of [['coins', 100, 1200], ['gems', 5, 60]]) {
    const caches = road.filter(tier => tier.rewards.length === 1 && tier.rewards[0].currency === currency);
    const amounts = caches.map(tier => tier.rewards[0].amount);
    assert.equal(amounts[0], first);
    assert.equal(amounts.at(-1), last);
    assert.ok(new Set(amounts).size >= 7);
    assert.ok(amounts.every((amount, index) => index === 0 || amount >= amounts[index - 1]));
  }
  const finale = road.at(-1);
  assert.deepEqual(summarizeCurrencyRewards(finale.rewards), { coins: 6000, gems: 250 });
});
