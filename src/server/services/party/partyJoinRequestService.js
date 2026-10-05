// Private-party join requests: owners review, requesters wait out a timeout
// and a cooldown between attempts.
const { resolveCharacterKey } = require("../../../shared/characters/characterStats.js");
const { PARTY_JOIN_REQUEST_TIMEOUT_MS } = require("../../../shared/gameConstants");
const { failure } = require("../serviceResult");

// Join request row with the requester's lobby details.
const JOIN_REQUEST_SELECT = `SELECT r.request_id, r.party_id, r.requester_user_id, r.request_count,
       r.status, r.requested_at, r.responded_at,
       u.name AS requester_name, u.char_class, u.status AS user_status, u.trophies
  FROM party_join_requests r
  JOIN users u ON u.user_id = r.requester_user_id`;

function createPartyJoinRequestService({ db, io, getPartyOwnerName }) {
  const MAX_JOIN_REQUESTS = 4; // requests a player may send to one party before cooldown
  const JOIN_REQUEST_TIMEOUT_MS = PARTY_JOIN_REQUEST_TIMEOUT_MS; // shared with the client countdown
  const JOIN_REQUEST_COOLDOWN_MS = 120_000; // lockout after MAX_JOIN_REQUESTS

  function isMissingJoinRequestTable(error) {
    return (
      error?.code === "ER_NO_SUCH_TABLE" &&
      /party_join_requests/i.test(
        String(error?.sqlMessage || error?.message || ""),
      )
    );
  }

  function buildJoinRequestState(requestRow) {
    if (!requestRow) {
      return {
        exists: false,
        status: "none",
        requestId: null,
        requestCount: 0,
        attemptsRemaining: 4,
        canRequest: true,
        requesterName: null,
        charClass: null,
        userStatus: null,
        trophies: 0,
        requestedAt: null,
        respondedAt: null,
      };
    }

    const requestCount = Math.max(1, Number(requestRow.request_count) || 0);
    const status = String(requestRow.status || "pending");
    const requestedAtMs = requestRow?.requested_at
      ? new Date(requestRow.requested_at).getTime()
      : 0;
    const respondedAtMs = requestRow?.responded_at
      ? new Date(requestRow.responded_at).getTime()
      : 0;
    const cooldownAnchorMs = Math.max(requestedAtMs || 0, respondedAtMs || 0);
    const cooldownRemainingMs = Math.max(
      0,
      cooldownAnchorMs
        ? JOIN_REQUEST_COOLDOWN_MS - (Date.now() - cooldownAnchorMs)
        : 0,
    );

    return {
      exists: true,
      status,
      requestId: Number(requestRow.request_id) || null,
      requestCount,
      attemptsRemaining:
        requestCount >= MAX_JOIN_REQUESTS && cooldownRemainingMs > 0
          ? 0
          : Math.max(0, MAX_JOIN_REQUESTS - requestCount),
      canRequest:
        status !== "pending" &&
        !(requestCount >= MAX_JOIN_REQUESTS && cooldownRemainingMs > 0),
      requesterName: String(requestRow.requester_name || ""),
      charClass: resolveCharacterKey(requestRow.char_class),
      userStatus: String(requestRow.user_status || "online"),
      trophies: Number(requestRow.trophies) || 0,
      requestedAt: requestRow.requested_at || null,
      respondedAt: requestRow.responded_at || null,
      cooldownRemainingMs,
    };
  }

  function isJoinRequestTimedOut(requestRow) {
    if (!requestRow) return false;
    if (String(requestRow.status || "") !== "pending") return false;
    const requestedAtMs = requestRow?.requested_at
      ? new Date(requestRow.requested_at).getTime()
      : 0;
    if (!requestedAtMs) return false;
    return Date.now() - requestedAtMs >= JOIN_REQUEST_TIMEOUT_MS;
  }

  async function getJoinRequestRowByUserId(conn, partyId, requesterUserId) {
    if (!requesterUserId) return null;
    const [rows] = await conn.query(
      `${JOIN_REQUEST_SELECT} WHERE r.party_id = ? AND r.requester_user_id = ? LIMIT 1 FOR UPDATE`,
      [partyId, requesterUserId],
    );
    return rows?.[0] || null;
  }

  async function getPendingJoinRequests({ partyId, actorName }) {
    if (!partyId || !actorName) {
      return failure(400, { error: "Party ID required" });
    }

    const ownerName = await getPartyOwnerName(partyId);
    if (ownerName !== actorName) {
      return failure(403, { error: "Only the party owner can review join requests." });
    }

    try {
      await db.runQuery(
        `UPDATE party_join_requests
            SET status = 'expired',
                responded_at = CURRENT_TIMESTAMP
          WHERE party_id = ?
            AND status = 'pending'
            AND requested_at <= DATE_SUB(NOW(), INTERVAL 15 SECOND)`,
        [partyId],
      );

      const requestRows = await db.runQuery(
        `${JOIN_REQUEST_SELECT} WHERE r.party_id = ? AND r.status = 'pending' ORDER BY r.requested_at ASC, r.request_id ASC`,
        [partyId],
      );

      return {
        ok: true,
        payload: {
          partyId,
          requests: requestRows.map((row) => ({
            requestId: Number(row.request_id) || null,
            partyId: Number(row.party_id) || null,
            requesterUserId: Number(row.requester_user_id) || null,
            requesterName: String(row.requester_name || ""),
            userStatus: String(row.user_status || "online"),
            status: String(row.status || "pending"),
            requestedAt: row.requested_at || null,
            respondedAt: row.responded_at || null,
          })),
        },
      };
    } catch (error) {
      if (isMissingJoinRequestTable(error)) {
        return {
          ok: false,
          statusCode: 500,
          payload: {
            error:
              "Party join requests are unavailable. Apply the join request migration first.",
          },
        };
      }
      throw error;
    }
  }

  async function emitJoinRequestUpdateToRequester(requestRow, payload) {
    const requesterUserId = Number(requestRow?.requester_user_id) || null;
    if (!requesterUserId) return;

    try {
      const rows = await db.runQuery(
        "SELECT socket_id FROM users WHERE user_id = ? LIMIT 1",
        [requesterUserId],
      );
      const socketId = rows?.[0]?.socket_id || null;
      if (!socketId) return;
      const sock = io.sockets.sockets.get(socketId);
      if (!sock) return;
      sock.emit("party:join-request:status", payload);
    } catch (error) {
      console.warn(
        "[party] join-request requester emit failed:",
        error?.message,
      );
    }
  }

  async function emitJoinRequestToOwner(partyId, requestRow) {
    const rows = await db.runQuery(
      `SELECT socket_id FROM users
        WHERE name = (
          SELECT name FROM party_members
           WHERE party_id = ?
           ORDER BY joined_at ASC, name ASC
           LIMIT 1
        ) LIMIT 1`,
      [partyId],
    );
    const socketId = rows?.[0]?.socket_id;
    if (socketId) io.to(socketId).emit("party:join-request", requestRow);
  }

  async function submitJoinRequest({
    partyId,
    requesterUserId,
    requesterName,
  }) {
    if (!partyId || !requesterUserId || !requesterName) {
      return failure(400, { error: "Party ID and user are required." });
    }

    let conn;
    try {
      conn = await db.pool.getConnection();
      await conn.beginTransaction();

      const [partyRows] = await conn.query(
        "SELECT * FROM parties WHERE party_id = ? FOR UPDATE",
        [partyId],
      );
      if (!partyRows.length) {
        await conn.rollback();
        return failure(404, { error: "Party not found", redirect: "/partynotfound" });
      }

      const party = partyRows[0];
      if (Number(party.is_public || 0) === 1) {
        await conn.rollback();
        return failure(400, { error: "This party is public. Join it directly." });
      }

      const [memberRows] = await conn.query(
        "SELECT 1 FROM party_members WHERE party_id = ? AND name = ? LIMIT 1",
        [partyId, requesterName],
      );
      if (memberRows.length) {
        await conn.rollback();
        return failure(409, { error: "You are already in this party." });
      }

      const requestRow = await getJoinRequestRowByUserId(
        conn,
        partyId,
        requesterUserId,
      );
      if (requestRow && isJoinRequestTimedOut(requestRow)) {
        await conn.query(
          `UPDATE party_join_requests
              SET status = 'expired',
                  responded_at = CURRENT_TIMESTAMP
            WHERE request_id = ?`,
          [requestRow.request_id],
        );
        requestRow.status = "expired";
        requestRow.responded_at = new Date();
      }
      if (
        requestRow &&
        String(requestRow.status || "").toLowerCase() === "accepted"
      ) {
        await conn.rollback();
        return {
          ok: true,
          payload: {
            partyId,
            requestState: buildJoinRequestState(requestRow),
          },
        };
      }
      if (
        requestRow &&
        String(requestRow.status || "").toLowerCase() === "pending"
      ) {
        await conn.rollback();
        return {
          ok: true,
          payload: {
            partyId,
            requestState: buildJoinRequestState(requestRow),
          },
        };
      }

      const requestCount = requestRow
        ? Math.max(1, Number(requestRow.request_count) || 0)
        : 1;

      const cooldownAnchorMs = requestRow
        ? Math.max(
            requestRow?.requested_at
              ? new Date(requestRow.requested_at).getTime()
              : 0,
            requestRow?.responded_at
              ? new Date(requestRow.responded_at).getTime()
              : 0,
          )
        : 0;
      const cooldownRemainingMs = Math.max(
        0,
        cooldownAnchorMs
          ? JOIN_REQUEST_COOLDOWN_MS - (Date.now() - cooldownAnchorMs)
          : 0,
      );

      let nextRequestCount = requestCount;
      if (requestRow) {
        if (requestCount >= MAX_JOIN_REQUESTS && cooldownRemainingMs > 0) {
          await conn.rollback();
          return {
            ok: false,
            statusCode: 429,
            payload: {
              error: "Please request later or ask the owner to invite you.",
              requestState: {
                ...buildJoinRequestState(requestRow),
                attemptsRemaining: 0,
                cooldownRemainingMs,
              },
            },
          };
        }

        if (requestCount >= MAX_JOIN_REQUESTS && cooldownRemainingMs <= 0) {
          nextRequestCount = 1;
        } else {
          nextRequestCount = requestCount + 1;
        }
      }

      if (nextRequestCount > MAX_JOIN_REQUESTS) {
        await conn.rollback();
        return {
          ok: false,
          statusCode: 429,
          payload: {
            error: "Please request later or ask the owner to invite you.",
            requestState: buildJoinRequestState(requestRow),
          },
        };
      }

      if (requestRow) {
        await conn.query(
          `UPDATE party_join_requests
              SET request_count = ?,
                  status = 'pending',
                  requested_at = CURRENT_TIMESTAMP,
                  responded_at = NULL
            WHERE request_id = ?`,
          [nextRequestCount, requestRow.request_id],
        );
      } else {
        await conn.query(
          `INSERT INTO party_join_requests
             (party_id, requester_user_id, request_count, status, requested_at, responded_at)
           VALUES (?, ?, 1, 'pending', CURRENT_TIMESTAMP, NULL)`,
          [partyId, requesterUserId],
        );
      }

      const [rows] = await conn.query(
        `${JOIN_REQUEST_SELECT} WHERE r.party_id = ? AND r.requester_user_id = ? LIMIT 1`,
        [partyId, requesterUserId],
      );
      const savedRequest = rows?.[0] || null;
      await conn.commit();

      if (savedRequest) {
        await emitJoinRequestToOwner(partyId, {
          requestId: Number(savedRequest.request_id) || null,
          partyId,
          requesterUserId: Number(savedRequest.requester_user_id) || null,
          requesterName: String(savedRequest.requester_name || requesterName),
          userStatus: String(savedRequest.user_status || "online"),
          status: String(savedRequest.status || "pending"),
          requestedAt: savedRequest.requested_at || null,
          respondedAt: savedRequest.responded_at || null,
        });
      }

      return {
        ok: true,
        payload: {
          partyId,
          requestState: buildJoinRequestState(savedRequest),
        },
      };
    } catch (error) {
      if (conn) {
        try {
          await conn.rollback();
        } catch (_) {}
      }
      if (isMissingJoinRequestTable(error)) {
        return {
          ok: false,
          statusCode: 500,
          payload: {
            error:
              "Party join requests are unavailable. Apply the join request migration first.",
          },
        };
      }
      throw error;
    } finally {
      if (conn) conn.release();
    }
  }

  async function respondToJoinRequest({
    partyId,
    actorName,
    requestId,
    response,
  }) {
    if (!partyId || !actorName || !requestId || !response) {
      return failure(400, { error: "Party ID, request, and response are required." });
    }

    const ownerName = await getPartyOwnerName(partyId);
    if (ownerName !== actorName) {
      return failure(403, { error: "Only the party owner can review join requests." });
    }

    let conn;
    try {
      conn = await db.pool.getConnection();
      await conn.beginTransaction();

      const [requestRows] = await conn.query(
        `${JOIN_REQUEST_SELECT} WHERE r.party_id = ? AND r.request_id = ? LIMIT 1 FOR UPDATE`,
        [partyId, requestId],
      );
      const requestRow = requestRows?.[0] || null;
      if (!requestRow) {
        await conn.rollback();
        return failure(404, { error: "Join request not found." });
      }

      if (isJoinRequestTimedOut(requestRow)) {
        await conn.query(
          `UPDATE party_join_requests
              SET status = 'expired',
                  responded_at = CURRENT_TIMESTAMP
            WHERE request_id = ?`,
          [requestId],
        );
        await conn.rollback();
        return failure(409, { error: "Join request expired." });
      }

      const nextStatus =
        String(response).toLowerCase() === "accept"
          ? "accepted"
          : String(response).toLowerCase() === "reject"
            ? "rejected"
            : null;
      if (!nextStatus) {
        await conn.rollback();
        return failure(400, { error: "Unsupported join request response." });
      }

      await conn.query(
        `UPDATE party_join_requests
            SET status = ?,
                responded_at = CURRENT_TIMESTAMP
          WHERE request_id = ?`,
        [nextStatus, requestId],
      );

      await conn.commit();

      const requestState = buildJoinRequestState({
        ...requestRow,
        status: nextStatus,
        responded_at: new Date(),
      });

      await emitJoinRequestUpdateToRequester(requestRow, {
        partyId,
        requestId: Number(requestRow.request_id) || null,
        requesterUserId: Number(requestRow.requester_user_id) || null,
        requesterName: String(requestRow.requester_name || ""),
        status: nextStatus,
        requestState,
        joinAfterMs: nextStatus === "accepted" ? 3000 : 0,
        message: nextStatus === "accepted" ? "accepted" : "rejected",
      });

      return {
        ok: true,
        payload: {
          partyId,
          requestId: Number(requestRow.request_id) || null,
          requesterUserId: Number(requestRow.requester_user_id) || null,
          requesterName: String(requestRow.requester_name || ""),
          status: nextStatus,
          requestState,
        },
      };
    } catch (error) {
      if (conn) {
        try {
          await conn.rollback();
        } catch (_) {}
      }
      if (isMissingJoinRequestTable(error)) {
        return {
          ok: false,
          statusCode: 500,
          payload: {
            error:
              "Party join requests are unavailable. Apply the join request migration first.",
          },
        };
      }
      throw error;
    } finally {
      if (conn) conn.release();
    }
  }

  return {
    isMissingJoinRequestTable,
    buildJoinRequestState,
    isJoinRequestTimedOut,
    getJoinRequestRowByUserId,
    getPendingJoinRequests,
    submitJoinRequest,
    respondToJoinRequest,
  };
}

module.exports = { createPartyJoinRequestService };
