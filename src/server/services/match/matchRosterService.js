const { getCharacterLevel } = require('../../../shared/characters/characterStats');
const { normalizeSelectionFromRow } = require("./gameSelectionCatalog");
const { normalizeSelectedSkinMap, resolveSelectedSkinId, buildSkinAssetUrl, getSkinGameAssets } = require("../cosmetics/skinsCatalog");
const { characterLevel } = require("./bots/identity");
const { selectBotPlayerCard } = require("./bots/playerCards");

function decorateParticipant(p) {
  const selected = resolveSelectedSkinId({ character: p.char_class,
    selectedSkinMap: p.isBot ? {} : normalizeSelectedSkinMap(p.selected_skin_id_by_char) });
  return { ...p, participantId: p.participantId || `user:${p.user_id}`, isBot: p.isBot === true,
    level: characterLevel(p), selected_skin_id: selected,
    selected_card_id: p.isBot ? selectBotPlayerCard(p.seed, p.trophies) : p.selected_card_id,
    selected_skin_asset_url: buildSkinAssetUrl(p.char_class, selected),
    selected_skin_game_assets: getSkinGameAssets(p.char_class, selected) };
}

async function loadMatchRoster(db, matchId) {
  const humans = await db.runQuery(
    `SELECT mp.user_id, mp.party_id, mp.team, mp.char_class, u.name, u.char_levels,
            u.trophies, u.selected_profile_icon_id AS profile_icon_id, u.selected_skin_id_by_char, u.selected_title_id, u.selected_card_id
       FROM match_participants mp JOIN users u ON u.user_id = mp.user_id
      WHERE mp.match_id = ? ORDER BY mp.user_id`, [matchId]);
  const bots = await db.runQuery("SELECT * FROM match_bot_participants WHERE match_id = ? ORDER BY participant_id", [matchId]);
  return [...humans, ...bots.map((b) => ({ ...b, participantId: b.participant_id,
    user_id: null, party_id: null, isBot: true, botHealthOverride: b.health_override,
    difficulty: typeof b.difficulty === "string" ? JSON.parse(b.difficulty) : b.difficulty,
    profile_icon_id: b.char_class }))].map(decorateParticipant);
}

async function loadMatchData(db, matchId, { liveOnly = false } = {}) {
  const [match] = await db.runQuery("SELECT * FROM matches WHERE match_id = ? LIMIT 1", [matchId]);
  if (liveOnly && match?.status !== "live") return null;
  if (!match) throw new Error("Match not found.");
  const selection = normalizeSelectionFromRow(match);
  return { mode: match.mode, ...selection, map: selection.mapId, players: await loadMatchRoster(db, matchId) };
}

async function deleteMatchBots(db, matchId) {
  await db.runQuery("DELETE FROM match_bot_participants WHERE match_id = ?", [matchId]);
}
async function fetchRosterLevel(db, userId, character) {
  try {
    const [row] = await db.runQuery("SELECT char_levels FROM users WHERE user_id = ? LIMIT 1", [userId]);
    return Math.max(1, getCharacterLevel(row, character));
  } catch (error) {
    console.warn('[match] unable to load roster level', error.message);
    return 1;
  }
}
module.exports = { fetchRosterLevel, decorateParticipant, loadMatchRoster, loadMatchData, deleteMatchBots };
