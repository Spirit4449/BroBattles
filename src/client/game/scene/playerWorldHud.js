import { bindCanvasName } from "../../site/preferences";
import { RENDER_LAYERS } from "./renderLayers";
import { syncStatusIconStack, destroyStatusIconStack } from "./statusIconStack";

export function createPlayerWorldHud(scene, { username, x, y, nameDepth, getPlayerEffects }) {
  const playerName = scene.add.text(x, y, username);
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
  playerName.setDepth(nameDepth);

  // Health text
  const healthText = scene.add.text(0, 0, "", {
    fontFamily: "'Press Start 2P', monospace",
    fontSize: "8px",
    color: "#FFFFFF",
    stroke: "#000000",
    strokeThickness: 4,
  });

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
  const elements = [playerName, healthText, healthBar, duckShieldGlow, duckShieldIcon, superBar, superBarBack];

  return {
    playerName, healthText, healthBar, duckShieldGlow, duckShieldIcon, superBar, superBarBack, statusIcons,
    layout({ x, y, width, sprite, visible }) {
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
      for (const element of elements) element.destroy();
      destroyStatusIconStack(statusIcons);
    },
  };
}
