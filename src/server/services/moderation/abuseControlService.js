const {
  bannedResult,
  recordAbuseEvent,
  writeRestriction,
  disconnectRestrictedAccount,
} = require("./accountRestrictionService");
const { isAccountBanned } = require("../../../shared/moderation/accountBan");
const {
  ABUSE_LOG_DECISIONS,
  ABUSE_DECAY_WINDOW_MS,
  CHAT_ACTION_LIMITS,
  CHAT_ESCALATION_STEPS,
  HTTP_ESCALATION_STEPS,
} = require("./abusePolicy");


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

const KINDS = {
  chat: {
    steps: CHAT_ESCALATION_STEPS,
    suspendedColumn: "chat_suspended_until",
    type: "chat_suspended",
    message: "You are suspended from chat.",
    banReason: "Repeated chat/reaction abuse",
  },
  http: {
    steps: HTTP_ESCALATION_STEPS,
    suspendedColumn: "mm_suspended_until",
    type: "mm_suspended",
    message: "Too many requests. Matchmaking is temporarily suspended.",
    banReason: "Repeated HTTP flood abuse",
  },
};

function chatWarning(steps, level, warned) {
  const violationsUntilBan = Math.max(0, getBanLevel(steps) - level);
  let banWarning = null;
  if (warned && violationsUntilBan <= 2) {
    banWarning = `Warning: ${violationsUntilBan} more violation${violationsUntilBan === 1 ? "" : "s"} can trigger a ban.`;
  } else if (!warned && violationsUntilBan <= 1) {
    banWarning = "Any further abuse after this suspension can permanently ban this account.";
  }
  return { violationsUntilBan, banWarning };
}

