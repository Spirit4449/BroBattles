const DEFAULT_SHOP_TIMEZONE = "America/New_York";
const DAY_MS = 24 * 60 * 60 * 1000;

function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return values;
}

function zonedDateTimeToUtc(parts, timeZone) {
  const targetAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0,
  );
  let candidate = targetAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = getZonedParts(new Date(candidate), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour || 0,
      actual.minute || 0,
      actual.second || 0,
    );
    const delta = targetAsUtc - actualAsUtc;
    candidate += delta;
    if (delta === 0) break;
  }
  return new Date(candidate);
}

function addCalendarDays(parts, days) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + Number(days || 0)));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function formatDateKey(parts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getNaturalCycle(section, now = new Date(), timeZone = DEFAULT_SHOP_TIMEZONE) {
  const current = getZonedParts(now, timeZone);
  const dateOnly = {
    year: current.year,
    month: current.month,
    day: current.day,
  };
  const dailyOrdinal = Math.floor(Date.UTC(current.year, current.month - 1, current.day) / DAY_MS);

  if (section === "sales") {
    const weekday = new Date(Date.UTC(current.year, current.month - 1, current.day)).getUTCDay();
    const daysSinceMonday = (weekday + 6) % 7;
    const monday = addCalendarDays(dateOnly, -daysSinceMonday);
    const nextMonday = addCalendarDays(monday, 7);
    return {
      section,
      periodKey: `week:${formatDateKey(monday)}`,
      ordinal: Math.floor(Date.UTC(monday.year, monday.month - 1, monday.day) / DAY_MS / 7),
      nextRefreshAt: zonedDateTimeToUtc(nextMonday, timeZone),
    };
  }

  const tomorrow = addCalendarDays(dateOnly, 1);
  return {
    section: "dailies",
    periodKey: `day:${formatDateKey(dateOnly)}`,
    ordinal: dailyOrdinal,
    nextRefreshAt: zonedDateTimeToUtc(tomorrow, timeZone),
  };
}

function toMysqlDateTime(date) {
  return new Date(date).toISOString().slice(0, 19).replace("T", " ");
}

function normalizeRotationRow(row, natural) {
  const generation = Math.max(0, Number(row?.generation) || 0);
  return {
    section: natural.section,
    periodKey: natural.periodKey,
    generation,
    cycleKey: `${natural.periodKey}:g${generation}`,
    ordinal: natural.ordinal + generation,
    nextRefreshAt: natural.nextRefreshAt.toISOString(),
    refreshedAt: row?.refreshed_at ? new Date(row.refreshed_at).toISOString() : null,
  };
}

function createShopRotationService({ db, timeZone = DEFAULT_SHOP_TIMEZONE, getTimeZone = () => timeZone }) {
  // A duplicate-key update takes the row's exclusive lock immediately. Two
  // readers must not both hold INSERT IGNORE's shared lock and then upgrade it.
  async function lockRotation(q, natural) {
    await q(
      "INSERT INTO shop_rotation_state (section, period_key, generation, refreshed_at, next_refresh_at) VALUES (?, ?, 0, NOW(), ?) ON DUPLICATE KEY UPDATE section = shop_rotation_state.section",
      [natural.section, natural.periodKey, toMysqlDateTime(natural.nextRefreshAt)],
    );
    const rows = await q("SELECT * FROM shop_rotation_state WHERE section = ? FOR UPDATE", [
      natural.section,
    ]);
    return rows[0];
  }

  async function ensureLocked(q, section, now, zone) {
    const key = section === "sales" ? "sales" : "dailies";
    let natural = getNaturalCycle(key, now || new Date(), zone || getTimeZone());
    let row = await lockRotation(q, natural);
    // A competing purchase or admin refresh can hold the row past the boundary.
    if (!now) natural = getNaturalCycle(key, new Date(), zone || getTimeZone());
    if (row.period_key !== natural.periodKey) {
      await q(
        "UPDATE shop_rotation_state SET period_key = ?, generation = 0, refreshed_at = NOW(), next_refresh_at = ?, refreshed_by_user_id = NULL WHERE section = ?",
        [natural.periodKey, toMysqlDateTime(natural.nextRefreshAt), key],
      );
      [row] = await q("SELECT * FROM shop_rotation_state WHERE section = ?", [key]);
    }
    return normalizeRotationRow(row, natural);
  }

  function ensure(section, now, zone = getTimeZone()) {
    return db.withTransaction((_conn, q) => ensureLocked(q, section, now, zone));
  }

  async function forceRefresh(section, adminUserId, now = new Date()) {
    const normalizedSection = section === "sales" ? "sales" : "dailies";
    const natural = getNaturalCycle(normalizedSection, now, getTimeZone());
    return db.withTransaction(async (_conn, q) => {
      const current = await lockRotation(q, natural);
      if (current.period_key !== natural.periodKey) {
        await q(
          "UPDATE shop_rotation_state SET period_key = ?, generation = 0, refreshed_at = NOW(), next_refresh_at = ?, refreshed_by_user_id = NULL WHERE section = ?",
          [natural.periodKey, toMysqlDateTime(natural.nextRefreshAt), normalizedSection],
        );
      }
      await q(
        "UPDATE shop_rotation_state SET period_key = ?, generation = generation + 1, refreshed_at = NOW(), next_refresh_at = ?, refreshed_by_user_id = ? WHERE section = ?",
        [
          natural.periodKey,
          toMysqlDateTime(natural.nextRefreshAt),
          Number(adminUserId) || null,
          normalizedSection,
        ],
      );
      const rows = await q("SELECT * FROM shop_rotation_state WHERE section = ?", [
        normalizedSection,
      ]);
      return normalizeRotationRow(rows[0], natural);
    });
  }

  async function getBoth(now = new Date()) {
    const zone = getTimeZone();
    const [dailies, sales] = await Promise.all([ensure("dailies", now, zone), ensure("sales", now, zone)]);
    return { dailies, sales, timezone: zone };
  }

  return { ensure, ensureLocked, forceRefresh, getBoth, get timeZone() { return getTimeZone(); } };
}

module.exports = {
  DEFAULT_SHOP_TIMEZONE,
  createShopRotationService,
  getNaturalCycle,
};
