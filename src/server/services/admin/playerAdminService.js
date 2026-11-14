const { getSkinsCatalog, getCharacterSkins, buildSkinAssetUrl, normalizeSelectedSkinMap } = require("../cosmetics/skinsCatalog");
const { getProfileIconsCatalog } = require("../cosmetics/profileIconsCatalog");
const { getPlayerCardsCatalog } = require("../cosmetics/playerCardsCatalog");
const { getTitlesCatalog } = require("../cosmetics/titlesCatalog");
const { getAutoUnlockSkinIds } = require("../cosmetics/skinOwnership");
const { getAutoUnlockIconIds } = require("../cosmetics/profileIconOwnership");
const { getCurrentWinStreak, getHighestWinStreak } = require("../match/battleLog");

const INVENTORIES = {
  skins: { table: "user_skins", column: "skin_id" },
  icons: { table: "user_profile_icons", column: "icon_id", selected: "selected_profile_icon_id" },
  cards: { table: "user_cards", column: "card_id", selected: "selected_card_id" },
  titles: { table: "user_titles", column: "title_id", selected: "selected_title_id" },
};
const fail = (status, message) => Object.assign(new Error(message), { status });

function inventoryCatalogs(user) {
  const cards = getPlayerCardsCatalog();
  const icons = getProfileIconsCatalog();
  return {
    skins: {
      items: Object.keys(getSkinsCatalog().characters || {}).flatMap(character => getCharacterSkins(character)).map(skin => ({ ...skin, assetUrl: buildSkinAssetUrl(skin.character, skin.id) })),
      automatic: getAutoUnlockSkinIds(user),
    },
    icons: { items: icons.icons || [], automatic: [...new Set([...getAutoUnlockIconIds(user), icons.defaultIconId].filter(Boolean))] },
    cards: { items: cards.cards || [], automatic: [cards.defaultCardId].filter(Boolean) },
    titles: { items: getTitlesCatalog().titles || [], automatic: [] },
  };
}

async function getPlayerInventory(db, user) {
  const catalogs = inventoryCatalogs(user);
  const inventory = {};
  await Promise.all(Object.entries(INVENTORIES).map(async ([kind, config]) => {
    const { items, automatic } = catalogs[kind];
    try {
      const rows = await db.runQuery(`SELECT ${config.column} FROM ${config.table} WHERE user_id = ?`, [user.user_id]);
      let selected = kind === "skins" ? normalizeSelectedSkinMap(user.selected_skin_id_by_char) : user[config.selected] || null;
      if (kind === "titles") {
        const [row] = await db.runQuery("SELECT selected_title_id FROM users WHERE user_id = ?", [user.user_id]);
        selected = row?.selected_title_id || null;
      }
      const owned = new Set([...rows.map(row => row[config.column]), ...automatic]);
      inventory[kind] = {
        items: items.map(({ id, name, assetUrl, rarity, character, color }) => ({ id, name, assetUrl, rarity, character, color, owned: owned.has(id), automatic: automatic.includes(id), equipped: kind === "skins" ? selected[character] === id : selected === id })),
      };
    } catch (error) {
      if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error.code)) throw error;
      inventory[kind] = { items: [], error: "Inventory unavailable; apply the cosmetic migrations." };
    }
  }));
  return inventory;
}

async function getPlayerStats(db, userId) {
  const [row] = await db.runQuery(
    `SELECT COUNT(*) AS total_matches,
       COALESCE(SUM(m.winner_team = p.team), 0) AS wins,
       COALESCE(SUM(m.winner_team IN ('team1', 'team2') AND m.winner_team <> p.team), 0) AS losses,
       COALESCE(SUM(m.winner_team = 'draw'), 0) AS draws
     FROM match_participants p JOIN matches m ON m.match_id = p.match_id
     WHERE p.user_id = ? AND m.status = 'completed'`, [userId],
  );
  const totalMatches = Number(row?.total_matches) || 0;
  const wins = Number(row?.wins) || 0;
  const losses = Number(row?.losses) || 0;
  const draws = Number(row?.draws) || 0;
  return { totalMatches, wins, losses, draws, unknown: Math.max(0, totalMatches - wins - losses - draws), winRate: totalMatches ? wins / totalMatches * 100 : 0, winStreak: await getCurrentWinStreak(db, userId) };
}

async function audit(q, userId, adminId, action, detail) {
  await q("INSERT INTO user_abuse_events (user_id, category, source, action_taken, offense_level, detail) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, "admin", "admin", action, 0, JSON.stringify({ adminUserId: adminId, ...detail })]);
}

function validateInventoryChanges(changes) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 500) throw fail(400, "Choose between 1 and 500 inventory changes");
  const seen = new Set();
  for (const change of changes) {
    if (!change || !Object.hasOwn(INVENTORIES, change.kind) || typeof change.id !== "string" || typeof change.owned !== "boolean") throw fail(400, "Invalid inventory change");
    const key = `${change.kind}:${change.id}`;
    if (seen.has(key)) throw fail(400, "Duplicate inventory change");
    seen.add(key);
  }
}

