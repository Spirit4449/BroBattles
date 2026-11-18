export function createPlayerLookup({ getUsername, getLocalPlayer, getOpponentPlayers, getTeamPlayers }) {
  function wrapper(name) {
    return name ? getOpponentPlayers?.()?.[name] || getTeamPlayers?.()?.[name] || null : null;
  }

  function sprite(name) {
    if (!name) return null;
    return name === getUsername?.() ? getLocalPlayer?.() || null : wrapper(name)?.opponent || null;
  }

  function remotes() {
    return [
      ...Object.values(getOpponentPlayers?.() || {}),
      ...Object.values(getTeamPlayers?.() || {}),
    ];
  }

  function all() {
    return [getLocalPlayer?.(), ...remotes().map(entry => entry?.opponent)].filter(Boolean);
  }

  return { wrapper, sprite, remotes, all };
}
