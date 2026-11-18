const {
  DECLINE_WINDOW_DAYS,
  DECLINE_COOLDOWN_MINUTES,
  MAX_DECLINES,
  MAX_REQUESTS_PER_DAY,
  isGuestRow,
  MAX_FRIENDS,
  toPublicUser,
} = require("./friendRules");
const { httpError } = require("../httpError");
const { isAccountBanned } = require("../../../shared/moderation/accountBan");
const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");

function createFriendRequests({
  assertRegistered,
  resolveTarget,
  areFriends,
  countFriends,
  db,
  assertAcceptsRequest,
  notifyChanged,
  emitToUser,
  getStatusForName,
}) {
  async function acceptRequestRow(q, row) {
    await q(
      "UPDATE friend_requests SET status = 'accepted', responded_at = NOW() WHERE request_id = ?",
      [row.request_id],
    );
    await q("INSERT IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?), (?, ?)", [
      row.from_user_id,
      row.to_user_id,
      row.to_user_id,
      row.from_user_id,
    ]);
  }

  // Stops re-sending after declines and cancel/resend loops.
  async function assertCanRequest(q, fromId, toId, toName) {
    const [row] = await q(
      `SELECT
         SUM(status = 'declined' AND responded_at > NOW() - INTERVAL ${DECLINE_WINDOW_DAYS} DAY) AS declines,
         SUM(status = 'declined' AND responded_at > NOW() - INTERVAL ${DECLINE_COOLDOWN_MINUTES} MINUTE) AS recent_declines,
         SUM(created_at > NOW() - INTERVAL 1 DAY) AS recent_requests
       FROM friend_requests
       WHERE from_user_id = ? AND to_user_id = ?`,
      [fromId, toId],
    );
    if (Number(row?.declines) >= MAX_DECLINES) {
      throw httpError(429, `${toName} isn't accepting friend requests from you right now.`);
    }
    if (Number(row?.recent_declines) > 0) {
      throw httpError(429, `${toName} declined your request. You can try again in a few minutes.`);
    }
    if (Number(row?.recent_requests) >= MAX_REQUESTS_PER_DAY) {
      throw httpError(429, `You've sent ${toName} a lot of requests. Try again tomorrow.`);
    }
  }

  async function sendRequest(user, target) {
    assertRegistered(user);
    const me = Number(user.user_id);
    const other = await resolveTarget(target || {});
    if (!other) throw httpError(404, "We couldn't find a player with that name or code.");
    const otherId = Number(other.user_id);
    if (otherId === me) throw httpError(400, "That's you! Try a friend's code instead.");
    if (isGuestRow(other))
      throw httpError(400, "That player needs an account before you can add them.");
    if (isAccountBanned(other))
      throw httpError(404, "We couldn't find a player with that name or code.");
    if (await areFriends(me, otherId))
      throw httpError(409, `You and ${other.name} are already friends.`);
    if ((await countFriends(me)) >= MAX_FRIENDS)
      throw httpError(409, `Your friends list is full (${MAX_FRIENDS} max).`);

    const result = await db.withTransaction(async (_conn, q) => {
      const reverse = await q(
        `SELECT * FROM friend_requests
          WHERE status = 'pending' AND from_user_id = ? AND to_user_id = ?
          FOR UPDATE`,
        [otherId, me],
      );
      // They already asked us, so asking back accepts.
      if (reverse[0]) {
        await acceptRequestRow(q, reverse[0]);
        return { status: "accepted" };
      }
      await assertAcceptsRequest(q, me, other);
      await assertCanRequest(q, me, otherId, other.name);
      try {
        const insert = await q(
          "INSERT INTO friend_requests (from_user_id, to_user_id) VALUES (?, ?)",
          [me, otherId],
        );
        return { status: "pending", requestId: Number(insert.insertId) };
      } catch (error) {
        if (error?.code === "ER_DUP_ENTRY")
          throw httpError(409, `You already sent ${other.name} a request.`);
        throw error;
      }
    });
    notifyChanged(me, otherId);
    if (result.status === "pending") {
      emitToUser(otherId, SOCKET_EVENTS.FRIENDS_REQUEST, {
        from: toPublicUser(user, "online"),
        requestId: result.requestId,
      });
    }
    return { ...result, user: toPublicUser(other, getStatusForName(other.name)) };
  }

  async function respondToRequest(user, requestId, accept) {
    assertRegistered(user);
    const me = Number(user.user_id);
    const row = await db.withTransaction(async (_conn, q) => {
      const rows = await q(
        `SELECT * FROM friend_requests
          WHERE request_id = ? AND to_user_id = ? AND status = 'pending'
          FOR UPDATE`,
        [Number(requestId), me],
      );
      if (!rows[0]) throw httpError(404, "That request is no longer available.");
      if (accept) {
        if ((await countFriends(me)) >= MAX_FRIENDS)
          throw httpError(409, `Your friends list is full (${MAX_FRIENDS} max).`);
        await acceptRequestRow(q, rows[0]);
      } else {
        await q(
          "UPDATE friend_requests SET status = 'declined', responded_at = NOW() WHERE request_id = ?",
          [rows[0].request_id],
        );
      }
      return rows[0];
    });
    notifyChanged(me, row.from_user_id);
    return { status: accept ? "accepted" : "declined" };
  }

  async function cancelRequest(user, requestId) {
    assertRegistered(user);
    const me = Number(user.user_id);
    const rows = await db.runQuery(
      "SELECT to_user_id FROM friend_requests WHERE request_id = ? AND from_user_id = ? AND status = 'pending' LIMIT 1",
      [Number(requestId), me],
    );
    if (!rows[0]) throw httpError(404, "That request is no longer available.");
    await db.runQuery(
      "UPDATE friend_requests SET status = 'cancelled', responded_at = NOW() WHERE request_id = ? AND status = 'pending'",
      [Number(requestId)],
    );
    notifyChanged(me, rows[0].to_user_id);
    return { status: "cancelled" };
  }

  async function removeFriend(user, friendId) {
    assertRegistered(user);
    const me = Number(user.user_id);
    const other = Number(friendId);
    const result = await db.runQuery(
      "DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
      [me, other, other, me],
    );
    if (!result.affectedRows) throw httpError(404, "That player isn't on your friends list.");
    notifyChanged(me, other);
    return { removed: true };
  }

  return { sendRequest, respondToRequest, cancelRequest, removeFriend };
}

module.exports = { createFriendRequests };
