// gameScene/healthBarUpdater.js

export function updateHealthBars({ opponentPlayers, teamPlayers, syncPositions = false }) {
  const players = new Set([
    ...Object.values(opponentPlayers || {}),
    ...Object.values(teamPlayers || {}),
  ]);
  for (const wrapper of players) {
    if (syncPositions && wrapper?.updateUIPosition) {
      // Countdown physics runs without network interpolation. Refresh cached
      // HUD anchors and the name before drawing health/super bars.
      wrapper.updateUIPosition();
    } else {
      wrapper?.updateHealthBar?.();
    }
  }
}
