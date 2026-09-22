export const GAME_CHAT_FOCUS_MS = 2000;
export const GAME_CHAT_UNFOCUSED_MS = 3000;

export function gameChatVisibilityPhase({ open, suppressed, lastActivityAt, now }) {
  if (!open || suppressed) return "hidden";
  const inactiveMs = Math.max(0, now - lastActivityAt);
  if (inactiveMs >= GAME_CHAT_FOCUS_MS + GAME_CHAT_UNFOCUSED_MS) {
    return "hidden";
  }
  if (inactiveMs >= GAME_CHAT_FOCUS_MS) return "unfocused";
  return "active";
}
