export function lobbyBackgroundStorageKey(pathname) {
  const party = pathname.match(/^\/party\/([^/?#]+)/);
  return `bb_lobby_background_url:${party ? `party:${party[1]}` : "solo"}`;
}
