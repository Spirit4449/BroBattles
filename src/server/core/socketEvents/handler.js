function defineSocketHandler(handler, {
  ackIndex = 1,
  auth,
  onUnauthorized = ack => ack?.({ ok: false, error: "unauthorized" }),
  guard,
  onBlocked = (failure, ack) => ack?.(failure),
  onError,
} = {}) {
  return function socketHandler(...args) {
    const ackOnly = ackIndex === 1 && args.length === 1 && typeof args[0] === "function";
    const candidate = args[ackOnly ? 0 : ackIndex];
    const ack = typeof candidate === "function" ? candidate : undefined;
    const payload = ackOnly || ackIndex === 0 ? undefined : args[0];
    const handleError = error => {
      if (onError) return onError(error, ack);
      console.error("[socket] handler failed", error);
      ack?.({ ok: false, error: "Unable to complete request", code: "INTERNAL_ERROR" });
    };
    try {
      const user = auth?.();
      if (auth && !user) return onUnauthorized(ack);
      const invoke = () => ackIndex === 0
        ? handler.call(this, ack)
        : handler.call(this, payload, ack, user);
      const result = guard
        ? Promise.resolve(guard(payload, user)).then(failure =>
            failure ? onBlocked(failure, ack) : invoke())
        : invoke();
      return result?.then ? result.catch(handleError) : result;
    } catch (error) {
      return handleError(error);
    }
  };
}

function respondWithError(fallback) {
  return (error, ack) => ack?.({ ok: false, error: error?.message || fallback });
}

async function checkPenalties(abuseControl, userId, now = Date.now) {
  if (!abuseControl || !(Number(userId) > 0)) return null;
  const penalties = await abuseControl.getActivePenaltyState(Number(userId));
  if (penalties?.isBanned) return {
    type: "banned",
    message: penalties.banReason || "Your account has been banned.",
  };
  const suspendedUntilMs = Number(penalties?.mmSuspendedUntilMs);
  if (suspendedUntilMs > now()) return { type: "mm_suspended", suspendedUntilMs };
  return null;
}

async function checkChat(abuseControl, { userId, actionType, source, includeWarning = false }) {
  if (!abuseControl) return null;
  const guard = await abuseControl.guardChatAction({ userId, actionType, source });
  if (guard?.allowed) return null;
  const failure = {
    ok: false,
    error: guard?.message || "You are sending messages too fast.",
    type: guard?.type || "chat_limited",
    suspendedUntilMs: Number(guard?.suspendedUntilMs || 0) || null,
  };
  if (includeWarning) {
    failure.level = Number(guard?.level || 0) || null;
    failure.violationsUntilBan = Number(guard?.violationsUntilBan || 0) || null;
    failure.banWarning = guard?.banWarning || null;
  }
  return failure;
}

module.exports = { defineSocketHandler, checkPenalties, checkChat, respondWithError };
