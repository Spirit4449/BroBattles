// gameScene/healthBarUpdater.js

export function updateHealthBars({ opponentPlayers, teamPlayers }) {
  for (const name in opponentPlayers) {
    const opponentPlayer = opponentPlayers[name];
    if (opponentPlayer?.updateHealthBar) {
      opponentPlayer.updateHealthBar();
    }
  }

  for (const name in teamPlayers) {
    const teamPlayer = teamPlayers[name];
    if (teamPlayer?.updateHealthBar) {
      teamPlayer.updateHealthBar();
    }
  }
}