async function updatePlayerInventory(db, userId, adminId, changes) {
  validateInventoryChanges(changes);
  return db.withTransaction(async (_conn, q) => {
    const [user] = await q("SELECT * FROM users WHERE user_id = ? FOR UPDATE", [userId]);
    if (!user) throw fail(404, "Player not found");
    const runner = { runQuery: q };
    const inventory = await getPlayerInventory(runner, user);
    // Validate the entire patch before performing any writes.
    for (const change of changes) {
      const group = inventory[change.kind];
      if (group.error) throw fail(409, group.error);
      const item = group.items.find(item => item.id === change.id);
      if (!item) throw fail(400, "Unknown cosmetic");
      if (!change.owned && item.automatic) throw fail(400, `${item.name} is automatically unlocked and cannot be removed`);
    }
    const applied = [];
    for (const change of changes) {
      const item = inventory[change.kind].items.find(item => item.id === change.id);
      if (item.owned === change.owned) continue;
      const config = INVENTORIES[change.kind];
      if (change.owned) {
        await q(`INSERT IGNORE INTO ${config.table} (user_id, ${config.column}, source) VALUES (?, ?, 'admin')`, [userId, change.id]);
      } else {
        await q(`DELETE FROM ${config.table} WHERE user_id = ? AND ${config.column} = ?`, [userId, change.id]);
      }
      applied.push({ ...change, previouslyOwned: item.owned });
      item.owned = change.owned;
    }
    // Revoking an equipped item must not leave an invalid selection behind.
    for (const [kind, group] of Object.entries(inventory)) {
      if (group.error) continue;
      const removed = group.items.filter(item => item.equipped && !item.owned);
      if (!removed.length) continue;
      if (kind === "skins") {
        const selected = normalizeSelectedSkinMap(user.selected_skin_id_by_char);
        for (const item of removed) {
          const fallback = group.items.find(candidate => candidate.character === item.character && candidate.automatic && candidate.owned)
            || group.items.find(candidate => candidate.character === item.character && candidate.owned);
          if (fallback) {
            await q("INSERT IGNORE INTO user_skins (user_id, skin_id, source) VALUES (?, ?, 'auto')", [userId, fallback.id]);
            selected[item.character] = fallback.id;
          }
          else delete selected[item.character];
        }
        await q("UPDATE users SET selected_skin_id_by_char = ? WHERE user_id = ?", [JSON.stringify(selected), userId]);
      } else {
        const fallback = kind === "titles" ? null : (group.items.find(item => item.automatic && item.owned) || group.items.find(item => item.owned))?.id || null;
        if (fallback) {
          const config = INVENTORIES[kind];
          await q(`INSERT IGNORE INTO ${config.table} (user_id, ${config.column}, source) VALUES (?, ?, 'auto')`, [userId, fallback]);
        }
        await q(`UPDATE users SET ${INVENTORIES[kind].selected} = ? WHERE user_id = ?`, [fallback, userId]);
      }
    }
    if (applied.length) {
      await q("UPDATE users SET updated_at = NOW() WHERE user_id = ?", [userId]);
      await audit(q, userId, adminId, "inventory_edit", { changes: applied });
    }
    return { changed: applied.length };
  });
}

async function setPlayerStreak(db, userId, adminId, streak) {
  if (!Number.isInteger(streak) || streak < 0 || streak > 10000) throw fail(400, "Streak must be a whole number between 0 and 10,000");
  return db.withTransaction(async (_conn, q) => {
    const [user] = await q("SELECT user_id FROM users WHERE user_id = ? FOR UPDATE", [userId]);
    if (!user) throw fail(404, "Player not found");
    // Draws and unknown outcomes remain untouched, matching normal streak rules.
    const rows = await q(
      `SELECT m.match_id, m.winner_team, m.summary, p.team
       FROM match_participants p JOIN matches m ON m.match_id = p.match_id
       WHERE p.user_id = ? AND m.status = 'completed'
         AND m.winner_team IN ('team1', 'team2') AND p.team IN ('team1', 'team2')
       ORDER BY m.match_id DESC LIMIT ? FOR UPDATE`, [userId, streak + 1],
    );
    if (rows.length < streak) throw fail(400, `Only ${rows.length} completed battles with a recorded winner are available`);
    const changes = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const winner = i < streak ? row.team : row.team === "team1" ? "team2" : "team1";
      if (row.winner_team === winner) continue;
      let summary = row.summary;
      if (typeof summary === "string") {
        try { summary = JSON.parse(summary); } catch { summary = null; }
      }
      if (summary && typeof summary === "object" && !Array.isArray(summary)) summary = { ...summary, winnerTeam: winner };
      else summary = null;
      await q("UPDATE matches SET winner_team = ?, summary = ? WHERE match_id = ?", [winner, summary ? JSON.stringify(summary) : null, row.match_id]);
      changes.push({ matchId: row.match_id, before: row.winner_team, after: winner });
    }
    if (changes.length) {
      const matchIds = changes.map(change => change.matchId);
      const participants = await q(`SELECT DISTINCT user_id FROM match_participants WHERE match_id IN (${matchIds.map(() => "?").join(",")}) AND user_id IS NOT NULL ORDER BY user_id`, matchIds);
      const runner = { runQuery: q };
      for (const participant of participants) {
        const highest = await getHighestWinStreak(runner, participant.user_id);
        await q("UPDATE users SET highest_win_streak = GREATEST(COALESCE(highest_win_streak, 0), ?) WHERE user_id = ?", [highest, participant.user_id]);
      }
      await audit(q, userId, adminId, "streak_edit", { streak, matches: changes });
    }
    return { streak, changedMatches: changes.length };
  });
}

module.exports = { getPlayerStats, getPlayerInventory, updatePlayerInventory, setPlayerStreak };
