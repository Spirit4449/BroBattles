import { bindCanvasName } from "../../site/preferences";
import { RENDER_LAYERS } from "./renderLayers";
import { syncStatusIconStack, destroyStatusIconStack } from "./statusIconStack";
import { TEAM_GREEN } from "../../../shared/projectilePresentation";
import { drawHealthBar } from "./healthBarRenderer";
import { drawAmmoChargeBar } from "./ammoBarRenderer";
import { drawSuperChargeBar } from "./superBarRenderer";

export const WORLD_HUD_WIDTH = 52;
const PLAYER_COLORS = {
  self: { color: 0xaebb50, teamGlowColor: 0x83dca6 },
  ally: { color: 0x99ab2c, teamGlowColor: TEAM_GREEN },
  enemy: { color: 0xb24035, teamGlowColor: 0xe04a4e },
};

export function createPlayerWorldHud(scene, { username, role, getPlayerEffects }) {
  const playerName = scene.add.text(0, 0, username);
  bindCanvasName(playerName, username);
  playerName.setStyle({
    fontFamily: "'Press Start 2P', monospace",
    fontSize: "7px",
    fill: "#ffffff",
    stroke: "#000000",
    strokeThickness: 3,
  });
  playerName.setShadow(1, 1, "rgba(0, 0, 0, 0.65)", 0, true, true);
  playerName.setOrigin(0.5, 0);
  playerName.setDepth(RENDER_LAYERS.PLAYER_HUD + 2);

  // Health text
  const healthText = scene.add.text(0, 0, "", {
    fontFamily: "'Press Start 2P', monospace",
    fontSize: "9px",
    color: "#FFFFFF",
    stroke: "#000000",
    strokeThickness: 4,
  });

  healthText.setOrigin(0.5, 0.5);
  healthText.setShadow(0, 1, "#000000", 0, true, true);
  healthText.setDepth(RENDER_LAYERS.PLAYER_HUD + 2);

  // Health bar
  const healthBar = scene.add.graphics();
  healthBar.setDepth(RENDER_LAYERS.PLAYER_HUD + 1);
  const duckShieldGlow = scene.add.image(0, 0, "pu-icon-shield-webp");
  duckShieldGlow
    .setDisplaySize(20, 23)
    .setTint(0xff8d32)
    .setAlpha(0.4)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setDepth(RENDER_LAYERS.PLAYER_HUD + 1.5)
    .setVisible(false);
  const duckShieldIcon = scene.add.image(0, 0, "pu-icon-shield-webp");
  duckShieldIcon
    .setDisplaySize(13, 15)
    .setDepth(RENDER_LAYERS.PLAYER_HUD + 3)
    .setVisible(false);
  const pulse = scene.tweens.add({
    targets: duckShieldGlow,
    displayWidth: { from: 18, to: 22 },
    displayHeight: { from: 21, to: 26 },
    duration: 520,
    ease: "Sine.InOut",
    yoyo: true,
    repeat: -1,
  });
  const superBarBack = scene.add.graphics();
  const superBar = scene.add.graphics();
  const statusIcons = [];
  const local = role === "self";
  const ammoBarBack = local ? scene.add.graphics() : null;
  const ammoBar = local ? scene.add.graphics() : null;
  const barsAndLabels = [playerName, healthText, healthBar, superBarBack, superBar];
  if (local) barsAndLabels.push(ammoBarBack, ammoBar);

  // Attach the bottom of the complete panel just above the head. A remote
  // fighter has one fewer row, so its health and name move down together.
  const superOffset = local ? 19 : 11;
  const superY = headY => Math.round(headY) - 9; // 4px fill, 2px frame, 3px clearance.
  const nameY = headY => superY(headY) - superOffset - 22;
  function drawAmmo(sprite, headY, ammo, shakeX = 0) {
    if (local) drawAmmoChargeBar(ammoBar, ammoBarBack, {
      x: Math.round(sprite.x) - WORLD_HUD_WIDTH / 2 + shakeX,
      y: superY(headY) - superOffset + 11, width: WORLD_HUD_WIDTH, ammo,
    });
  }

  return {
    playerName, healthText, healthBar, duckShieldGlow, duckShieldIcon, superBar, superBarBack, statusIcons,
    ammoBar, ammoBarBack, barsAndLabels, drawAmmo,
    markerY: headY => nameY(headY) - 8,
    draw({ sprite, headY, health, maxHealth, charge, maxCharge, ammo, shakeX, notReady, dead, visible }) {
      const centerX = Math.round(sprite.x);
      const width = WORLD_HUD_WIDTH;
      const x = centerX - width / 2;
      const y = superY(headY) - superOffset;
      playerName.setPosition(centerX, nameY(headY));
      healthText.setText(String(dead ? 0 : Math.max(0, Math.round(health))));
      healthText.setPosition(centerX, y);
      drawHealthBar(healthBar, { x, y, width, health, maxHealth, ...PLAYER_COLORS[role], isLocal: local });
      drawAmmo(sprite, headY, ammo, shakeX);
      drawSuperChargeBar(superBar, superBarBack, {
        x, y: y + superOffset, width, charge, maxCharge, player: sprite, notReady,
      });
      const shieldX = x + width + 1;
      const shieldY = y + 4.5;
      const showDuckShield = visible && !!sprite?._ducking;
      duckShieldGlow.setPosition(shieldX, shieldY).setVisible(showDuckShield);
      duckShieldIcon.setPosition(shieldX, shieldY).setVisible(showDuckShield);
      syncStatusIconStack({
        scene,
        icons: statusIcons,
        effects: getPlayerEffects?.(username),
        recentEffects: sprite?._recentPowerupEffects,
        x: x - 1,
        y: shieldY,
        visible,
        startIndex: 0,
      });
    },
    destroy() {
      pulse?.remove?.();
      for (const element of barsAndLabels) element.destroy();
      duckShieldIcon.destroy();
      duckShieldGlow.destroy();
      destroyStatusIconStack(statusIcons);
    },
  };
}
