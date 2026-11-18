const { createFriendPrivacy } = require("./friendPrivacy");
const { createFriendGraph } = require("./friendGraph");
const { createFriendRequests } = require("./friendRequests");
const { createFriendMessages } = require("./friendMessages");
const { createFriendPresence } = require("./friendPresence");
const { httpError } = require("../httpError");

const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");

const { isGuestRow } = require("./friendRules");

function createFriendService({ db, io }) {
  // Injected by initSocket once the activity service exists.
  let readStatus = () => "offline";
  const getStatusForName = (name) => readStatus(name);

  function emitToUser(userId, event, payload) {
    io?.to?.(`user:${Number(userId)}`)?.emit?.(event, payload);
  }

  function assertRegistered(user) {
    if (!user?.user_id) throw httpError(401, "Please sign in to use friends.");
    if (isGuestRow(user)) throw httpError(403, "Create an account to add friends.");
  }

  async function areFriends(userId, friendId) {
    const rows = await db.runQuery(
      "SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ? LIMIT 1",
      [Number(userId), Number(friendId)],
    );
    return rows.length > 0;
  }

  async function assertFriends(userId, friendId) {
    if (!(await areFriends(userId, friendId)))
      throw httpError(403, "You're not friends with this player anymore.");
  }

  async function countFriends(userId) {
    const rows = await db.runQuery("SELECT COUNT(*) AS c FROM friendships WHERE user_id = ?", [
      Number(userId),
    ]);
    return Number(rows[0]?.c) || 0;
  }

  function notifyChanged(...userIds) {
    for (const id of userIds) emitToUser(id, SOCKET_EVENTS.FRIENDS_CHANGED, {});
  }

  function attachPresence({ getStatus }) {
    if (typeof getStatus === "function") readStatus = getStatus;
  }

  const {
    getPrivacy,
    getUserWithPrivacy,
    sharesReadReceipts,
    assertAcceptsRequest,
    getPrivacySettings,
    updatePrivacy,
    canShowTyping,
  } = createFriendPrivacy({ db, assertRegistered, emitToUser, notifyChanged, areFriends });
  const { resolveTarget, getOverview, getSuggestions, getRelationship } = createFriendGraph({
    db,
    getStatusForName,
    assertRegistered,
    getPrivacy,
    areFriends,
  });
  const { sendRequest, respondToRequest, cancelRequest, removeFriend } = createFriendRequests({
    assertRegistered,
    resolveTarget,
    areFriends,
    countFriends,
    db,
    assertAcceptsRequest,
    notifyChanged,
    emitToUser,
    getStatusForName,
  });
  const { reactToMessage, getConversation, sendMessage, markRead } = createFriendMessages({
    getUserWithPrivacy,
    db,
    assertRegistered,
    assertFriends,
    emitToUser,
    sharesReadReceipts,
  });
  const { sendPartyInvite, handleStatusChange } = createFriendPresence({
    assertRegistered,
    assertFriends,
    db,
    getUserWithPrivacy,
    getStatusForName,
    emitToUser,
  });

  return {
    io,
    attachPresence,
    handleStatusChange,
    areFriends,
    canShowTyping,
    getOverview,
    getPrivacySettings,
    updatePrivacy,
    getSuggestions,
    getRelationship,
    sendRequest,
    respondToRequest,
    cancelRequest,
    removeFriend,
    getConversation,
    sendMessage,
    reactToMessage,
    markRead,
    sendPartyInvite,
  };
}

module.exports = { createFriendService };
