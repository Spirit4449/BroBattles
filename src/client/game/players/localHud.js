import { createPlayerWorldHud } from "../scene/playerWorldHud";
import { playerAnchor } from "../characters/shared/rig";
import { resetSuperBarAnimation } from "../scene/superBarRenderer";
import { resetHealthBarAnimation } from "../scene/healthBarRenderer";
import { setStatusIconStackAlpha, setStatusIconStackVisible } from "../scene/statusIconStack";
export function createLocalHud(scene, player, {
  username, getPlayerEffects, stats, ammo, getStableLocalUiTop, isInvisible, clearAttackAimReticle, superFlashActive, ammoShakeActive,
}) {
  const bodyTop = player.body ? player.body.y : player.y - player.height / 2;
  const worldHud = createPlayerWorldHud(scene, { username, getPlayerEffects, role: "self" });
  const { playerName, healthText, healthBar, duckShieldGlow, duckShieldIcon, superBar, superBarBack,
    ammoBar, ammoBarBack, statusIcons: powerupStatusIcons } = worldHud;

  // Spawn indicator disappears when the player moves.
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
    try {
      if (indicatorTriangle?.visible) drawIndicatorTriangle();
    } catch (_) {}
    updateHealthBar();
  }

  function updateHealthBar() {
    if (stats.currentHealth <= 0) stats.currentHealth = 0;

    worldHud.draw({
      sprite: player, headY: getStableLocalUiTop(),
      health: stats.currentHealth, maxHealth: stats.maxHealth, dead: stats.dead,
      charge: stats.superCharge, maxCharge: stats.maxSuperCharge,
      ammo: ammo.state, shakeX: ammoShake(), notReady: superFlashActive(),
      visible: !stats.dead && healthBar.visible !== false,
    });
  }

  function ammoShake() {
    return ammoShakeActive() ? Phaser.Math.Between(-3, 3) : 0;
  }

  function drawAmmoBar() {
    worldHud.drawAmmo(player, getStableLocalUiTop(), ammo.state, ammoShake());
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
    indicatorTriangle.destroy?.();
  }
  function showIndicator() {
    indicatorTriangle.setVisible(true);
    drawIndicatorTriangle();
  }
  return { setLocalUiVisible, setLocalUiAlpha, syncLocalUiPosition, updateHealthBar, drawAmmoBar,
    markerY: () => worldHud.markerY(getStableLocalUiTop()), hideSpawnIndicator, showIndicator, destroy };
}
