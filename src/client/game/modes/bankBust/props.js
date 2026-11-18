import { RENDER_LAYERS } from "../../scene/renderLayers";
import { stepTurretAim } from "./turretMotion.mjs";
import PROP_FRAMES from "./propFrames.json";
import { TEAM_PALETTE } from "./teamPalette";
import { resolvePurchaseSettings } from "../../../../shared/bankBustSettings.js";
import { setShotBlockers } from "../../characters/shared/shotPrediction";

export function createProps({
  getMapCentreX,
  objectContainers,
  scene,
  reducedMotion,
  Phaser,
  wallBodies,
  playerLookup,
  getLayout,
  state,
  mineSprites,
  teamTexture,
  formatCoins,
  ensureCoinIcon,
  placeCoinLabel,
  turretBaseSprites,
  turretHeadSprites,
  colourTeam,
  objectGraphics,
  wallSprites,
  cleanupUnused,
  getLocalTeam,
}) {
  function ensureObjectContainer(id, type) {
    let container = objectContainers.get(id) || null;
    if (container?.scene) return container;
    const bg = scene.add.rectangle(0, 0, 130, 62, 0x000000, 0);
    const label = scene.add.text(0, 0, type, {
      fontFamily: "Lato, sans-serif",
      fontSize: "13px",
      color: "#f8fafc",
      fontStyle: "700",
      stroke: "#0f172a",
      strokeThickness: 4,
    });
    label.setOrigin(0.5);
    container = scene.add.container(-9999, -9999, [bg, label]);
    container.setSize(150, 90);
    container.setDepth(RENDER_LAYERS.GAME_OBJECTS + 1);
    container.setVisible(false);
    container._bg = bg;
    container._label = label;
    objectContainers.set(id, container);
    return container;
  }

  function ensureObjectSprite(map, id, textureKey, depth = RENDER_LAYERS.GAME_OBJECTS + 2) {
    let sprite = map.get(id) || null;
    if (sprite?.scene) return sprite;
    if (!scene.textures?.exists?.(textureKey)) return null;
    sprite = scene.add.image(-9999, -9999, textureKey);
    sprite.setDepth(depth);
    sprite.setVisible(false);
    map.set(id, sprite);
    return sprite;
  }

  // An animated prop. Its texture is per owner, so changing hands restarts the
  // loop on the new owner's sheet.
  function ensurePropSprite(map, id, textureKey, frames, depth) {
    let sprite = map.get(id) || null;
    if (!sprite?.scene) {
      if (!scene.textures?.exists?.(textureKey)) return null;
      sprite = scene.add.sprite(-9999, -9999, textureKey);
      sprite.setDepth(depth);
      sprite.setVisible(false);
      map.set(id, sprite);
    }
    if (sprite._propKey !== textureKey && scene.textures?.exists?.(textureKey)) {
      sprite._propKey = textureKey;
      const anim = `bank-bust-prop:${textureKey}`;
      if (!scene.anims.exists(anim)) {
        scene.anims.create({
          key: anim,
          frameRate: frames.rate,
          repeat: -1,
          frames: Array.from({ length: frames.frames }, (_, frame) => ({ key: textureKey, frame })),
        });
      }
      sprite.play(anim);
    }
    return sprite;
  }

  // Idle guns droop or sweep. Once aimed, the barrel follows the same server
  // angle as the bullets, with recoil on every shot.
  const turretMotion = new Map();

  const TURRET_RECOIL_PX = 9;

  function animateTurret(id, head, base, entry, runtime, ownerTeam, socket) {
    const now = scene.time.now;
    const seconds = now / 1000;
    const dt = Math.min(50, Number(scene.game?.loop?.delta) || 16) / 1000;
    let motion = turretMotion.get(id);
    if (!motion) {
      // Unclaimed turrets start facing the far side of the level, like their owner.
      const facing = Number(entry.x) < getMapCentreX() ? Math.PI : 0;
      motion = { angle: facing, facing, shotAt: NaN, recoil: 0, phase: Number(entry.x) % 7 };
      turretMotion.set(id, motion);
    }
    stepTurretAim(motion, runtime?.state?.aimAngle, ownerTeam, now, dt);

    const shotAt = Number(runtime?.state?.lastShotAt);
    if (Number.isFinite(shotAt) && shotAt !== motion.shotAt) {
      if (Number.isFinite(motion.shotAt)) {
        motion.recoil = 1;
        flashMuzzle(socket, motion.angle);
      }
      motion.shotAt = shotAt;
    }
    motion.recoil = Math.max(0, motion.recoil - dt * 6);

    // The barrels are drawn pointing left, so the gun kicks along its own +x.
    const kick = motion.recoil * motion.recoil * TURRET_RECOIL_PX;
    const hum = ownerTeam ? Math.sin(seconds * 2.6 + motion.phase) * 0.8 : 0;
    head.setRotation(motion.angle);
    head.setFlipY(Math.cos(motion.angle) < 0);
    head.setPosition(
      socket.x + Math.cos(motion.angle) * kick,
      socket.y + Math.sin(motion.angle) * kick + hum,
    );
    base.y += motion.recoil * 1.5;
    head.anims.timeScale = ownerTeam ? 1 : 0.25;
    base.anims.timeScale = ownerTeam ? 1 : 0.35;
  }

  function flashMuzzle(socket, angle) {
    if (reducedMotion) return;
    const reach = PROP_FRAMES["turret-gun"].frameWidth * PROP_FRAMES["turret-gun"].hubX;
    const flash = scene.add.circle(
      socket.x - Math.cos(angle) * reach,
      socket.y - Math.sin(angle) * reach,
      7,
      0xffd9a0,
      0.9,
    );
    flash.setDepth(RENDER_LAYERS.GAME_OBJECTS + 2);
    flash.setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 1.6,
      duration: 90,
      ease: "Quad.easeOut",
      onComplete: () => flash.destroy(),
    });
  }

  function ensureWallBody(id, entry) {
    let wall = wallBodies.get(id) || null;
    if (wall?.zone?.scene) return wall;
    const zone = scene.add.zone(
      Number(entry?.x) || 0,
      Number(entry?.y) || 0,
      Math.max(10, Number(entry?.width) || 120),
      Math.max(10, Number(entry?.height) || 46),
    );
    scene.physics.add.existing(zone, true);
    zone.setVisible(false);
    wall = { zone, colliders: [], builtByTeam: null };
    wallBodies.set(id, wall);
    return wall;
  }

  function rebuildWallColliders(wall, builtByTeam) {
    if (!wall?.zone) return;
    for (const collider of wall.colliders || []) {
      try {
        collider?.destroy?.();
      } catch (_) {}
    }
    wall.colliders = [];
    wall.builtByTeam = builtByTeam || null;
    if (builtByTeam !== "team1" && builtByTeam !== "team2") return;

    const addCollider = (sprite) => {
      if (!sprite?.body || !wall.zone?.body) return;
      try {
        wall.colliders.push(scene.physics.add.collider(sprite, wall.zone));
      } catch (_) {}
    };

    // Every player collides, the owning team included. Only shots from the
    // owning team pass through.
    for (const sprite of playerLookup.all()) addCollider(sprite);
  }

  function updateWallBody(id, entry, active, builtByTeam = null) {
    if (!active) {
      const existing = wallBodies.get(id);
      if (!existing) return;
      try {
        existing.zone?.destroy?.();
      } catch (_) {}
      for (const collider of existing.colliders || []) {
        try {
          collider?.destroy?.();
        } catch (_) {}
      }
      wallBodies.delete(id);
      return;
    }
    const wall = ensureWallBody(id, entry);
    if (!wall?.zone) return;
    wall.zone.setPosition(Number(entry?.x) || 0, Number(entry?.y) || 0);
    wall.zone.setSize(
      Math.max(10, Number(entry?.width) || 120),
      Math.max(10, Number(entry?.height) || 46),
    );
    wall.zone.body?.setSize?.(
      Math.max(10, Number(entry?.width) || 120),
      Math.max(10, Number(entry?.height) || 46),
      true,
    );
    wall.zone.body?.updateFromGameObject?.();
    rebuildWallColliders(wall, builtByTeam);
  }

  function renderObjects(modeState) {
    const layout = getLayout();
    const objectStateById = new Map(
      (Array.isArray(modeState?.objects) ? modeState.objects : []).map((entry) => [
        entry.id,
        entry,
      ]),
    );
    const usedObjectIds = new Set();
    for (const entry of Array.isArray(layout?.objects) ? layout.objects : []) {
      usedObjectIds.add(entry.id);
      const runtime = objectStateById.get(entry.id) || {
        state: {},
        type: entry.type,
      };
      const container = ensureObjectContainer(entry.id, entry.type);
      container.setVisible(true);
      container.x = Number(entry.x) || 0;
      container.y = Number(entry.y) || 0;
      const label = container._label;
      label.setPosition(0, 0);
      label._coinIcon?.setVisible(false);
      if (entry.type === "goldMine") {
        const owner = state.mineOwnerById.get(entry.id) || null;
        // One texture per owner rather than a tint over the whole sprite: a
        // multiply tint turns dark steel into washed blue, and the artwork
        // already marks the parts that belong to a team.
        const mineFrames = PROP_FRAMES.mine;
        const mineSprite = ensurePropSprite(
          mineSprites,
          entry.id,
          teamTexture("bank-bust-mine", owner),
          mineFrames,
          RENDER_LAYERS.GAME_OBJECTS,
        );
        if (mineSprite) {
          mineSprite.setVisible(true);
          mineSprite.setPosition(container.x, container.y);
          mineSprite.setScale(1);
          mineSprite.clearTint();
        }
        // The count is lit on the brass plate painted across the mine's frame.
        const stored = Math.max(0, Number(runtime?.state?.storedGold) || 0);
        const full = stored >= Math.max(1, Number(runtime?.state?.maxStoredGold) || Infinity);
        label.setText(formatCoins(stored));
        label.setFontFamily("'Press Start 2P', monospace");
        label.setFontSize(8);
        label.setFontStyle("normal");
        label.setStroke("#000000", 0);
        label.setColor(full ? "#fff3b0" : stored > 0 ? "#ffd264" : "#8a6a34");
        label.setAlign("center");
        label.setResolution(3);
        const mineIcon = ensureCoinIcon(label, container);
        mineIcon.setVisible(true);
        placeCoinLabel(
          label,
          mineIcon,
          (mineFrames.plateX - 0.5) * mineFrames.frameWidth,
          (mineFrames.plateY - 0.5) * mineFrames.frameHeight,
          9,
        );
      } else if (entry.type === "claimableTurret") {
        const ownerTeam = runtime?.state?.claimedByTeam || null;
        // Nothing written over it: the empty mount and the claimed gun look
        // different, and walking up to it brings up the buy prompt.
        label.setText("");
        const mountFrames = PROP_FRAMES["turret-mount"];
        const gunFrames = PROP_FRAMES["turret-gun"];
        const turretBase = ensurePropSprite(
          turretBaseSprites,
          entry.id,
          teamTexture("bank-bust-turret-mount", ownerTeam),
          mountFrames,
          RENDER_LAYERS.GAME_OBJECTS,
        );
        const turretHead = ensurePropSprite(
          turretHeadSprites,
          entry.id,
          teamTexture("bank-bust-turret-gun", ownerTeam),
          gunFrames,
          RENDER_LAYERS.GAME_OBJECTS + 1,
        );
        if (ownerTeam) {
          // Claimed turrets glow in their team's colour so owners read at a
          // glance: soft stacked halos, then a crisp outline on the mount.
          const glowTint =
            TEAM_PALETTE[colourTeam(ownerTeam)]?.strong ?? TEAM_PALETTE.neutral.strong;
          const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 280);
          const gx = container.x;
          const gy = container.y;
          for (let i = 4; i >= 1; i -= 1) {
            objectGraphics.fillStyle(glowTint, 0.07 * pulse * (5 - i));
            objectGraphics.fillRoundedRect(
              gx - mountFrames.frameWidth / 2 - i * 4,
              gy - mountFrames.frameHeight / 2 - i * 4,
              mountFrames.frameWidth + i * 8,
              mountFrames.frameHeight + i * 8,
              8 + i * 3,
            );
          }
          objectGraphics.lineStyle(3, glowTint, 0.95);
          objectGraphics.strokeRoundedRect(
            gx - mountFrames.frameWidth / 2,
            gy - mountFrames.frameHeight / 2,
            mountFrames.frameWidth,
            mountFrames.frameHeight,
            8,
          );
        }
        if (turretBase) {
          turretBase.setVisible(true);
          turretBase.setPosition(container.x, container.y);
          turretBase.setScale(1);
          turretBase.clearTint();
        }
        if (turretHead && turretBase) {
          turretHead.setVisible(true);
          turretHead.setOrigin(gunFrames.hubX, gunFrames.hubY);
          turretHead.setScale(1);
          turretHead.clearTint();
          animateTurret(entry.id, turretHead, turretBase, entry, runtime, ownerTeam, {
            x: container.x + (mountFrames.socketX - 0.5) * mountFrames.frameWidth,
            y: container.y + (mountFrames.socketY - 0.5) * mountFrames.frameHeight,
          });
        }
      } else if (entry.type === "wallSlot") {
        const builtByTeam = runtime?.state?.builtByTeam || null;
        const { width: wallWidth, height: wallHeight } = resolvePurchaseSettings(
          entry.type,
          entry,
          runtime?.state,
        );
        const tall = wallHeight > 96;
        const wallKey = builtByTeam
          ? teamTexture(tall ? "bank-bust-wall-tall" : "bank-bust-wall-built", builtByTeam)
          : tall
            ? "bank-bust-wall-tall-slot"
            : "bank-bust-wall-slot";
        const wallSprite = ensureObjectSprite(
          wallSprites,
          entry.id,
          wallKey,
          RENDER_LAYERS.GAME_OBJECTS,
        );
        if (wallSprite) {
          wallSprite.setVisible(true);
          wallSprite.setTexture(wallKey);
          wallSprite.setPosition(container.x, container.y);
          wallSprite.setScale(1);
          wallSprite.clearTint();
        }
        label.setText("");
        if (builtByTeam === "team1" || builtByTeam === "team2") {
          objectGraphics.lineStyle(
            3,
            (TEAM_PALETTE[colourTeam(builtByTeam)] || TEAM_PALETTE.neutral).line,
            0.9,
          );
          objectGraphics.strokeRoundedRect(
            container.x - wallWidth / 2,
            container.y - wallHeight / 2,
            wallWidth,
            wallHeight,
            4,
          );
        }
        updateWallBody(entry.id, entry, !!builtByTeam, builtByTeam);
      } else {
        label.setText("");
      }
    }
    cleanupUnused(objectContainers, usedObjectIds);
    cleanupUnused(mineSprites, usedObjectIds);
    cleanupUnused(wallSprites, usedObjectIds);
    cleanupUnused(turretBaseSprites, usedObjectIds);
    cleanupUnused(turretHeadSprites, usedObjectIds);

    hideUnusedWallBodies(modeState);
    publishShotBlockers(modeState);
  }

  // Built walls stop every shot from the other team, as on the server, so shot
  // visuals end where the server's projectile does.
  function publishShotBlockers(modeState) {
    const localTeam = getLocalTeam();
    const blockers = [];
    for (const entry of Array.isArray(modeState?.objects) ? modeState.objects : []) {
      const team = entry?.type === "wallSlot" ? entry.state?.builtByTeam : null;
      if (team !== "team1" && team !== "team2") continue;
      const halfW = (Number(entry.state.width) || 48) / 2;
      const halfH = (Number(entry.state.height) || 96) / 2;
      blockers.push({
        friendly: !!localTeam && team === localTeam,
        left: entry.x - halfW,
        right: entry.x + halfW,
        top: entry.y - halfH,
        bottom: entry.y + halfH,
      });
    }
    setShotBlockers("bankBust", blockers);
  }

  function hideUnusedWallBodies(modeState) {
    const activeWallIds = new Set(
      (Array.isArray(modeState?.objects) ? modeState.objects : [])
        .filter((entry) => entry?.type === "wallSlot" && entry?.state?.builtByTeam)
        .map((entry) => entry.id),
    );
    for (const id of Array.from(wallBodies.keys())) {
      if (activeWallIds.has(id)) continue;
      updateWallBody(id, null, false);
    }
  }

  return { ensureObjectSprite, turretMotion, updateWallBody, renderObjects, hideUnusedWallBodies };
}
