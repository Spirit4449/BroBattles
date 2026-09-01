const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createShopRotationService,
  getNaturalCycle,
} = require("../src/server/services/shopRotationService");

test("daily reset follows Eastern midnight across spring DST", () => {
  const before = getNaturalCycle(
    "dailies",
    new Date("2026-03-08T04:59:00.000Z"),
  );
  const after = getNaturalCycle(
    "dailies",
    new Date("2026-03-08T05:01:00.000Z"),
  );

  assert.equal(before.periodKey, "day:2026-03-07");
  assert.equal(before.nextRefreshAt.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(after.periodKey, "day:2026-03-08");
  assert.equal(after.nextRefreshAt.toISOString(), "2026-03-09T04:00:00.000Z");
});

test("daily reset follows Eastern midnight across fall DST", () => {
  const before = getNaturalCycle(
    "dailies",
    new Date("2026-11-01T03:59:00.000Z"),
  );
  const after = getNaturalCycle(
    "dailies",
    new Date("2026-11-01T04:01:00.000Z"),
  );

  assert.equal(before.periodKey, "day:2026-10-31");
  assert.equal(before.nextRefreshAt.toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(after.periodKey, "day:2026-11-01");
  assert.equal(after.nextRefreshAt.toISOString(), "2026-11-02T05:00:00.000Z");
});

test("sales reset at Monday midnight Eastern", () => {
  const sunday = getNaturalCycle(
    "sales",
    new Date("2026-08-31T03:59:00.000Z"),
  );
  const monday = getNaturalCycle(
    "sales",
    new Date("2026-08-31T04:01:00.000Z"),
  );

  assert.equal(sunday.periodKey, "week:2026-08-24");
  assert.equal(sunday.nextRefreshAt.toISOString(), "2026-08-31T04:00:00.000Z");
  assert.equal(monday.periodKey, "week:2026-08-31");
  assert.equal(monday.nextRefreshAt.toISOString(), "2026-09-07T04:00:00.000Z");
});

test("manual refresh advances the global generation without changing the natural reset", async () => {
  let row = null;
  const db = {
    withTransaction: async (fn) =>
      fn(null, async (sql, params) => {
        if (sql.startsWith("INSERT IGNORE INTO shop_rotation_state")) {
          if (!row) {
            row = {
              section: params[0],
              period_key: params[1],
              generation: 0,
              refreshed_at: new Date("2026-08-31T12:00:00.000Z"),
            };
          }
          return { affectedRows: row ? 0 : 1 };
        }
        if (sql.startsWith("SELECT * FROM shop_rotation_state")) return [row];
        if (sql.includes("generation = generation + 1")) {
          row = {
            ...row,
            period_key: params[0],
            generation: Number(row.generation) + 1,
            refreshed_at: new Date("2026-08-31T12:00:00.000Z"),
          };
          return { affectedRows: 1 };
        }
        if (sql.startsWith("UPDATE shop_rotation_state SET period_key")) {
          row = { ...row, period_key: params[0], generation: 0 };
          return { affectedRows: 1 };
        }
        throw new Error(`Unexpected SQL in test: ${sql}`);
      }),
  };
  const service = createShopRotationService({ db });
  const now = new Date("2026-08-31T12:00:00.000Z");
  const initial = await service.ensure("sales", now);
  const refreshed = await service.forceRefresh("sales", 42, now);

  assert.equal(initial.cycleKey, "week:2026-08-31:g0");
  assert.equal(refreshed.cycleKey, "week:2026-08-31:g1");
  assert.equal(refreshed.nextRefreshAt, initial.nextRefreshAt);
});
