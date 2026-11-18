import { createPlayerWorldHud } from "../scene/playerWorldHud";
import { playerAnchor } from "../characters/shared/rig";
import { drawSuperChargeBar, resetSuperBarAnimation } from "../scene/superBarRenderer";
import { drawHealthBar, resetHealthBarAnimation } from "../scene/healthBarRenderer";
import { drawAmmoChargeBar } from "../scene/ammoBarRenderer";
import { setStatusIconStackAlpha, setStatusIconStackVisible } from "../scene/statusIconStack";
import { RENDER_LAYERS } from "../scene/renderLayers";
export function createLocalHud(scene, player, {
  username, getPlayerEffects, stats, ammo, getStableLocalUiTop, isInvisible, clearAttackAimReticle, superFlashActive, ammoShakeActive,
}) {
  const healthBarWidth = 52;
  const ammoBarWidth = 52;
  // Player name text anchored to physics body top (not frame height)
  const bodyTop = player.body ? player.body.y : player.y - player.height / 2;
  const worldHud = createPlayerWorldHud(scene, { username, getPlayerEffects, x: player.x, y: bodyTop - 40, nameDepth: 42 });
  const { playerName, healthText, healthBar, duckShieldGlow, duckShieldIcon, superBar, superBarBack,
    statusIcons: powerupStatusIcons } = worldHud;

  // Ammo bar background & fill (render order: background, fill)
  const ammoBarBack = scene.add.graphics();
  const ammoBar = scene.add.graphics();

  // Triangle to show which one is the user. Dissapears when the player moves
  const indicatorTriangle = scene.add.graphics();
  setLocalUiVisible(false);

  // Arrow above the body top so it's consistent across different frame paddings
  const triangle = new Phaser.Geom.Triangle(
    player.x,
    bodyTop - 10, // Top point
    player.x - 13,
    bodyTop - 20, // Left point
    player.x + 13,
    bodyTop - 20, // Right point
  );
  indicatorTriangle.fillStyle(0x99ab2c); // Green color
  indicatorTriangle.fillTriangleShape(triangle);
  indicatorTriangle.setVisible(false);

  function setLocalUiVisible(visible) {
    const shouldShow = visible !== false;
    if (!shouldShow) {
      resetHealthBarAnimation(healthBar);
      resetSuperBarAnimation(superBar, player);
    }
    try {
      playerName?.setVisible(shouldShow);
    } catch (_) {}
    try {
      healthText?.setVisible(shouldShow);
    } catch (_) {}
    try {
      healthBar?.setVisible(shouldShow);
    } catch (_) {}
    try {
      const showDuckShield = shouldShow && !stats.dead && !!player?._ducking;
      duckShieldIcon?.setVisible(showDuckShield);
      duckShieldGlow?.setVisible(showDuckShield);
      if (!shouldShow) setStatusIconStackVisible(powerupStatusIcons, false);
    } catch (_) {}
    try {
      ammoBar?.setVisible(shouldShow);
    } catch (_) {}
    try {
      ammoBarBack?.setVisible(shouldShow);
    } catch (_) {}
    try {
      superBar?.setVisible(shouldShow);
    } catch (_) {}
    try {
      superBarBack?.setVisible(shouldShow);
    } catch (_) {}
    try {
      indicatorTriangle?.setVisible(shouldShow);
      if (!shouldShow) indicatorTriangle?.clear?.();
    } catch (_) {}
    if (!shouldShow) {
      clearAttackAimReticle();
    }
  }

  function setLocalUiAlpha(alpha = 1) {
    const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
    for (const item of [
      playerName,
      healthText,
      healthBar,
      duckShieldIcon,
      duckShieldGlow,
      ammoBar,
      ammoBarBack,
      superBar,
      superBarBack,
      indicatorTriangle,
    ]) {
      try {
        item?.setAlpha?.(safeAlpha);
      } catch (_) {}
    }
    setStatusIconStackAlpha(powerupStatusIcons, safeAlpha);
    try {
      const hudRoot = document.getElementById("hud");
      if (hudRoot) {
        hudRoot.style.transition = "opacity 180ms ease";
        hudRoot.style.opacity = isInvisible() ? "0.48" : "";
      }
    } catch (_) {}
  }

  function drawIndicatorTriangle() {
    if (!indicatorTriangle || !player) return;
    indicatorTriangle.clear();
    const bodyTop = getStableLocalUiTop();
    const hudX = playerAnchor(player, "top").x;
    const triangle = new Phaser.Geom.Triangle(
      hudX,
      bodyTop - 10,
      hudX - 13,
      bodyTop - 20,
      hudX + 13,
      bodyTop - 20,
    );
    indicatorTriangle.fillStyle(0x99ab2c);
    indicatorTriangle.fillTriangleShape(triangle);
  }

  function syncLocalUiPosition() {
    if (!player) return;
    const uiTop = getStableLocalUiTop();
    try {
      playerName?.setPosition(playerAnchor(player, "top").x, uiTop - 42);
    } catch (_) {}
    try {
      if (indicatorTriangle?.visible) drawIndicatorTriangle();
    } catch (_) {}
    updateHealthBar();
  }

  function updateHealthBar() {
    if (stats.currentHealth <= 0) stats.currentHealth = 0;

    const healthBarX = playerAnchor(player, "top").x - healthBarWidth / 2;
    const bodyTop = getStableLocalUiTop();
    // Always anchor to bodyTop so it doesn't jump when dead
    const y = bodyTop - 20; // just above body

    if (!stats.dead) {
      healthText.setText(`${stats.currentHealth}`);
    } else {
      // Show 0 instead of blank when dead
      healthText.setText(`0`);
    }

    drawHealthBar(healthBar, {
      x: healthBarX, y, width: healthBarWidth,
      health: stats.currentHealth, maxHealth: stats.maxHealth, color: 0xaebb50, teamGlowColor: 0x83dca6, isLocal: true,
    });
    healthBar.setDepth(RENDER_LAYERS.PLAYER_HUD + 1);

    worldHud?.layout({
      x: healthBarX, y, width: healthBarWidth, sprite: player,
      visible: !stats.dead && healthBar.visible !== false,
    });

    healthText.setPosition(player.x - healthText.width / 2, y - 8);
    healthText.setDepth(RENDER_LAYERS.PLAYER_HUD + 2);

    // Draw ammo bar underneath health (only for local player & when alive)
    // Each bar's 2px pixel frame overlaps the one above, so the stack reads as
    // one panel with ink dividers.
    drawAmmoBar(healthBarX, y + 11);
    drawSuperBar(healthBarX, y + 19);
  }

  function drawSuperBar(x, y) {
    if (!superBar || !superBarBack) return;
    drawSuperChargeBar(superBar, superBarBack, {
      x, y, charge: stats.superCharge, maxCharge: stats.maxSuperCharge, player,
      notReady: superFlashActive(),
    });
  }

  function drawAmmoBar(forcedX, forcedY) {
    if (!ammoBar || !ammoBarBack) return;
    const shakeX =
      ammoShakeActive() ? Phaser.Math.Between(-3, 3) : 0;
    const x =
      (forcedX !== undefined ? forcedX : player.x - ammoBarWidth / 2) + shakeX;
    const bodyTop = getStableLocalUiTop();
    const y = forcedY !== undefined ? forcedY : bodyTop - 9; // just under health bar
    drawAmmoChargeBar(ammoBar, ammoBarBack, { x, y, width: ammoBarWidth,
      ammo: ammo.state,
    });
  }

  function hideSpawnIndicator() {
    if (!indicatorTriangle) return;
    indicatorTriangle.clear();
    indicatorTriangle.setVisible(false);
  }

  let destroyed = false;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    worldHud.destroy();
    for (const graphics of [indicatorTriangle, ammoBar, ammoBarBack]) graphics.destroy?.();
  }
  function showIndicator() {
    indicatorTriangle.setVisible(true);
    drawIndicatorTriangle();
  }
  return { setLocalUiVisible, setLocalUiAlpha, syncLocalUiPosition, updateHealthBar, drawAmmoBar,
    hideSpawnIndicator, showIndicator, destroy };
}
