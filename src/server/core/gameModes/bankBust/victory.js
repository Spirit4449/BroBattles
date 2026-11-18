const { VAULT_BUST_FINISH_DELAY_MS } = require("./modeRules");

function evaluateVictoryState(mode) {
  const state = mode.getModeState();
  const team1Vault = state?.vaults?.team1;
  const team2Vault = state?.vaults?.team2;
  if (!team1Vault || !team2Vault) return null;

  const team1Empty = Math.max(0, Number(team1Vault.coins) || 0) <= 0;
  const team2Empty = Math.max(0, Number(team2Vault.coins) || 0) <= 0;

  if (team1Empty && team2Empty) {
    return {
      terminal: true,
      winnerTeam: null,
      outcomeKey: "draw",
      meta: {
        outcome: "draw",
        destroyedObjectives: ["team1", "team2"],
        finishDelayMs: VAULT_BUST_FINISH_DELAY_MS,
      },
    };
  }
  if (team1Empty) {
    return {
      terminal: true,
      winnerTeam: "team2",
      outcomeKey: "team2",
      meta: {
        outcome: "team2",
        destroyedObjective: "team1",
        finishDelayMs: VAULT_BUST_FINISH_DELAY_MS,
      },
    };
  }
  if (team2Empty) {
    return {
      terminal: true,
      winnerTeam: "team1",
      outcomeKey: "team1",
      meta: {
        outcome: "team1",
        destroyedObjective: "team2",
        finishDelayMs: VAULT_BUST_FINISH_DELAY_MS,
      },
    };
  }
  return null;
}

function onTimerExpired(mode) {
  const immediate = mode.evaluateVictoryState();
  if (immediate?.terminal) return immediate;

  const state = mode.getModeState();
  const team1Vault = state?.vaults?.team1;
  const team2Vault = state?.vaults?.team2;
  if (!team1Vault || !team2Vault) {
    return {
      terminal: true,
      winnerTeam: null,
      outcomeKey: "draw",
      meta: { timerExpired: true, tiebreakReason: "missing-vault-state" },
    };
  }

  mode.stateVersion++;
  state.phase = "finished";

  // On the clock, the team with more coins still in its vault wins.
  const team1Coins = Math.max(0, Number(team1Vault.coins) || 0);
  const team2Coins = Math.max(0, Number(team2Vault.coins) || 0);

  if (team1Coins === team2Coins) {
    return {
      terminal: true,
      winnerTeam: null,
      outcomeKey: "draw",
      meta: {
        timerExpired: true,
        tiebreakReason: "equal-vault-coins",
        team1VaultCoins: team1Coins,
        team2VaultCoins: team2Coins,
        finishDelayMs: 0,
      },
    };
  }

  const winnerTeam = team1Coins > team2Coins ? "team1" : "team2";
  return {
    terminal: true,
    winnerTeam,
    outcomeKey: winnerTeam,
    meta: {
      timerExpired: true,
      tiebreakReason: "vault-coins",
      team1VaultCoins: team1Coins,
      team2VaultCoins: team2Coins,
      finishDelayMs: 0,
    },
  };
}

module.exports = { evaluateVictoryState, onTimerExpired };
