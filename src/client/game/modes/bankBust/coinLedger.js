import { pageToWorld } from "../../scene/screenSpace";

export function createCoinLedger({
  scene,
  getLayout,
  Phaser,
  state,
  safePlaySfx,
  vaultCoinLabels,
  reducedMotion,
  coinFx,
  formatCoins,
  getLayoutVault,
  vaultFx,
  getPlayerPositionByName,
  getObjectPositionById,
  cloneJson,
  playTurretMuzzle,
}) {
  function resolveScenePointFromHud(selector) {
    try {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return pageToWorld(scene, rect.left + rect.width / 2, rect.top + rect.height / 2);
    } catch (_) {
      return null;
    }
  }

  // Where a team's coins live on screen: the vault itself in the world, and
  // its row in the HUD. Collected coins travel to whichever is on camera, so
  // the connection between picking a coin up and the vault filling is visible.
  function vaultScreenTarget(team) {
    const vault = getLayout()?.vaults?.[team];
    if (vault && Number.isFinite(Number(vault.x))) {
      const cam = scene?.cameras?.main;
      const x = Number(vault.x);
      const y = Number(vault.y);
      if (cam && Phaser.Geom.Rectangle.Contains(cam.worldView, x, y)) {
        return { x, y };
      }
    }
    return resolveScenePointFromHud(
      `#bank-bust-${String(team || "").toLowerCase()} .bank-bust-vault-coins`,
    );
  }

  function cachedVaultTarget(team) {
    const cached = state.vaultTargetCache.get(team);
    if (cached?.at === scene.time.now) return cached.point;
    const point = vaultScreenTarget(team);
    state.vaultTargetCache.set(team, { at: scene.time.now, point });
    return point;
  }

  function playPayoutTick() {
    const now = scene.time.now;
    state.payoutStreak = now - state.payoutStreakAt > 500 ? 0 : state.payoutStreak + 1;
    state.payoutStreakAt = now;
    safePlaySfx("sfx-coin-pickup", {
      volume: 0.07,
      rate: Math.min(1.7, 0.95 + state.payoutStreak * 0.07),
    });
  }

  // The vault's number gets a knock each time coins land on it.
  function punchVaultLabel(team) {
    const label = vaultCoinLabels.get(team);
    if (!label?.scene || reducedMotion) return;
    scene.tweens.killTweensOf(label);
    label.setScale(1.3);
    scene.tweens.add({ targets: label, scale: 1, duration: 200, ease: "Back.easeOut" });
  }

  function flyCoinsToVault({ x, y, team, amount = 1, big = false }) {
    coinFx.floatText(Number(x), Number(y) - 18, `+${formatCoins(Math.abs(Number(amount)))}`, {
      size: big ? 16 : 13,
    });
    const count = big
      ? 12
      : Math.max(4, Math.min(9, Math.round(Math.abs(Number(amount)) / 220) + 2));
    coinFx.flyTo(Number(x), Number(y), () => cachedVaultTarget(team), {
      count,
      onArrive: () => {
        playPayoutTick();
        punchVaultLabel(team);
      },
    });
  }

  // A purchase: coins leave the vault and land on the thing being bought.
  function flyCoinsFromVault({ x, y, team, amount = 1 }) {
    coinFx.floatText(Number(x), Number(y) - 40, `-${formatCoins(Math.abs(Number(amount)))}`, {
      color: "#ff9d9d",
      size: 13,
    });
    const origin = cachedVaultTarget(team);
    if (!origin) return;
    const target = { x: Number(x), y: Number(y) };
    coinFx.flyTo(origin.x, origin.y, () => target, {
      count: Math.max(4, Math.min(10, Math.round(Math.abs(Number(amount)) / 900) + 3)),
      onArrive: playPayoutTick,
    });
  }

  function processModeEvents(modeState) {
    // One ledger drives every piece of coin feedback, so a gain and a loss are
    // always shown the same way whatever caused them.
    for (const event of Array.isArray(modeState?.coinEvents) ? modeState.coinEvents : []) {
      const at = Number(event?.at) || 0;
      if (!at || at < state.lastCoinEventAt) continue;
      if (at > state.lastCoinEventAt) {
        state.lastCoinEventAt = at;
        state.coinEventsAtLast.clear();
      }
      const eventKey = `${event?.team}:${event?.coins}`;
      if (state.coinEventsAtLast.has(eventKey)) continue;
      state.coinEventsAtLast.add(eventKey);
      const team = event?.team;
      if (team !== "team1" && team !== "team2") continue;
      const delta = Number(event?.delta) || 0;
      const eventVault = getLayoutVault(team, modeState?.vaults?.[team]);
      if (delta > 0) vaultFx.deposit(team, eventVault);
      const from =
        Number.isFinite(Number(event?.x)) && Number.isFinite(Number(event?.y))
          ? { x: Number(event.x), y: Number(event.y) }
          : getPlayerPositionByName(event?.actor) || getObjectPositionById(event?.source);

      switch (String(event?.reason)) {
        case "pickup":
          safePlaySfx("sfx-coin-pickup", { volume: 0.14 });
          if (from) flyCoinsToVault({ ...from, team, amount: delta });
          break;
        case "mine":
          safePlaySfx("sfx-bankbust-mine-collect", { volume: 0.15 });
          if (event?.source) state.mineOwnerById.set(event.source, team);
          if (from) flyCoinsToVault({ ...from, team, amount: delta });
          break;
        case "deathDrop":
          safePlaySfx("sfx-coin-pickup", { volume: 0.12 });
          if (from) flyCoinsToVault({ ...from, team, amount: delta });
          break;
        case "centerGold":
          safePlaySfx("sfx-bankbust-mine-collect", { volume: 0.22 });
          if (from) flyCoinsToVault({ ...from, team, amount: delta, big: true });
          break;
        case "enemyAttack":
          vaultFx.hit(team, eventVault, -delta, getPlayerPositionByName(event?.actor));
          break;
        case "purchase-turret":
        case "purchase-wall":
          // Spending shows the coins leaving the vault for the thing bought,
          // so the cost is felt in the same currency as the damage.
          if (from) flyCoinsFromVault({ ...from, team, amount: -delta });
          break;
        default:
          break;
      }
    }

    const nextStates = new Map();
    for (const entry of Array.isArray(modeState?.objects) ? modeState.objects : []) {
      const prev = state.previousObjectStates.get(entry.id) || {};
      const cur = entry?.state || {};
      if (entry?.type === "claimableTurret" && !prev?.claimedByTeam && cur?.claimedByTeam) {
        safePlaySfx("sfx-bankbust-turret-claim", { volume: 0.35 });
      }
      if (entry?.type === "wallSlot" && !prev?.builtByTeam && cur?.builtByTeam) {
        safePlaySfx("sfx-bankbust-wall-claim", { volume: 0.35 });
      }
      nextStates.set(entry.id, cloneJson(cur) || {});
    }
    state.previousObjectStates = nextStates;

    const nextProjectileIds = new Set(
      (Array.isArray(modeState?.turretProjectiles) ? modeState.turretProjectiles : []).map(
        (entry) => entry.id,
      ),
    );
    for (const shot of Array.isArray(modeState?.turretProjectiles)
      ? modeState.turretProjectiles
      : []) {
      if (state.recentProjectileIds.has(shot.id)) continue;
      safePlaySfx("sfx-bankbust-turret-shoot", { volume: 0.16 });
      playTurretMuzzle(shot);
    }
    state.recentProjectileIds = nextProjectileIds;
  }

  return { processModeEvents };
}
