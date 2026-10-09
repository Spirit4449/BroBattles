export function lastSeenDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function friendPresenceLabel(friend, now = Date.now()) {
  if (friend?.status === "In Battle") return "In Battle";
  if (friend?.status === "End Screen") return "Finishing match";
  if (friend?.status === "online") return "Online";
  if (friend?.lastSeenHidden) return "Offline";
  const date = lastSeenDate(friend?.lastSeenAt);
  if (!date) return "Last seen unknown";
  const elapsed = Math.max(0, now - date.getTime());
  if (elapsed < 60_000) return "Last seen just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `Last seen ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Last seen ${days}d ago`;
}

export function friendPresenceTitle(friend) {
  const date = lastSeenDate(friend?.lastSeenAt);
  return friend?.status === "offline" && date ? `Last seen ${date.toLocaleString()}` : "";
}

// Any live status (lobby, battle, end screen) counts as online.
export function isFriendOnline(friend) {
  return !!friend?.status && friend.status !== "offline";
}

export function formatOnlineCount(count) {
  return count > 9 ? "9+" : String(count);
}

export function friendsOnlineMessage(names = []) {
  const list = names.map((name) => String(name || "").trim()).filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return `${list[0]} is online!`;
  if (list.length === 2) return `${list[0]} and ${list[1]} are online!`;
  if (list.length === 3) return `${list[0]}, ${list[1]} and ${list[2]} are online!`;
  const others = list.length - 2;
  return `${list[0]}, ${list[1]} and ${others} others are online!`;
}
