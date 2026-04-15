const {
  ABUSE_LOG_DECISIONS,
  ABUSE_DECAY_WINDOW_MS,
  CHAT_ACTION_LIMITS,
  CHAT_ESCALATION_STEPS,
  HTTP_ESCALATION_STEPS,
} = require("../helpers/abusePolicy");

const MISSING_SCHEMA_CODES = new Set(["ER_BAD_FIELD_ERROR", "ER_NO_SUCH_TABLE"]);

function parseMs(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function findStep(steps, level) {
  return steps.find((step) => Number(step.level) === Number(level)) || null;
}

function getBanLevel(steps) {
  const found = steps.find((step) => String(step?.type) === "ban");
  return Number(found?.level) || Number(steps[steps.length - 1]?.level) || 1;
}

function createAbuseControlService({ db, io }) {
  const requestWindows = new Map();
  let schemaChecked = false;
  let schemaAvailable = false;
  let missingSchemaLogged = false;
  let lastSchemaBypassWarnAt = 0;

  function maybeLogSchemaBypass(source) {
    const now = Date.now();
    if (now - lastSchemaBypassWarnAt < 30000) return;
    lastSchemaBypassWarnAt = now;
    console.warn(
      `[abuse] bypassing enforcement (schema unavailable). source=${String(source || "unknown")}`,
    );
  }

  function logDecision(category, payload = {}) {
    if (!ABUSE_LOG_DECISIONS) return;
    const { userId = 0, source = "", action = "", type = "", level = 0 } = payload;
    console.warn(
      `[abuse] ${category} denied user=${Number(userId) || 0} source=${String(source || "")} action=${String(action || "")} type=${String(type || "")} level=${Number(level) || 0}`,
    );
  }

  function markBucketAndGetCount(key, windowMs, now = Date.now()) {
    let bucket = requestWindows.get(key);
    if (!Array.isArray(bucket)) bucket = [];
    const floor = now - windowMs;
    while (bucket.length && bucket[0] <= floor) bucket.shift();
    bucket.push(now);
    requestWindows.set(key, bucket);
    return bucket.length;
  }

  async function ensureSchema() {
    if (schemaChecked) return schemaAvailable;
    schemaChecked = true;
    try {
      await db.runQuery(
        `SELECT user_id,
                chat_offense_level,
                chat_last_violation_at,
                chat_suspended_until,
                chat_decay_anchor_at,
                http_offense_level,
                http_last_violation_at,
                mm_suspended_until,
                http_decay_anchor_at,
                is_banned,
                banned_at,
                ban_reason,
                socket_id
           FROM users
          LIMIT 1`,
      );
      schemaAvailable = true;
    } catch (error) {
      schemaAvailable = false;
      if (!missingSchemaLogged && MISSING_SCHEMA_CODES.has(error?.code)) {
        missingSchemaLogged = true;
        console.warn(
          "[abuse] Abuse schema missing. Apply migration before enabling enforcement.",
        );
      } else {
        console.error("[abuse] schema check failed:", error);
      }
    }
    return schemaAvailable;
  }

  async function getState(userId) {
    if (!(await ensureSchema())) return null;
    const rows = await db.runQuery(
      `SELECT user_id,
              chat_offense_level,
              chat_last_violation_at,
              chat_suspended_until,
              chat_decay_anchor_at,
              http_offense_level,
              http_last_violation_at,
              mm_suspended_until,
              http_decay_anchor_at,
              is_banned,
              banned_at,
              ban_reason,
              socket_id
         FROM users
        WHERE user_id = ?
        LIMIT 1`,
      [userId],
    );
    return rows[0] || null;
  }

  function computeEffectiveLevel({
    level,
    lastViolationAt,
    suspendedUntil,
    decayAnchorAt,
    now,
  }) {
    const suspendedUntilMs = parseMs(suspendedUntil);
    if (suspendedUntilMs && now < suspendedUntilMs) {
      return { level, suspendedActive: true, suspendedUntilMs };
    }

    const ref = Math.max(
      parseMs(lastViolationAt),
      suspendedUntilMs,
      parseMs(decayAnchorAt),
    );
    if (ref > 0 && now - ref > ABUSE_DECAY_WINDOW_MS) {
      return { level: 0, suspendedActive: false, suspendedUntilMs: 0 };
    }
    return { level, suspendedActive: false, suspendedUntilMs: 0 };
  }

  async function logEvent({ userId, category, source, action, level, detail }) {
    if (!(await ensureSchema())) return;
    try {
      await db.runQuery(
        `INSERT INTO user_abuse_events
           (user_id, category, source, action_taken, offense_level, detail)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          userId,
          String(category || "unknown").slice(0, 40),
          String(source || "").slice(0, 120),
          String(action || "").slice(0, 64),
          Number(level) || 0,
          detail ? JSON.stringify(detail).slice(0, 2000) : null,
        ],
      );
    } catch (error) {
      if (!MISSING_SCHEMA_CODES.has(error?.code)) {
        console.warn("[abuse] event log failed:", error?.message || error);
      }
    }
  }

  async function forceBan({ userId, reason, state }) {
    const now = Date.now();
    const bannedAt = new Date(now);
    await db.runQuery(
      `UPDATE users
          SET is_banned = 1,
              banned_at = ?,
              ban_reason = ?
        WHERE user_id = ?`,
      [bannedAt, String(reason || "Abuse policy violation").slice(0, 255), userId],
    );

    const socketId = String(state?.socket_id || "").trim();
    if (socketId) {
      try {
        const sock = io?.sockets?.sockets?.get(socketId);
        if (sock) {
          sock.emit("auth:banned", {
            reason: String(reason || "Abuse policy violation"),
          });
          sock.disconnect(true);
        }
      } catch (_) {}
    }

    await logEvent({
      userId,
      category: "account",
      source: "abuse-control",
      action: "ban",
      level: 999,
      detail: { reason },
    });

    logDecision("account", {
      userId,
      source: "abuse-control",
      action: "ban",
      type: "ban",
      level: 999,
    });

    return {
      allowed: false,
      type: "ban",
      message: "Your account has been banned.",
      clearAuth: true,
      banned: true,
    };
  }

  async function applyChatViolation({ userId, source }) {
    const now = Date.now();
    const state = await getState(userId);
    if (!state) return { allowed: true, bypassed: true };
    if (Number(state.is_banned || 0) === 1) {
      return {
        allowed: false,
        type: "ban",
        message: "Your account has been banned.",
        clearAuth: true,
      };
    }

    const levelResult = computeEffectiveLevel({
      level: Math.max(0, Number(state.chat_offense_level) || 0),
      lastViolationAt: state.chat_last_violation_at,
      suspendedUntil: state.chat_suspended_until,
      decayAnchorAt: state.chat_decay_anchor_at,
      now,
    });

    if (levelResult.suspendedActive) {
      logDecision("chat", {
        userId,
        source,
        action: "blocked_during_suspension",
        type: "chat_suspended",
        level: Number(levelResult.level) || 0,
      });
      return {
        allowed: false,
        type: "chat_suspended",
        message: "You are suspended from chat.",
        suspendedUntilMs: levelResult.suspendedUntilMs,
      };
    }

    const nextLevel = Math.max(1, Number(levelResult.level) + 1);
    const banLevel = getBanLevel(CHAT_ESCALATION_STEPS);
    const step = findStep(CHAT_ESCALATION_STEPS, nextLevel) ||
      CHAT_ESCALATION_STEPS[CHAT_ESCALATION_STEPS.length - 1];

    if (step.type === "ban") {
      return forceBan({
        userId,
        reason: "Repeated chat/reaction abuse",
        state,
      });
    }

    let chatSuspendedUntil = null;
    let chatDecayAnchorAt = state.chat_decay_anchor_at || null;
    if (step.type === "chat_suspend") {
      const untilMs = now + Math.max(1000, Number(step.durationMs) || 1000);
      chatSuspendedUntil = new Date(untilMs);
      chatDecayAnchorAt = chatSuspendedUntil;
    }

    await db.runQuery(
      `UPDATE users
          SET chat_offense_level = ?,
              chat_last_violation_at = ?,
              chat_suspended_until = ?,
              chat_decay_anchor_at = ?
        WHERE user_id = ?`,
      [
        nextLevel,
        new Date(now),
        chatSuspendedUntil,
        chatDecayAnchorAt,
        userId,
      ],
    );

    await logEvent({
      userId,
      category: "chat",
      source,
      action: step.type,
      level: nextLevel,
      detail: { durationMs: step.durationMs || 0 },
    });

    logDecision("chat", {
      userId,
      source,
      action: step.type,
      type: step.type,
      level: nextLevel,
    });

    if (step.type === "warn") {
      const violationsUntilBan = Math.max(0, banLevel - nextLevel);
      return {
        allowed: false,
        type: "warn",
        message: step.message,
        level: nextLevel,
        violationsUntilBan,
        banWarning:
          violationsUntilBan <= 2
            ? `Warning: ${violationsUntilBan} more violation${violationsUntilBan === 1 ? "" : "s"} can trigger a ban.`
            : null,
      };
    }
    const violationsUntilBan = Math.max(0, banLevel - nextLevel);
    return {
      allowed: false,
      type: "chat_suspended",
      message: "You are suspended from chat.",
      level: nextLevel,
      suspendedUntilMs: chatSuspendedUntil ? chatSuspendedUntil.getTime() : 0,
      violationsUntilBan,
      banWarning:
        violationsUntilBan <= 1
          ? "Any further abuse after this suspension can permanently ban this account."
          : null,
    };
  }

  async function applyHttpViolation({ userId, source }) {
    const now = Date.now();
    const state = await getState(userId);
    if (!state) return { allowed: true, bypassed: true };
    if (Number(state.is_banned || 0) === 1) {
      return {
        allowed: false,
        type: "ban",
        message: "Your account has been banned.",
        clearAuth: true,
      };
    }

    const levelResult = computeEffectiveLevel({
      level: Math.max(0, Number(state.http_offense_level) || 0),
      lastViolationAt: state.http_last_violation_at,
      suspendedUntil: state.mm_suspended_until,
      decayAnchorAt: state.http_decay_anchor_at,
      now,
    });

    if (levelResult.suspendedActive) {
      logDecision("http", {
        userId,
        source,
        action: "blocked_during_suspension",
        type: "mm_suspended",
        level: Number(levelResult.level) || 0,
      });
      return {
        allowed: false,
        type: "mm_suspended",
        message: "Too many requests. Matchmaking is temporarily suspended.",
        suspendedUntilMs: levelResult.suspendedUntilMs,
      };
    }

    const nextLevel = Math.max(1, Number(levelResult.level) + 1);
    const step = findStep(HTTP_ESCALATION_STEPS, nextLevel) ||
      HTTP_ESCALATION_STEPS[HTTP_ESCALATION_STEPS.length - 1];

    if (step.type === "ban") {
      return forceBan({
        userId,
        reason: "Repeated HTTP flood abuse",
        state,
      });
    }

    const untilMs = now + Math.max(1000, Number(step.durationMs) || 1000);
    const mmSuspendedUntil = new Date(untilMs);

    await db.runQuery(
      `UPDATE users
          SET http_offense_level = ?,
              http_last_violation_at = ?,
              mm_suspended_until = ?,
              http_decay_anchor_at = ?
        WHERE user_id = ?`,
      [nextLevel, new Date(now), mmSuspendedUntil, mmSuspendedUntil, userId],
    );

    await logEvent({
      userId,
      category: "http",
      source,
      action: "mm_suspend",
      level: nextLevel,
      detail: { durationMs: Number(step.durationMs) || 0 },
    });

    logDecision("http", {
      userId,
      source,
      action: "mm_suspend",
      type: "mm_suspended",
      level: nextLevel,
    });

    return {
      allowed: false,
      type: "mm_suspended",
      message: "Too many requests. Matchmaking is temporarily suspended.",
      level: nextLevel,
      suspendedUntilMs: untilMs,
    };
  }

  async function guardChatAction({ userId, actionType, source }) {
    if (!userId) return { allowed: true };
    if (!(await ensureSchema())) {
      maybeLogSchemaBypass(source || `chat:${actionType}`);
      return { allowed: true, bypassed: true };
    }

    const state = await getState(userId);
    if (!state) return { allowed: true };
    if (Number(state.is_banned || 0) === 1) {
      return {
        allowed: false,
        type: "ban",
        message: "Your account has been banned.",
        clearAuth: true,
      };
    }

    const now = Date.now();
    const suspensionMs = parseMs(state.chat_suspended_until);
    if (suspensionMs && now < suspensionMs) {
      const currentLevel = Math.max(0, Number(state.chat_offense_level) || 0);
      const banLevel = getBanLevel(CHAT_ESCALATION_STEPS);
      const violationsUntilBan = Math.max(0, banLevel - currentLevel);
      return {
        allowed: false,
        type: "chat_suspended",
        message: "You are suspended from chat.",
        suspendedUntilMs: suspensionMs,
        level: currentLevel,
        violationsUntilBan,
        banWarning:
          violationsUntilBan <= 1
            ? "Any further abuse after this suspension can permanently ban this account."
            : null,
      };
    }

    const cfg = CHAT_ACTION_LIMITS[actionType] || CHAT_ACTION_LIMITS.message;
    const count = markBucketAndGetCount(
      `chat:${actionType}:${userId}`,
      Number(cfg.windowMs) || 5000,
      now,
    );
    const shortLimit = Math.max(1, Number(cfg.limit) || 1);
    if (count > shortLimit) {
      return applyChatViolation({ userId, source });
    }

    if (String(actionType) === "message") {
      const minuteCount = markBucketAndGetCount(
        `chat:${actionType}:minute:${userId}`,
        Number(cfg.minuteWindowMs) || 60000,
        now,
      );
      const minuteLimit = Math.max(1, Number(cfg.minuteLimit) || 20);
      if (minuteCount > minuteLimit) {
        return applyChatViolation({ userId, source });
      }
      return { allowed: true, count, minuteCount };
    }

    return { allowed: true, count };
  }

  async function guardHttpAction({
    userId,
    identityKey,
    source,
    limit,
    windowMs,
    anonLimit,
    enforceActiveSuspension = true,
  }) {
    const now = Date.now();

    if (userId) {
      if (!(await ensureSchema())) {
        maybeLogSchemaBypass(source || "http");
        return {
          allowed: false,
          type: "rate_limited",
          message: "Too many requests.",
        };
      }

      const state = await getState(userId);
      if (state) {
        if (Number(state.is_banned || 0) === 1) {
          return {
            allowed: false,
            type: "ban",
            message: "Your account has been banned.",
            clearAuth: true,
          };
        }

        const mmSuspendedUntilMs = parseMs(state.mm_suspended_until);
        if (enforceActiveSuspension && mmSuspendedUntilMs && mmSuspendedUntilMs > now) {
          logDecision("http", {
            userId,
            source,
            action: "blocked_during_suspension",
            type: "mm_suspended",
            level: Number(state.http_offense_level) || 0,
          });
          return {
            allowed: false,
            type: "mm_suspended",
            message: "Too many requests. Matchmaking is temporarily suspended.",
            suspendedUntilMs: mmSuspendedUntilMs,
          };
        }
      }
    }

    const appliedLimit = userId ? Number(limit) : Number(anonLimit || limit || 1);
    const count = markBucketAndGetCount(
      `http:${identityKey}`,
      Number(windowMs) || 10000,
      now,
    );
    if (count <= Math.max(1, appliedLimit || 1)) {
      return { allowed: true, count };
    }

    if (!userId) {
      return {
        allowed: false,
        type: "anon_rate_limited",
        message: "Too many requests.",
      };
    }
    return applyHttpViolation({ userId, source });
  }

  async function getActivePenaltyState(userId) {
    if (!userId) return null;
    const state = await getState(userId);
    if (!state) return null;
    return {
      isBanned: Number(state.is_banned || 0) === 1,
      mmSuspendedUntilMs: parseMs(state.mm_suspended_until),
      chatSuspendedUntilMs: parseMs(state.chat_suspended_until),
      banReason: String(state.ban_reason || "").trim() || null,
    };
  }

  return {
    ensureSchema,
    guardChatAction,
    guardHttpAction,
    getActivePenaltyState,
  };
}

module.exports = {
  createAbuseControlService,
};