function createAbuseControlService({ db, io }) {
  const requestWindows = require("../../lib/requestWindow").createRequestWindow();
  function logDecision(category, payload = {}) {
    if (!ABUSE_LOG_DECISIONS) return;
    const { userId = 0, source = "", action = "", type = "", level = 0 } = payload;
    console.warn(
      `[abuse] ${category} denied user=${Number(userId) || 0} source=${String(source || "")} action=${String(action || "")} type=${String(type || "")} level=${Number(level) || 0}`,
    );
  }

  function markBucketAndGetCount(key, windowMs, now = Date.now(), mark = true) {
    return requestWindows.count(key, windowMs, now, mark);
  }

  async function getState(userId, lockedQuery) {
    const q = lockedQuery || db.runQuery.bind(db);
    const rows = await q(
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
              ban_expires_at,
              banned_at,
              ban_reason,
              socket_id
         FROM users
        WHERE user_id = ?
        LIMIT 1${lockedQuery ? " FOR UPDATE" : ""}`,
      [userId],
    );
    return rows[0] || null;
  }

  function computeEffectiveLevel({ level, lastViolationAt, suspendedUntil, decayAnchorAt, now }) {
    const suspendedUntilMs = parseMs(suspendedUntil);
    if (suspendedUntilMs && now < suspendedUntilMs) {
      return { level, suspendedActive: true, suspendedUntilMs };
    }

    const ref = Math.max(parseMs(lastViolationAt), suspendedUntilMs, parseMs(decayAnchorAt));
    if (ref > 0 && now - ref > ABUSE_DECAY_WINDOW_MS) {
      return { level: 0, suspendedActive: false, suspendedUntilMs: 0 };
    }
    return { level, suspendedActive: false, suspendedUntilMs: 0 };
  }

  async function applyViolation(kind, { userId, source }) {
    const config = KINDS[kind];
    const result = await db.withTransaction(async (_conn, q) => {
      const state = await getState(userId, q);
      if (!state) return { allowed: true, bypassed: true };
      if (isAccountBanned(state)) return bannedResult();

      const now = Date.now();
      const effective = computeEffectiveLevel({
        level: Math.max(0, Number(state[`${kind}_offense_level`]) || 0),
        lastViolationAt: state[`${kind}_last_violation_at`],
        suspendedUntil: state[config.suspendedColumn],
        decayAnchorAt: state[`${kind}_decay_anchor_at`],
        now,
      });
      if (effective.suspendedActive) {
        return {
          allowed: false,
          type: config.type,
          message: config.message,
          suspendedUntilMs: effective.suspendedUntilMs,
        };
      }

      const level = effective.level + 1;
      const step = findStep(config.steps, level) || config.steps.at(-1);
      if (step.type === "ban") {
        await writeRestriction(q, { userId, action: "ban", reason: config.banReason });
        return { ...bannedResult(), banned: true };
      }

      const warned = step.type === "warn";
      const until = warned ? null : new Date(now + Math.max(1000, Number(step.durationMs) || 1000));
      await q(
        `UPDATE users SET ${kind}_offense_level = ?, ${kind}_last_violation_at = ?,
              ${config.suspendedColumn} = ?, ${kind}_decay_anchor_at = ? WHERE user_id = ?`,
        [level, new Date(now), until, until || state[`${kind}_decay_anchor_at`] || null, userId],
      );
      await recordAbuseEvent(q, {
        userId,
        category: kind,
        source: String(source || ""),
        action: step.type,
        level,
        detail: { durationMs: step.durationMs || 0 },
      });
      return {
        allowed: false,
        level,
        type: warned ? "warn" : config.type,
        message: warned ? step.message : config.message,
        ...(until ? { suspendedUntilMs: until.getTime() } : {}),
        ...(kind === "chat" ? chatWarning(config.steps, level, warned) : {}),
      };
    });
    if (result.banned) disconnectRestrictedAccount(io, userId, config.banReason);
    if (!result.allowed)
      logDecision(kind, {
        userId,
        source,
        action: result.type,
        type: result.type,
        level: result.level,
      });
    return result;
  }

  async function guardChatAction({ userId, actionType, source }) {
    if (!userId) return { allowed: true };

    const state = await getState(userId);
    if (!state) return { allowed: true };
    if (isAccountBanned(state)) {
      return bannedResult();
    }

    const now = Date.now();
    const suspensionMs = parseMs(state.chat_suspended_until);
    if (suspensionMs && now < suspensionMs) {
      const currentLevel = Math.max(0, Number(state.chat_offense_level) || 0);
      return {
        allowed: false,
        type: "chat_suspended",
        message: "You are suspended from chat.",
        suspendedUntilMs: suspensionMs,
        level: currentLevel,
        ...chatWarning(CHAT_ESCALATION_STEPS, currentLevel, false),
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
      return applyViolation("chat", { userId, source });
    }

    if (String(actionType) === "message") {
      const minuteCount = markBucketAndGetCount(
        `chat:${actionType}:minute:${userId}`,
        Number(cfg.minuteWindowMs) || 60000,
        now,
      );
      const minuteLimit = Math.max(1, Number(cfg.minuteLimit) || 20);
      if (minuteCount > minuteLimit) {
        return applyViolation("chat", { userId, source });
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
    scope = "",
    enforceActiveSuspension = true,
    countFailuresOnly = false,
  }) {
    const now = Date.now();

    if (userId) {

      const state = await getState(userId);
      if (state) {
        if (isAccountBanned(state)) {
          return bannedResult();
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
      countFailuresOnly
        ? `http:failures:${source}:${identityKey}`
        : scope
          ? `http:${scope}:${identityKey}`
          : `http:${identityKey}`,
      Number(windowMs) || 10000,
      now,
      !countFailuresOnly,
    );
    const threshold = Math.max(1, appliedLimit || 1);
    if (countFailuresOnly ? count < threshold : count <= threshold) {
      return { allowed: true, count };
    }

    if (!userId) {
      return {
        allowed: false,
        type: "anon_rate_limited",
        message: "Too many requests.",
      };
    }
    return applyViolation("http", { userId, source });
  }

  function recordHttpFailure({ identityKey, source, windowMs }) {
    markBucketAndGetCount(`http:failures:${source}:${identityKey}`, Number(windowMs) || 10000);
  }

  async function getActivePenaltyState(userId) {
    if (!userId) return null;
    const state = await getState(userId);
    if (!state) return null;
    return {
      isBanned: isAccountBanned(state),
      mmSuspendedUntilMs: parseMs(state.mm_suspended_until),
      chatSuspendedUntilMs: parseMs(state.chat_suspended_until),
      banReason: String(state.ban_reason || "").trim() || null,
    };
  }

  return {
    guardChatAction,
    recordHttpFailure,
    guardHttpAction,
    getActivePenaltyState,
  };
}

module.exports = {
  createAbuseControlService,
};
