const { httpError } = require("../src/server/services/httpError");
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTransactionalDb } = require('./helpers/fakeDb');
const { fakeReq, fakeRes } = require('./helpers/fakeHttp');

const { buildTrophyRewardTrack, summarizeCurrencyRewards, calculateTrophyDelta, resolveMatchModeId } = require('../src/server/services/trophies/trophySystem');
const { getModeUnlockReason } = require('../src/shared/trophyProgression');
const { grantTrophyItems } = require('../src/server/services/trophies/trophyRewardGrants');
const { registerTrophyRoutes } = require('../src/server/routes/modules/trophyRoutes');
const { getAutoUnlockIconIds } = require('../src/server/services/cosmetics/profileIconOwnership');
const { getAutoUnlockSkinIds } = require('../src/server/services/cosmetics/skinOwnership');
const { assertModeAccess } = require('../src/server/services/trophies/trophyModeAccess');

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
    const mode = require('../src/shared/catalogs/gameModes.catalog.json').modes.find(m => m.id === tier.rewards[0].itemId);
    assert.equal(mode.unlockTrophies, tier.trophiesRequired);
    assert.notEqual(getModeUnlockReason(mode.id, { trophies: tier.trophiesRequired - 1 }), '');
    assert.equal(getModeUnlockReason(mode.id, { trophies: tier.trophiesRequired }), '');
  }
  for (const [threshold, item] of [[100,'capture-flag'],[250,'bank-bust'],[750,'airdrop'],[1500,'soccer'],[2000,'gloop'],[2500,'bedwars']]) {
    assert.ok(road.find(t => t.trophiesRequired === threshold).rewards.some(r => r.itemId === item));
  }
  assert.deepEqual(road.at(-1).rewards.map(r => r.kind).sort(), ['card','currency','currency','profileIcon','skin']);
  const finaleCurrency = summarizeCurrencyRewards(road.at(-1).rewards);
  assert.ok(finaleCurrency.coins > 0 && finaleCurrency.gems > 0);
});

test('trophy scoring respects mode ranges, zero performance weights and zero loss mitigation', () => {
  const { DEFAULT_MODE_ID } = require('../src/shared/gameSelection');
  assert.equal(resolveMatchModeId({ modeId: ' ' }), DEFAULT_MODE_ID);
  assert.equal(resolveMatchModeId({ modeId: ' bank-bust ' }), 'bank-bust');

  const catalog = {
    modeTrophyRanges: { default: { min: 10, max: 20 }, custom: { min: 20, max: 40 } },
    performanceWeights: { hits: 0, damage: 1, kills: 0 },
    drawRangeScale: 0,
    lossRangeScale: 0.5,
    lossPerformanceMitigation: 0,
  };
  const input = {
    modeId: ' custom ', winnerTeam: 'team1', playerTeam: 'team1',
    bucket: { hits: 5, damage: 50, kills: 5 },
    maxima: { hits: 5, damage: 100, kills: 5 }, currentTrophies: 100,
  };
  assert.deepEqual(calculateTrophyDelta(input, catalog), { trophiesDelta: 30, performanceScore: 0.5 });
  assert.equal(calculateTrophyDelta({ ...input, modeId: 'toString' }, catalog).trophiesDelta, 15);
  assert.equal(calculateTrophyDelta({ ...input, winnerTeam: null }, catalog).trophiesDelta, 0);
  const loss = { ...input, winnerTeam: 'team2' };
  assert.equal(calculateTrophyDelta(loss, catalog).trophiesDelta, -20);
  assert.equal(calculateTrophyDelta({ ...loss, currentTrophies: 3 }, catalog).trophiesDelta, -3);
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
    const state = { user: { user_id: 1, trophies: 10000, trophy_peak: 10000, coins: 90, gems: 10, char_levels: { ninja: 1, gloop: 0 } }, claims: new Set(), grants: [] };
    this.db = createTransactionalDb({ state, query: this.query.bind(this) });
    this.runQuery = this.db.runQuery;
    this.withTransaction = this.db.withTransaction;
  }

  get state() {
    return this.db.state;
  }

  async query(state, sql, params) {
    if (sql.startsWith('SELECT tier_id')) return [...state.claims].map(tier_id => ({tier_id}));
    if (sql.startsWith('SELECT')) return [structuredClone(state.user)];
    if (sql.startsWith('INSERT IGNORE INTO user_trophy_reward_claims')) {
      if (state.claims.has(params[1])) return { affectedRows: 0 };
      state.claims.add(params[1]); return { affectedRows: 1 };
    }
    if (sql.startsWith('INSERT IGNORE INTO user_')) {
      if (this.failGrant) throw httpError(503, "storage unavailable");
      state.grants.push(params[1]); return { affectedRows: 1 };
    }
    if (sql.startsWith('UPDATE users SET coins')) {
      state.user.coins += params[0]; state.user.gems += params[1]; return { affectedRows: 1 };
    }
    if (sql.startsWith('UPDATE users SET char_levels')) {
      const key = params[0].slice(2); state.user.char_levels[key] = Math.max(1, state.user.char_levels[key] || 0); return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query ${sql}`);
  }
}
function routeFixture(db) {
  const routes = new Map();
  registerTrophyRoutes({ app: { get: (p, h) => routes.set(p, h), post: (p, h) => routes.set(p, h) }, db, requireCurrentUser: async () => ({ user_id: 1 }) });
  return async (path, body = {}) => {
    const response = fakeRes({ statusField: 'code', bodyField: 'data' });
    await routes.get(path)(fakeReq({ method: 'POST', body }), response);
    return response;
  };
}

test('concurrent finale claims grant exactly one complete bundle', async () => {
  const db = new TrophyDb(); const call = routeFixture(db);
  const results = await Promise.all([call('/trophies/claim', {tierId:'trophy-tier-10000'}), call('/trophies/claim', {tierId:'trophy-tier-10000'})]);
  assert.deepEqual(results.map(r => r.code).sort(), [200,409]);
  const finale = buildTrophyRewardTrack().at(-1);
  const currency = summarizeCurrencyRewards(finale.rewards);
  assert.equal(db.state.user.coins, 90 + currency.coins); assert.equal(db.state.user.gems, 10 + currency.gems);
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

test('Bro grants preserve an upgraded character and award its catalog default skin', async () => {
  const { getDefaultSkinId } = require('../src/server/services/cosmetics/skinsCatalog');
  const db = new TrophyDb(); db.state.user.char_levels.gloop = 8;
  await grantTrophyItems(db.runQuery.bind(db), 1, [{kind:'character',itemId:'gloop'}]);
  assert.equal(db.state.user.char_levels.gloop, 8);
  assert.ok(db.state.grants.includes(getDefaultSkinId('gloop')));
});

test('overlapping leaderboard requests share one ranked page and expose only the displayed scores', async () => {
  const { createLeaderboardService } = require('../src/server/services/trophies/leaderboardService');
  let searches = 0;
  const getLeaderboard = createLeaderboardService({ runQuery: async () => {
    searches++;
    return ['One', 'Two'].map(username => ({ user_id: 42, username, charClass: 'ninja', trophies: 20, wins: 2 }));
  } });
  const [one, two] = await Promise.all([getLeaderboard(1), getLeaderboard(2)]);
  assert.equal(searches, 1);
  assert.deepEqual(two.map(row => row.rank), [1, 2]);
  assert.equal(one[0].username, 'One');
  assert.equal(one[0].wins, 2);
  assert.equal('userId' in one[0] || 'totalMatches' in one[0], false);
});
