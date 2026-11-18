export function createVaultHud(isIntroBlocking) {
  let lastModeAlertAt = 0;
  let lastModeAlertEventAt = 0;
  const lastVaultCoins = {};
  const vaultDeltaTimers = {};
  let alertTimer;
  // One row per vault showing the single value the mode runs on: the coins in
  // it. The bar is that number against what the vault started with, and the
  // tick on the bar is the floor purchases cannot spend past.
  function _setVaultRow(teamKey, vault, yourTeam, modeState) {
    const row = document.getElementById(`bank-bust-${teamKey}`);
    if (!row || !vault) return;
    row.classList.toggle("friendly", yourTeam === teamKey);
    row.classList.toggle("enemy", !!yourTeam && yourTeam !== teamKey);
    const label = row.querySelector(".bank-bust-vault-label");
    if (label) {
      const text = !yourTeam ? "Vault" : yourTeam === teamKey ? "Team Vault" : "Enemy Vault";
      if (label.textContent !== text) label.textContent = text;
    }

    const coins = Math.max(0, Number(vault?.coins) || 0);
    const starting = Math.max(1, Number(vault?.startingCoins) || 1);
    const ratio = Math.max(0, Math.min(1, coins / starting));
    const lowRatio = Number(modeState?.lowCoinsRatio) || 0.25;

    const value = row.querySelector(".bank-bust-vault-coins");
    if (value) value.textContent = coins.toLocaleString("en-US");

    const fill = row.querySelector(".bank-bust-vault-fill");
    if (fill) fill.style.width = `${(ratio * 100).toFixed(1)}%`;

    row.classList.toggle("empty", coins <= 0);
    row.classList.toggle("low", coins > 0 && ratio <= lowRatio);

    _flashVaultDelta(teamKey, row, coins);
  }

  // The last coin change for this vault, flashed beside the label. Tracked
  // here rather than read from the ledger so a burst of pickups reads as one
  // movement instead of a stutter of numbers.
  function _flashVaultDelta(teamKey, row, coins) {
    const previous = lastVaultCoins[teamKey];
    lastVaultCoins[teamKey] = coins;
    if (previous === undefined || previous === coins) return;
    const delta = coins - previous;
    const label = row.querySelector(".bank-bust-vault-delta");
    if (!label) return;
    label.textContent = `${delta > 0 ? "+" : ""}${delta.toLocaleString("en-US")}`;
    label.classList.remove("gain", "loss");
    label.classList.add(delta > 0 ? "gain" : "loss", "show");
    clearTimeout(vaultDeltaTimers[teamKey]);
    vaultDeltaTimers[teamKey] = setTimeout(() => {
      label.classList.remove("show");
    }, 900);

  }

  function _showVaultAlert(event, yourTeam) {
    const root = document.getElementById("bank-bust-alert");
    if (!root || !event) return;
    // Only warn about your own Vault.
    if (!yourTeam || event?.targetTeam !== yourTeam) return;
    const eventAt = Number(event?.at) || 0;
    if (eventAt && eventAt <= lastModeAlertEventAt) return;
    const now = Date.now();
    if (now - lastModeAlertAt < 20000) return;
    lastModeAlertAt = now;
    lastModeAlertEventAt = eventAt || now;
    root.textContent = "You are being attacked";
    root.classList.remove("hidden", "enemy-alert");
    root.classList.add("friendly-alert");
    root.classList.add("show");
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => {
      root.classList.remove("show");
      root.classList.add("hidden");
    }, 1600);
  }

  // Short heads-up while the centre crate is on its way; nothing once it lands.
  function _syncCenterGold(centerGold) {
    const root = document.getElementById("bank-bust-event");
    if (!root) return;
    const label = root.querySelector(".bb-event-label");
    const timer = root.querySelector(".bb-event-timer");
    if (String(centerGold?.phase || "") !== "announced") {
      root.classList.remove("show", "live");
      root.classList.add("hidden");
      return;
    }
    if (label) label.textContent = "Crate incoming";
    if (timer) timer.textContent = "";
    root.classList.remove("hidden", "live");
    root.classList.add("show");
  }

  function sync(modeState, yourTeam = null) {
    const hud = document.getElementById("bank-bust-hud");
    if (!hud) return;
    if (!modeState || String(modeState?.type) !== "bank-bust") {
      hud.classList.add("hidden");
      _syncCenterGold(null);
      return;
    }
    const introBlocking = isIntroBlocking();
    if (!introBlocking) {
      hud.classList.remove("hidden");
    }
    _setVaultRow("team1", modeState?.vaults?.team1, yourTeam, modeState);
    _setVaultRow("team2", modeState?.vaults?.team2, yourTeam, modeState);
    _syncCenterGold(modeState?.centerGold);
    if (modeState?.lastVaultDamageEvent?.at) {
      _showVaultAlert(modeState.lastVaultDamageEvent, yourTeam);
    }
  }

  function destroy() {
    Object.values(vaultDeltaTimers).forEach(clearTimeout);
    clearTimeout(alertTimer);
    document.getElementById("bank-bust-alert")?.classList.add("hidden");
    sync(null);
  }
  return { sync, destroy };
}
