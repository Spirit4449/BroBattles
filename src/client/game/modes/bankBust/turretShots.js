import { TEAM_PALETTE } from "./teamPalette";
import { RENDER_LAYERS } from "../../scene/renderLayers";

export function createTurretShots({
  reducedMotion,
  colourTeam,
  scene,
  Phaser,
  coinFx,
  getMapObjects,
  turretProjectileLocallyDestroyed,
  ensureObjectSprite,
  turretProjectileSprites,
  turretProjectileVisualState,
  wallBodies,
}) {
  // A turret firing: a flash down the barrel and a coin thrown out of the
  // breech. The gun is bolted to a bank, so it spits coins for casings.
  function playTurretMuzzle(shot) {
    if (reducedMotion) return;
    const x = Number(shot?.x) || 0;
    const y = Number(shot?.y) || 0;
    const angle = Number(shot?.angle) || 0;
    const team = colourTeam(shot?.ownerTeam);
    const colour = (TEAM_PALETTE[team] || TEAM_PALETTE.neutral).muzzle;

    const flash = scene.add.circle(x, y, 16, colour, 0.85);
    flash.setBlendMode(Phaser.BlendModes.ADD);
    flash.setDepth(RENDER_LAYERS.ATTACKS);
    scene.tweens.add({
      targets: flash,
      radius: 30,
      alpha: 0,
      duration: 130,
      ease: "Quad.easeOut",
      onComplete: () => {
        try {
          flash.destroy();
        } catch (_) {}
      },
    });
    // Sparks along the line of fire.
    const spark = scene.add.rectangle(x, y, 34, 5, 0xfff3c4, 0.9);
    spark.setRotation(angle);
    spark.setBlendMode(Phaser.BlendModes.ADD);
    spark.setDepth(RENDER_LAYERS.ATTACKS);
    scene.tweens.add({
      targets: spark,
      scaleX: 1.9,
      alpha: 0,
      duration: 110,
      ease: "Quad.easeOut",
      onComplete: () => {
        try {
          spark.destroy();
        } catch (_) {}
      },
    });
    // Casings out of the back of the gun, a couple per shot.
    coinFx.burst(x, y, {
      count: 2,
      speed: [70, 150],
      spread: 0.7,
      direction: angle + Math.PI * 0.75,
      scale: 0.6,
      life: [380, 620],
    });
  }

  function renderTurretProjectiles(modeState) {
    const activeIds = new Set();
    const now = Date.now();
    const dtMs = Math.max(1, Math.min(50, Number(scene?.game?.loop?.delta) || 16));
    const dtSec = dtMs / 1000;
    const mapColliders = Array.isArray(getMapObjects?.()) ? getMapObjects() : [];
    for (const shot of Array.isArray(modeState?.turretProjectiles)
      ? modeState.turretProjectiles
      : []) {
      activeIds.add(shot.id);
      if (turretProjectileLocallyDestroyed.has(shot.id)) continue;
      const sprite = ensureObjectSprite(
        turretProjectileSprites,
        shot.id,
        "bank-bust-bullet",
        RENDER_LAYERS.ATTACKS,
      );
      if (!sprite) continue;
      const ownerTeam = shot?.ownerTeam || null;
      sprite.setVisible(true);
      const serverX = Number(shot?.x) || 0;
      const serverY = Number(shot?.y) || 0;
      const serverVx = Number(shot?.vx) || 0;
      const serverVy = Number(shot?.vy) || 0;
      const targetAngle = Number(shot?.angle) || 0;
      sprite.setDisplaySize(22, 14);
      if (!turretProjectileVisualState.has(shot.id)) {
        turretProjectileVisualState.set(shot.id, {
          x: serverX,
          y: serverY,
          vx: serverVx,
          vy: serverVy,
          lastServerX: serverX,
          lastServerY: serverY,
          bornAt: now,
          rotation: targetAngle,
        });
      }

      const visual = turretProjectileVisualState.get(shot.id);
      if (visual) {
        // Client-side ballistic sim: use authoritative velocity and only softly correct drift.
        visual.vx = Phaser.Math.Linear(visual.vx, serverVx, 0.2);
        visual.vy = Phaser.Math.Linear(visual.vy, serverVy, 0.2);
        visual.x += visual.vx * dtSec;
        visual.y += visual.vy * dtSec;
        visual.x = Phaser.Math.Linear(visual.x, serverX, 0.08);
        visual.y = Phaser.Math.Linear(visual.y, serverY, 0.08);
        visual.rotation = Phaser.Math.Angle.RotateTo(visual.rotation, targetAngle, 0.6);
        sprite.setPosition(visual.x, visual.y);
        sprite.setRotation(visual.rotation);

        let hitBarrier = false;
        for (const mapObject of mapColliders) {
          if (!mapObject?.body) continue;
          if (scene.physics.overlap(sprite, mapObject)) {
            hitBarrier = true;
            break;
          }
        }
        if (!hitBarrier) {
          for (const wall of wallBodies.values()) {
            const zone = wall?.zone;
            if (!zone?.body) continue;
            if (scene.physics.overlap(sprite, zone)) {
              hitBarrier = true;
              break;
            }
          }
        }
        if (hitBarrier) {
          turretProjectileLocallyDestroyed.add(shot.id);
          sprite.setVisible(false);
          continue;
        }
      } else {
        sprite.setPosition(serverX, serverY);
        sprite.setRotation(targetAngle);
      }
      sprite.clearTint();
      const colour = colourTeam(ownerTeam);
      if (colour === "team1" || colour === "team2") sprite.setTint(TEAM_PALETTE[colour].soft);
    }
    for (const [id, sprite] of turretProjectileSprites.entries()) {
      if (activeIds.has(id)) continue;
      sprite.destroy();
      turretProjectileSprites.delete(id);
      turretProjectileVisualState.delete(id);
      turretProjectileLocallyDestroyed.delete(id);
    }
  }

  return { playTurretMuzzle, renderTurretProjectiles };
}
