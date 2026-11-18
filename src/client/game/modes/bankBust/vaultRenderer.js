import { BANK_BUST_VAULT_DEFAULT_WIDTH, BANK_BUST_VAULT_DEFAULT_HEIGHT } from "../../../../shared/bankBustSettings.js";
import { RENDER_LAYERS } from "../../scene/renderLayers";
import { PUFF_TEXTURE } from "./vaultEffects";
import { COIN_FRAME_SIZE } from "./coinMotion.mjs";
import { TEAM_PALETTE } from "./teamPalette";
import { setStaticShotTargets } from "../../characters/shared/shotPrediction";

export function createVaultRenderer({
  vaultSprites,
  scene,
  vaultGlows,
  Phaser,
  uiGraphics,
  vaultCoinLabels,
  vaultFx,
  getLayoutVault,
  getLocalTeam,
  state,
  reducedMotion,
  colourTeam,
  formatCoins,
}) {
  // Which vault frame a coin level should be showing. The vault visibly
  // degrades as it is emptied, so its condition reads from across the map.
  function vaultStateKey(coins, startingCoins) {
    if (coins <= 0) return "breached";
    const ratio = coins / Math.max(1, startingCoins);
    return ratio <= 0.4 ? "damaged" : "intact";
  }

  function ensureVaultSprite(team) {
    let entry = vaultSprites.get(team) || null;
    if (entry?.body?.scene) return entry;
    if (!scene.textures?.exists?.("bank-bust-vault-intact")) return null;
    const body = scene.add.image(-9999, -9999, "bank-bust-vault-intact");
    body.setDepth(RENDER_LAYERS.GAME_OBJECTS + 1);
    body.setVisible(false);
    entry = { body, stateKey: null };
    vaultSprites.set(team, entry);
    return entry;
  }

  // A warm halo behind each vault. The vault is the thing both teams are
  // playing around, and without it the door was just another dark panel on a
  // dark wall: you could walk past your own objective without seeing it.
  function ensureVaultGlow(team) {
    let glow = vaultGlows.get(team) || null;
    if (glow?.halo?.scene) return glow;
    const halo = scene.add.image(-9999, -9999, PUFF_TEXTURE);
    halo.setBlendMode(Phaser.BlendModes.ADD);
    halo.setDepth(RENDER_LAYERS.GAME_OBJECTS - 2);
    const core = scene.add.image(-9999, -9999, PUFF_TEXTURE);
    core.setBlendMode(Phaser.BlendModes.ADD);
    core.setDepth(RENDER_LAYERS.GAME_OBJECTS - 2);
    glow = { halo, core };
    vaultGlows.set(team, glow);
    return glow;
  }

  // The HUD bars wear the lobby chroma mosaic; this draws the same muted
  // squares over a world-space fill. Cells are hashed from their position on
  // the bar, so the pattern holds still as the fill drains.
  const BAR_CHROMA = [0x548cb1, 0x7779af, 0xaa5555, 0x468e91, 0x986f88, 0xb79b48];

  const BAR_CHROMA_CELL = 3;

  function drawBarChroma(x, y, width, height) {
    for (let col = 0; col * BAR_CHROMA_CELL < width; col++) {
      for (let row = 0; row * BAR_CHROMA_CELL < height; row++) {
        const hash = ((col * 73856093) ^ (row * 19349663)) >>> 0;
        if (hash % 7 > 2) continue;
        uiGraphics.fillStyle(BAR_CHROMA[hash % BAR_CHROMA.length], 0.14 + (hash % 3) * 0.06);
        uiGraphics.fillRect(
          x + col * BAR_CHROMA_CELL,
          y + row * BAR_CHROMA_CELL,
          Math.min(BAR_CHROMA_CELL, width - col * BAR_CHROMA_CELL),
          Math.min(BAR_CHROMA_CELL, height - row * BAR_CHROMA_CELL),
        );
      }
    }
  }

  // A coin beside a count: the label shifts right so the pair stays centred
  // on (cx, cy). The icon lives wherever its label does.
  function ensureCoinIcon(label, parent = null) {
    if (label._coinIcon?.scene) return label._coinIcon;
    const icon = scene.add.image(0, 0, "coin-spin", 0);
    icon.setDepth(label.depth);
    if (parent) parent.add(icon);
    label._coinIcon = icon;
    return icon;
  }

  function placeCoinLabel(label, icon, cx, cy, size) {
    const iconSize = size;
    const gap = Math.max(2, Math.round(size / 4));
    const scale = Math.max(0.01, Math.abs(label.scaleX) || 1);
    const labelW = label.width * scale;
    const total = iconSize + gap + labelW;
    icon.setScale(iconSize / COIN_FRAME_SIZE);
    icon.setPosition(cx - total / 2 + iconSize / 2, cy);
    label.setPosition(cx + (iconSize + gap) / 2, cy);
  }

  // The coins-in-vault number, drawn over each vault in the world.
  function ensureVaultCoinLabel(team) {
    let label = vaultCoinLabels.get(team) || null;
    if (label?.scene) return label;
    label = scene.add.text(-9999, -9999, "0", {
      fontFamily: "'Press Start 2P', monospace",
      fontSize: "13px",
      color: "#fde68a",
      stroke: "#0b1220",
      strokeThickness: 5,
    });
    label.setOrigin(0.5);
    label.setDepth(RENDER_LAYERS.GAME_OBJECTS + 7);
    vaultCoinLabels.set(team, label);
    return label;
  }

  function hideUnusedVaults(usedTeams) {
    for (const [team, entry] of vaultSprites.entries()) {
      if (usedTeams.has(team)) continue;
      vaultFx.hide(team);
      entry?.body?.setVisible?.(false);
    }
    for (const [team, glow] of vaultGlows.entries()) {
      if (usedTeams.has(team)) continue;
      glow?.halo?.setVisible?.(false);
      glow?.core?.setVisible?.(false);
    }
    for (const [team, label] of vaultCoinLabels.entries()) {
      if (usedTeams.has(team)) continue;
      label?.setVisible?.(false);
      label?._coinIcon?.setVisible?.(false);
    }
  }

  function renderVaults(modeState) {
    const usedVaults = new Set();
    // Standing enemy vaults are shot targets for this player's predicted hits.
    const shotTargets = [];
    const lowRatio = Number(modeState?.lowCoinsRatio) || 0.25;

    for (const [team, vaultRaw] of Object.entries(modeState?.vaults || {})) {
      usedVaults.add(team);
      const vault = getLayoutVault(team, vaultRaw);
      const coins = Math.max(0, Number(vaultRaw?.coins) || 0);
      const startingCoins = Math.max(1, Number(vaultRaw?.startingCoins) || 1);
      const ratio = Phaser.Math.Clamp(coins / startingCoins, 0, 1);
      const width = Math.max(60, Number(vault.width) || BANK_BUST_VAULT_DEFAULT_WIDTH);
      const height = Math.max(60, Number(vault.height) || BANK_BUST_VAULT_DEFAULT_HEIGHT);
      const x = Number(vault.x) || 0;
      const y = Number(vault.y) || 0;

      if (coins > 0 && getLocalTeam() && team !== getLocalTeam()) {
        shotTargets.push({
          name: `vault:${team}`,
          inset: false,
          bounds: {
            left: x - width / 2,
            right: x + width / 2,
            top: y - height / 2,
            bottom: y + height / 2,
          },
        });
      }

      if (coins > 0) {
        state.vaultsSeenStanding.add(team);
      } else if (state.vaultsSeenStanding.delete(team)) {
        vaultFx.bust(team, { x, y, width, height });
      }

      const entry = ensureVaultSprite(team);
      let stateKey = vaultStateKey(coins, startingCoins);
      if (entry?.stateKey && vaultFx.holdingFrame(team, entry.stateKey)) {
        stateKey = entry.stateKey;
      }
      if (entry && entry.stateKey !== stateKey) {
        if (entry.stateKey) {
          vaultFx.conditionChanged(team, { x, y, width, height }, entry.stateKey, stateKey);
        }
        entry.stateKey = stateKey;
        entry.body.setTexture(`bank-bust-vault-${stateKey}`);
      }

      const low = ratio <= lowRatio;
      const pose = vaultFx.pose(team, { x, y, width, height }, { low, health: ratio, stateKey });
      const drawX = pose.x;
      const drawY = pose.y;

      if (entry) {
        entry.body.setPosition(drawX, pose.spriteY);
        entry.body.setDisplaySize(width * pose.scaleX, height * pose.scaleY);
        entry.body.setVisible(true);
        entry.body.clearTint();
        if (pose.flash) entry.body.setTintFill(0xffffff);
        else if (stateKey === "breached") entry.body.setTint(0x8b93a4);
      }

      // A halo behind the door, breathing, and brighter the fuller the vault
      // is. This is what makes the objective findable across a dark level.
      const glow = ensureVaultGlow(team);
      if (glow) {
        const breathe = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(scene.time.now / 900);
        const alive = coins > 0 ? 1 : 0.25;
        const haloColour = pose.bloom > 0.15 ? 0xffb347 : coins > 0 ? 0xffb347 : 0x64748b;
        const haloAlpha = (0.1 + 0.07 * breathe) * alive;
        const haloSize = 2 * (width * (1 + 0.7 * pose.bloom) + 18 * breathe);
        glow.halo.setPosition(drawX, drawY);
        glow.halo.setDisplaySize(haloSize, haloSize);
        glow.halo.setTint(haloColour);
        glow.halo.setAlpha(Math.min(1, 2.2 * (haloAlpha + 0.32 * pose.bloom)));
        glow.halo.setVisible(true);
        const coreSize = 2 * (width * 0.62 + 8 * breathe);
        glow.core.setPosition(drawX, drawY);
        glow.core.setDisplaySize(coreSize, coreSize);
        glow.core.setTint(TEAM_PALETTE[colourTeam(team)]?.soft ?? TEAM_PALETTE.neutral.muzzle);
        glow.core.setAlpha(1.6 * (0.1 + 0.08 * breathe) * alive);
        glow.core.setVisible(true);
      }

      // The hit box, drawn. These are exactly the bounds a shot is tested
      // against, so a vault now visibly occupies the rectangle it occupies:
      // before this there was nothing to tell you it could be attacked at all.
      if (coins > 0) {
        const hitLeft = drawX - width / 2;
        const hitTop = drawY - height / 2;
        const outlineTint = TEAM_PALETTE[colourTeam(team)]?.strong ?? TEAM_PALETTE.neutral.strong;
        uiGraphics.lineStyle(3, pose.hot ? 0xfff1b8 : outlineTint, pose.hot ? 1 : 0.7);
        uiGraphics.strokeRect(hitLeft, hitTop, width, height);
        // Corner ticks, so the rectangle still reads as a target and not as a
        // box someone drew around the art.
        const tick = Math.round(Math.min(width, height) * 0.16);
        uiGraphics.lineStyle(5, pose.hot ? 0xffffff : outlineTint, 0.95);
        for (const [cx, sx] of [
          [hitLeft, 1],
          [hitLeft + width, -1],
        ]) {
          for (const [cy, sy] of [
            [hitTop, 1],
            [hitTop + height, -1],
          ]) {
            uiGraphics.beginPath();
            uiGraphics.moveTo(cx + sx * tick, cy);
            uiGraphics.lineTo(cx, cy);
            uiGraphics.lineTo(cx, cy + sy * tick);
            uiGraphics.strokePath();
          }
        }
      }

      // Coins are this mode's only health pool, so one bar carries both
      // readings: how much is left to steal and how close the vault is to
      // breaking. Keep the bar and coin label above the artwork so neither
      // is covered by the vault or the platform it stands on.
      const barWidth = Math.round(width * 0.86);
      const barHeight = 12;
      const barX = drawX - barWidth / 2;
      const barY = drawY - height / 2 - barHeight - 12;
      uiGraphics.fillStyle(0x0b1220, 0.9);
      uiGraphics.fillRect(barX - 3, barY - 3, barWidth + 6, barHeight + 6);
      uiGraphics.fillStyle(0x1f2937, 1);
      uiGraphics.fillRect(barX, barY, barWidth, barHeight);
      // What was just lost stays lit and drains away, so a hit reads on the
      // bar as a chunk gone rather than a width that quietly changed.
      const ghostRatio = Math.max(
        ratio,
        (state.vaultBarGhost.get(team) ?? ratio) -
          (reducedMotion ? 1 : (Number(scene.game?.loop?.delta) || 16) / 900),
      );
      state.vaultBarGhost.set(team, ghostRatio);
      uiGraphics.fillStyle(0xffffff, 0.85);
      uiGraphics.fillRect(barX, barY, barWidth * ghostRatio, barHeight);
      uiGraphics.fillStyle(TEAM_PALETTE[colourTeam(team)]?.soft ?? TEAM_PALETTE.neutral.soft, 1);
      uiGraphics.fillRect(barX, barY, Math.max(0, barWidth * ratio), barHeight);
      drawBarChroma(barX, barY, Math.max(0, barWidth * ratio), barHeight);
      const coinLabel = ensureVaultCoinLabel(team);
      coinLabel.setText(formatCoins(coins));
      coinLabel.setScale(pose.labelScale);
      const coinIcon = ensureCoinIcon(coinLabel);
      placeCoinLabel(coinLabel, coinIcon, drawX, barY - 14, 16 * pose.labelScale);
      coinLabel.setVisible(true);
      coinIcon.setVisible(true);
    }
    hideUnusedVaults(usedVaults);
    const site = modeState?.centerGold;
    if (site?.phase === "active" && site.health > 0) {
      const width = Number(site.width) || 124;
      const height = Number(site.height) || 116;
      shotTargets.push({
        name: "crate:center",
        inset: false,
        bounds: {
          left: site.x - width / 2,
          right: site.x + width / 2,
          top: site.y - height / 2,
          bottom: site.y + height / 2,
        },
      });
    }
    setStaticShotTargets("bankBust", shotTargets);
  }

  return { ensureCoinIcon, placeCoinLabel, hideUnusedVaults, renderVaults };
}
