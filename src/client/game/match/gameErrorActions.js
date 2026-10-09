// Maps a server `game:error` to what the notice's button should do, so OK
// takes the player somewhere useful instead of leaving them on a dead match.

const ACTIONS = {
  UNAUTHORIZED: { action: "login", buttonText: "Log In" },
  BANNED: { action: "banned", buttonText: "OK" },
  CLIENT_UPDATE_REQUIRED: { action: "reload", buttonText: "Reload" },
  JOIN_FAILED: { action: "reload", buttonText: "Retry" },
  BAD_MATCH_ID: { action: "lobby", buttonText: "Lobby" },
  MM_SUSPENDED: { action: "lobby", buttonText: "Lobby" },
  ROOM_NOT_FOUND: { action: "lobby", buttonText: "Lobby" },
  NOT_PARTICIPANT: { action: "lobby", buttonText: "Lobby" },
  MATCH_FINISHED: { action: "lobby", buttonText: "Lobby" },
};

/**
 * @param {{ code?: string }} error
 * @param {{ editorPlaytest?: boolean }} [context]
 * @returns {{ action: "login"|"banned"|"reload"|"lobby"|"dismiss", buttonText: string }}
 */
export function resolveGameErrorAction(error, { editorPlaytest = false } = {}) {
  const resolved = ACTIONS[String(error?.code || "")] || {
    action: "reload",
    buttonText: "Retry",
  };
  // The playtest runs inside the map editor; leaving it would strand the editor.
  if (editorPlaytest && resolved.action !== "reload") {
    return { action: "dismiss", buttonText: "OK" };
  }
  return resolved;
}
