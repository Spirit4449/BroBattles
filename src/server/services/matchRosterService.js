const { normalizeSelectionFromRow } = require("../helpers/gameSelectionCatalog");
const { normalizeSelectedSkinMap, resolveSelectedSkinId, buildSkinAssetUrl, getSkinGameAssets } = require("../helpers/skinsCatalog");
const { characterLevel } = require("../core/bots/identity");

function decorateParticipant(p) {
  const selected = resolveSelectedSkinId({ character: p.char_class,
    selectedSkinMap: p.isBot ? {} : normalizeSelectedSkinMap(p.selected_skin_id_by_char) });
  return { ...p, participantId: p.participantId || `user:${p.user_id}`, isBot: p.isBot === true,
    level: characterLevel(p), selected_skin_id: selected,
    selected_skin_asset_url: buildSkinAssetUrl(p.char_class, selected),
    selected_skin_game_assets: getSkinGameAssets(p.char_class, selected) };
}

async function loadMatchRoster(db, matchId) {
  const humans = await db.runQuery(
    `SELECT mp.user_id, mp.party_id, mp.team, mp.char_class, u.name, u.char_levels,
            u.trophies, u.selected_profile_icon_id AS profile_icon_id, u.selected_skin_id_by_char
       FROM match_participants mp JOIN users u ON u.user_id = mp.user_id
      WHERE mp.match_id = ? ORDER BY mp.user_id`, [matchId]);
  let bots = [];
  try {
    bots = await db.runQuery("SELECT * FROM match_bot_participants WHERE match_id = ? ORDER BY participant_id", [matchId]);
  } catch (error) {
    // Human matches remain usable while the additive migration is being deployed.
    if (error.code !== "ER_NO_SUCH_TABLE") throw error;
  }
  return [...humans, ...bots.map((b) => ({ ...b, participantId: b.participant_id,
    user_id: null, party_id: null, isBot: true, botHealthOverride: b.health_override,
    difficulty: typeof b.difficulty === "string" ? JSON.parse(b.difficulty) : b.difficulty,
    profile_icon_id: b.char_class }))].map(decorateParticipant);
}

async function loadMatchData(db, matchId) {
  const [match] = await db.runQuery("SELECT * FROM matches WHERE match_id = ? LIMIT 1", [matchId]);
  if (!match) throw new Error("Match not found.");
  const selection = normalizeSelectionFromRow(match);
  return { mode: match.mode, ...selection, map: selection.mapId, players: await loadMatchRoster(db, matchId) };
}

async function deleteMatchBots(db, matchId) {
  try { await db.runQuery("DELETE FROM match_bot_participants WHERE match_id = ?", [matchId]); }
  catch (error) { if (error.code !== "ER_NO_SUCH_TABLE") throw error; }
}
module.exports = { decorateParticipant, loadMatchRoster, loadMatchData, deleteMatchBots };
