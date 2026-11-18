const { DEFAULT_SETTINGS } = require("./modeRules");

function getVaultState(mode, targetTeam) {
  const state = mode.getModeState();
  return state?.vaults?.[targetTeam] || null;
}

function getVaultCoins(mode, team) {
  return Math.max(0, Number(mode.getVaultState(team)?.coins) || 0);
}

function applyVaultCoins(mode, team, delta, meta = {}) {
  const state = mode.getModeState();
  const vault = mode.getVaultState(team);
  const change = Math.round(Number(delta) || 0);
  if (!state || !vault || !change) return null;
  if (team !== "team1" && team !== "team2") return null;
  // Once a vault is gone the result is settled, including while the bust
  // plays out: nothing can bank coins or empty the winner's vault as well.
  if (vault.destroyedAt || state.phase === "finished") return null;

  const before = Math.max(0, Number(vault.coins) || 0);
  const after = Math.max(0, before + change);
  const applied = after - before;
  if (!applied) return null;

  const now = Number(meta?.at) || Date.now();
  mode.stateVersion++;
  vault.coins = after;
  if (after === 0 && !vault.destroyedAt) {
    vault.destroyedAt = now;
    state.phase = "finished";
  }

  state.coinEvents = Array.isArray(state.coinEvents) ? state.coinEvents : [];
  state.coinEvents.push({
    // Why the number moved, so the client can pick the right feedback.
    reason: String(meta?.reason || (applied > 0 ? "gain" : "loss")),
    team,
    delta: applied,
    coins: after,
    source: meta?.source || null,
    actor: meta?.actor || null,
    actorTeam: meta?.actorTeam || null,
    x: Number.isFinite(Number(meta?.x)) ? Number(meta.x) : null,
    y: Number.isFinite(Number(meta?.y)) ? Number(meta.y) : null,
    at: now,
  });
  return { before, after, applied, vault };
}

function canAffordPurchase(mode, team, cost) {
  const state = mode.getModeState(), vault = mode.getVaultState(team);
  const amount = Number(cost);
  if (!vault || vault.destroyedAt || state?.phase === "finished" || !Number.isFinite(amount) || amount < 0) return false;
  const price = Math.round(amount);
  const configuredFloor = Number(state?.purchaseFloorCoins);
  const floor = Number.isFinite(configuredFloor) ? Math.max(0, configuredFloor) : DEFAULT_SETTINGS.purchaseFloorCoins;
  const remaining = mode.getVaultCoins(team) - price;
  // Even a map configured with a zero purchase floor cannot buy a loss.
  return remaining > 0 && remaining >= floor;
}

function spendVaultCoins(mode, team, cost, meta = {}) {
  const price = Math.max(0, Math.round(Number(cost) || 0));
  if (team !== "team1" && team !== "team2") return false;
  if (!mode.canAffordPurchase(team, price)) return false;
  if (price === 0) return true;
  return !!mode.applyVaultCoins(team, -price, {
    ...meta,
    reason: meta?.reason || "purchase",
  });
}

function damageVault(mode, targetTeam, rawDamage, meta = {}) {
  const state = mode.getModeState();
  const vaultState = mode.getVaultState(targetTeam);
  if (!state || !vaultState) return null;

  const damage = Math.max(0, Math.round(Number(rawDamage) || 0));
  if (damage <= 0 || vaultState.coins <= 0) return vaultState;

  // One point of damage is one coin: the vault is on the same scale as a
  // player's health bar, so a 1200 hit takes 1200 either way.
  const now = Date.now();
  const result = mode.applyVaultCoins(targetTeam, -damage, {
    reason: "enemyAttack",
    source: meta?.attackType || null,
    actor: meta?.sourcePlayer || null,
    actorTeam: meta?.sourceTeam || null,
    x: vaultState.x,
    y: vaultState.y,
    at: now,
  });
  if (!result) return vaultState;

  state.lastVaultDamageEvent = {
    type: "vault-under-attack",
    targetTeam,
    sourceTeam: meta?.sourceTeam || null,
    sourcePlayer: meta?.sourcePlayer || null,
    coinsLost: -result.applied,
    coins: vaultState.coins,
    startingCoins: vaultState.startingCoins,
    at: now,
  };

  state.recentAlerts = Array.isArray(state.recentAlerts)
    ? state.recentAlerts
    : [];
  state.recentAlerts.push({
    type: "vault-under-attack",
    targetTeam,
    at: now,
    sourcePlayer: meta?.sourcePlayer || null,
  });

  return vaultState;
}

module.exports = { getVaultState, getVaultCoins, applyVaultCoins, canAffordPurchase, spendVaultCoins, damageVault };
