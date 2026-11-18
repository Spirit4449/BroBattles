const { createPartyChatHistory } = require("./partyChatHistory");
const { createPartyChatMessages } = require("./partyChatMessages");
const { createPartyChatRead } = require("./partyChatRead");
const { httpError } = require("../httpError");
const { sanitizeBody, normalizeReaction } = require("./messageRules");

function createPartyChatService({ db, io }) {
  async function assertPartyMembership(partyId, user) {
    const userName = String(user?.name || "").trim();
    if (!Number.isFinite(Number(partyId)) || Number(partyId) <= 0 || !userName) {
      throw new Error("Party membership required");
    }
    const rows = await db.runQuery(
      "SELECT 1 FROM party_members WHERE party_id = ? AND name = ? LIMIT 1",
      [Number(partyId), userName],
    );
    if (!rows?.length) {
      throw httpError(403, "Not a member of this party");
    }
    return { partyId: Number(partyId), userName };
  }

  const { fetchCurrentUserReadState, getPartyChatHistory, getChatMessageById } =
    createPartyChatHistory({ db, assertPartyMembership, io });
  const { sendPartyChatMessage, reactToPartyChatMessage } = createPartyChatMessages({
    assertPartyMembership,
    db,
    getChatMessageById,
    io,
  });
  const { markPartyChatRead } = createPartyChatRead({
    assertPartyMembership,
    fetchCurrentUserReadState,
    db,
    io,
  });

  return {
    sanitizeBody,
    normalizeReaction,
    getPartyChatHistory,
    getChatMessageById,
    sendPartyChatMessage,
    reactToPartyChatMessage,
    markPartyChatRead,
  };
}

module.exports = { createPartyChatService };
