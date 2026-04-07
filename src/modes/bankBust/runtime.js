import { getMapObjectiveLayout } from "../../lib/gameSelectionCatalog";

function cloneJson(v) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch (_) {
    return null;
  }
}

function ensureHostHtml() {
  const host = document.createElement("div");
  host.id = "bank-bust-edit-host";
  host.innerHTML = `
    <style>
      #bank-bust-edit-host{position:fixed;left:14px;bottom:14px;z-index:100001;font-family:system-ui,sans-serif}
      #bank-bust-interact-prompt{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);display:none;z-index:100000;background:rgba(15,23,42,.92);border:1px solid rgba(248,250,252,.2);border-radius:999px;padding:10px 16px;color:#f8fafc;font:600 13px/1.2 Lato,sans-serif;box-shadow:0 12px 28px rgba(0,0,0,.32)}
      #bank-bust-interact-prompt.open{display:block}
      #bank-bust-edit-panel{display:none;width:min(360px,92vw);background:rgba(9,16,28,.94);border:1px solid rgba(99,102,241,.45);border-radius:12px;padding:10px;color:#dbeafe;box-shadow:0 12px 28px rgba(0,0,0,.34)}
      #bank-bust-edit-panel.open{display:block}
      #bank-bust-edit-panel.min{display:none}
      #bank-bust-edit-panel h4{margin:0 0 8px 0;font-size:13px}
      #bank-bust-edit-panel .tiny{font-size:11px;opacity:.8;line-height:1.35;margin:6px 0}
      #bank-bust-edit-panel textarea{width:100%;min-height:130px;box-sizing:border-box;background:#0f172a;border:1px solid rgba(148,163,184,.28);border-radius:8px;color:#e2e8f0;padding:8px;font:11px Consolas,monospace}
      #bank-bust-edit-panel .btns{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
      #bank-bust-edit-panel button{background:#1e293b;border:1px solid rgba(96,165,250,.35);color:#e0f2fe;border-radius:8px;padding:6px 10px;cursor:pointer}
    </style>
    <div id="bank-bust-interact-prompt"></div>
    <div id="bank-bust-edit-panel">
      <h4>Bank Bust Objects</h4>
      <div class="btns">
        <button id="bank-bust-export-layout" type="button">Export Layout</button>
      </div>
      <textarea id="bank-bust-export-json" placeholder="Exported Bank Bust layout appears here"></textarea>
      <p class="tiny">While map edit mode is on, drag Bank Bust vaults, mines, slots, and gold spawn markers. Export this JSON and reuse it in the shared map layout.</p>
    </div>
  `;
  document.body.appendChild(host);
  return {
    host,
    prompt: host.querySelector("#bank-bust-interact-prompt"),
    panel: host.querySelector("#bank-bust-edit-panel"),
    exportBtn: host.querySelector("#bank-bust-export-layout"),
    textarea: host.querySelector("#bank-bust-export-json"),
  };
}

export function createBankBustRuntime({
  scene,
  Phaser,
  getGameData,
  getModeState,
  getLocalPlayer,
  getOpponentPlayers,
  getTeamPlayers,
  canEdit = false,
} = {}) {
  const state = {
    damageEventAt: 0,
    editMode: false,
    localLayout: null,
    draggable: new Map(),
    mapEditorMinimized: false,
    lastCollectionEventAt: 0,
    previousObjectStates: new Map(),
    mineOwnerById: new Map(),
    recentProjectileIds: new Set(),
  };
  const objectiveGraphics = scene.add.graphics();
  objectiveGraphics.setDepth(8);
  const uiGraphics = scene.add.graphics();
  uiGraphics.setDepth(22);
  const objectGraphics = scene.add.graphics();
  objectGraphics.setDepth(7);
  const markerGraphics = scene.add.graphics();
  markerGraphics.setDepth(23);

  const vaultSprites = new Map();
  const floatingCoins = [];
  const objectContainers = new Map();
  const pickupSprites = new Map();
  const spawnPointMarkers = new Map();
  const wallBodies = new Map();
  const turretBaseSprites = new Map();
  const turretHeadSprites = new Map();
  const mineSprites = new Map();
  const wallSprites = new Map();
  const turretProjectileSprites = new Map();

  const editorUi = ensureHostHtml();

  function getBaseLayout() {
    return getMapObjectiveLayout(getGameData?.()?.map, "bankBust") || null;
  }

  function getWorkingLayout() {
    if (!state.localLayout) {
      state.localLayout = cloneJson(getBaseLayout()) || {
        vaults: {},
        objects: [],
        randomGoldSpawnPoints: [],
      };
    }
    return state.localLayout;
  }

  function syncLayoutFromModeState(modeState) {
    const working = getWorkingLayout();
    if (modeState?.vaults) {
      working.vaults = working.vaults || {};
      for (const [team, vault] of Object.entries(modeState.vaults || {})) {
        const existing = working.vaults[team] || {};
        working.vaults[team] = {
          ...existing,
          width: Number(vault?.width) || existing.width || 150,
          height: Number(vault?.height) || existing.height || 180,
          radius: Number(vault?.radius) || existing.radius || 90,
          label: vault?.label || existing.label || null,
          x: Number.isFinite(Number(existing?.x))
            ? Number(existing.x)
            : Number(vault?.x) || 0,
          y: Number.isFinite(Number(existing?.y))
            ? Number(existing.y)
            : Number(vault?.y) || 0,
        };
      }
    }
    if (Array.isArray(modeState?.objects) && modeState.objects.length) {
      const byId = new Map(
        (working.objects || []).map((entry) => [entry.id, entry]),
      );
      for (const obj of modeState.objects) {
        const current = byId.get(obj.id) || {};
        byId.set(obj.id, {
          ...current,
          ...cloneJson(obj?.config || {}),
          id: obj.id,
          type: obj.type,
          x: Number.isFinite(Number(current?.x))
            ? Number(current.x)
            : Number(obj?.x) || 0,
          y: Number.isFinite(Number(current?.y))
            ? Number(current.y)
            : Number(obj?.y) || 0,
        });
      }
      working.objects = Array.from(byId.values());
    }
    if (
      Array.isArray(modeState?.randomGoldSpawnPoints) &&
      modeState.randomGoldSpawnPoints.length
    ) {
      const byId = new Map(
        (working.randomGoldSpawnPoints || []).map((entry) => [entry.id, entry]),
      );
      working.randomGoldSpawnPoints = modeState.randomGoldSpawnPoints.map(
        (entry) => {
          const existing = byId.get(entry.id) || {};
          return {
            id: entry.id,
            x: Number.isFinite(Number(existing?.x))
              ? Number(existing.x)
              : Number(entry.x) || 0,
            y: Number.isFinite(Number(existing?.y))
              ? Number(existing.y)
              : Number(entry.y) || 0,
          };
        },
      );
    }
  }

  function setEditorVisible(visible) {
    if (!editorUi) return;
    editorUi.panel.classList.toggle(
      "open",
      !!visible && !state.mapEditorMinimized,
    );
    editorUi.panel.classList.toggle("min", !!state.mapEditorMinimized);
  }

  function onMapEditorUiState(ev) {
    const enabled = ev?.detail?.enabled !== false;
    state.mapEditorMinimized = !!ev?.detail?.minimized;
    if (!enabled) state.mapEditorMinimized = false;
    setEditorVisible(canEdit && state.editMode);
  }

  function setEditMode(enabled) {
    state.editMode = !!enabled;
    setEditorVisible(canEdit && state.editMode);
  }

  function setPrompt(text = "") {
    if (!editorUi?.prompt) return;
    const value = String(text || "").trim();
    editorUi.prompt.textContent = value;
    editorUi.prompt.classList.toggle("open", !!value);
  }

  function currentLocalPlayer() {
    return getLocalPlayer?.() || null;
  }

  function getAllRenderablePlayers() {
    const items = [];
    const local = currentLocalPlayer();
    if (local) items.push(local);
    for (const wrap of Object.values(getOpponentPlayers?.() || {})) {
      if (wrap?.opponent) items.push(wrap.opponent);
    }
    for (const wrap of Object.values(getTeamPlayers?.() || {})) {
      if (wrap?.opponent) items.push(wrap.opponent);
    }
    return items;
  }

  function getLocalTeam() {
    return getGameData?.()?.yourTeam || currentLocalPlayer()?.team || null;
  }

  function getModeObjectState(modeState, id) {
    return (Array.isArray(modeState?.objects) ? modeState.objects : []).find(
      (entry) => entry?.id === id,
    );
  }

  function computeInteractPrompt(modeState) {
    if (state.editMode) return "";
    const localPlayer = currentLocalPlayer();
    if (!localPlayer || localPlayer.dead || !localPlayer.body) return "";
    const team = getLocalTeam();
    if (!team) return "";
    const teamGold = Math.max(0, Number(modeState?.teamGold?.[team]) || 0);
    let best = null;
    for (const entry of Array.isArray(getWorkingLayout()?.objects)
      ? getWorkingLayout().objects
      : []) {
      if (entry?.type !== "claimableTurret" && entry?.type !== "wallSlot")
        continue;
      const dx = (Number(entry?.x) || 0) - localPlayer.x;
      const dy = (Number(entry?.y) || 0) - localPlayer.y;
      const distance = Math.hypot(dx, dy);
      const interactionRadius = Math.max(
        24,
        Number(entry?.interactionRadius) || 74,
      );
      if (distance > interactionRadius) continue;
      if (!best || distance < best.distance) best = { entry, distance };
    }
    if (!best?.entry) return "";
    const runtimeObject = getModeObjectState(modeState, best.entry.id) || {
      state: {},
      type: best.entry.type,
    };
    if (best.entry.type === "claimableTurret") {
      const claimedByTeam = runtimeObject?.state?.claimedByTeam || null;
      const cost = Math.max(0, Number(best.entry?.claimCost) || 0);
      if (claimedByTeam === team) return "Turret Active";
      if (teamGold >= cost) return `Press E to claim turret (${cost} gold)`;
      return `Need ${cost} gold for turret`;
    }
    const builtByTeam = runtimeObject?.state?.builtByTeam || null;
    const cost = Math.max(0, Number(best.entry?.cost) || 0);
    if (builtByTeam === team) return "Wall Built";
    if (teamGold >= cost) return `Press E to build wall (${cost} gold)`;
    return `Need ${cost} gold for wall`;
  }

  function getLayoutVault(team, vault) {
    const layoutVault = getWorkingLayout()?.vaults?.[team] || {};
    return {
      ...layoutVault,
      ...cloneJson(vault || {}),
      x: Number(layoutVault?.x) || Number(vault?.x) || 0,
      y: Number(layoutVault?.y) || Number(vault?.y) || 0,
      width: Number(layoutVault?.width) || Number(vault?.width) || 150,
      height: Number(layoutVault?.height) || Number(vault?.height) || 180,
    };
  }

  function ensureDraggable(go, meta) {
    if (!go || !canEdit) return;
    if (!go.input) {
      go.setInteractive({ cursor: "grab" });
    }
    scene.input.setDraggable(go);
    go.__bankBustMeta = meta;
    state.draggable.set(go, meta);
  }

  function ensureVaultSprite(team) {
    let sprite = vaultSprites.get(team) || null;
    if (sprite?.scene) return sprite;
    if (!scene.textures?.exists?.("bank-bust-vault")) return null;
    sprite = scene.add.image(-9999, -9999, "bank-bust-vault");
    sprite.setDepth(9);
    sprite.setVisible(false);
    ensureDraggable(sprite, { kind: "vault", id: team });
    vaultSprites.set(team, sprite);
    return sprite;
  }

  function destroyContainer(entry) {
    try {
      entry?.destroy?.();
    } catch (_) {}
  }

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
    container.setDepth(10);
    container.setVisible(false);
    container._bg = bg;
    container._label = label;
    ensureDraggable(container, { kind: "object", id });
    objectContainers.set(id, container);
    return container;
  }

  function ensureObjectSprite(map, id, textureKey, depth = 10) {
    let sprite = map.get(id) || null;
    if (sprite?.scene) return sprite;
    if (!scene.textures?.exists?.(textureKey)) return null;
    sprite = scene.add.image(-9999, -9999, textureKey);
    sprite.setDepth(depth);
    sprite.setVisible(false);
    map.set(id, sprite);
    return sprite;
  }

  function ensureSpawnPointMarker(id) {
    let marker = spawnPointMarkers.get(id) || null;
    if (marker?.scene) return marker;
    marker = scene.add.circle(-9999, -9999, 12, 0xf8e16c, 0.65);
    marker.setStrokeStyle(3, 0x1e293b, 0.95);
    marker.setDepth(24);
    marker.setVisible(false);
    ensureDraggable(marker, { kind: "randomGoldSpawnPoint", id });
    spawnPointMarkers.set(id, marker);
    return marker;
  }

  function ensureTurretSprite(map, id, textureKey, depth = 11) {
    let sprite = map.get(id) || null;
    if (sprite?.scene) return sprite;
    if (!scene.textures?.exists?.(textureKey)) return null;
    sprite = scene.add.image(-9999, -9999, textureKey);
    sprite.setDepth(depth);
    sprite.setVisible(false);
    map.set(id, sprite);
    return sprite;
  }

  function safePlaySfx(key, config = {}) {
    try {
      if (!scene.cache?.audio?.exists?.(key)) return;
      scene.sound?.play?.(key, config);
    } catch (_) {}
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
    wall = { zone, colliders: [] };
    wallBodies.set(id, wall);
    const attachCollider = (sprite) => {
      if (!sprite?.body || !zone?.body) return;
      try {
        wall.colliders.push(scene.physics.add.collider(sprite, zone));
      } catch (_) {}
    };
    for (const sprite of getAllRenderablePlayers()) attachCollider(sprite);
    return wall;
  }

  function updateWallBody(id, entry, active) {
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
  }

  function cleanupUnused(map, usedIds) {
    for (const [id, entry] of map.entries()) {
      if (usedIds.has(id)) continue;
      if (typeof entry?.setVisible === "function") entry.setVisible(false);
    }
  }

  function spawnVaultCoins(team, vault, damage) {
    const count = Math.min(24, Math.max(1, Math.round(Number(damage) || 1)));
    const topY =
      Number(vault.y) - Math.max(40, Number(vault.height) || 180) / 2 - 10;
    const originX = Number(vault.x);
    for (let i = 0; i < count; i++) {
      const coin = scene.add.image(originX, topY, "deathdrop-coin");
      coin.setDepth(24);
      coin.setScale(0.18 + Math.random() * 0.08);
      coin.setTint(team === "team1" ? 0x93c5fd : 0xfde68a);
      scene.tweens.add({
        targets: coin,
        x: originX + Phaser.Math.Between(-46, 46),
        y: topY - Phaser.Math.Between(44, 86),
        alpha: 0,
        angle: Phaser.Math.Between(-40, 40),
        duration: Phaser.Math.Between(520, 820),
        delay: Math.min(320, i * 18),
        ease: "Cubic.easeOut",
        onComplete: () => {
          const idx = floatingCoins.indexOf(coin);
          if (idx >= 0) floatingCoins.splice(idx, 1);
          coin.destroy();
        },
      });
      floatingCoins.push(coin);
    }
    try {
      scene.sound?.play?.("sfx-coin-pickup", { volume: 0.08 });
    } catch (_) {}
  }

  function renderVaults(modeState) {
    const usedVaults = new Set();
    for (const [team, vaultRaw] of Object.entries(modeState?.vaults || {})) {
      usedVaults.add(team);
      const vault = getLayoutVault(team, vaultRaw);
      const health = Math.max(0, Number(vaultRaw?.health) || 0);
      const maxHealth = Math.max(1, Number(vaultRaw?.maxHealth) || 1);
      const width = Math.max(60, Number(vault.width) || 150);
      const height = Math.max(60, Number(vault.height) || 180);
      const x = Number(vault.x) || 0;
      const y = Number(vault.y) || 0;

      const event = modeState?.lastVaultDamageEvent;
      const eventAt = Number(event?.at) || 0;
      const shakeAge =
        event?.targetTeam === team ? scene.time.now - eventAt : Infinity;
      const shaking =
        Number.isFinite(shakeAge) && shakeAge >= 0 && shakeAge <= 220;
      const shakeStrength = shaking ? 1 - shakeAge / 220 : 0;
      const pulse = shaking ? Math.sin(shakeAge / 24) * 3 * shakeStrength : 0;
      const drawWidth = width * (shaking ? 1 + Math.abs(pulse) * 0.002 : 1);
      const drawHeight = height * (shaking ? 1 - Math.abs(pulse) * 0.0015 : 1);
      const drawX = x + (shaking ? pulse * 0.4 : 0);
      const drawY =
        y + (shaking ? Math.cos(shakeAge / 26) * 1.5 * shakeStrength : 0);

      const sprite = ensureVaultSprite(team);
      if (sprite) {
        sprite.setPosition(drawX, drawY);
        sprite.setDisplaySize(drawWidth, drawHeight);
        sprite.setVisible(true);
        sprite.setTint(health <= 0 ? 0x6b7280 : 0xffffff);
        sprite.setAlpha(health <= 0 ? 0.48 : 1);
      }

      const left = drawX - drawWidth / 2;
      const top = drawY - drawHeight / 2;
      const frameColor = team === "team1" ? 0xbfdbfe : 0xfecaca;
      objectiveGraphics.lineStyle(4, frameColor, 0.95);
      //objectiveGraphics.strokeRoundedRect(left, top, drawWidth, drawHeight, 20);
      if (shaking) {
        objectiveGraphics.fillStyle(0xffffff, 0.08);
        objectiveGraphics.fillCircle(
          drawX - drawWidth * 0.15,
          drawY - drawHeight * 0.16,
          18,
        );
      }

      const healthRatio = Phaser.Math.Clamp(health / maxHealth, 0, 1);
      const barWidth = width;
      const barHeight = 14;
      const barX = drawX - barWidth / 2;
      const barY = top - 24;
      uiGraphics.fillStyle(0x111827, 0.82);
      uiGraphics.fillRoundedRect(barX, barY, barWidth, barHeight, 5);
      uiGraphics.lineStyle(2, 0x0b1220, 0.95);
      uiGraphics.strokeRoundedRect(barX, barY, barWidth, barHeight, 5);
      uiGraphics.fillStyle(team === "team1" ? 0x60a5fa : 0xf87171, 1);
      uiGraphics.fillRoundedRect(
        barX + 2,
        barY + 2,
        Math.max(0, (barWidth - 4) * healthRatio),
        barHeight - 4,
        4,
      );
    }
    cleanupUnused(vaultSprites, usedVaults);
  }

  function renderObjects(modeState) {
    const layout = getWorkingLayout();
    const objectStateById = new Map(
      (Array.isArray(modeState?.objects) ? modeState.objects : []).map(
        (entry) => [entry.id, entry],
      ),
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
      // For turrets, position label above the visual; otherwise at object center
      container.y =
        entry.type === "claimableTurret"
          ? (Number(entry.y) || 0) - 90
          : Number(entry.y) || 0;
      const label = container._label;
      if (entry.type === "goldMine") {
        const owner = state.mineOwnerById.get(entry.id) || null;
        const mineSprite = ensureObjectSprite(
          mineSprites,
          entry.id,
          owner ? "bank-bust-mine-claimed" : "bank-bust-mine-neutral",
          10,
        );
        if (mineSprite) {
          mineSprite.setVisible(true);
          mineSprite.setPosition(container.x, container.y);
          mineSprite.setScale(0.4);
          mineSprite.clearTint();
          if (owner === "team1") mineSprite.setTint(0xa5d8ff);
          if (owner === "team2") mineSprite.setTint(0xffb4b4);
        }
        // Draw claimed mine circle
        if (owner === "team1" || owner === "team2") {
          objectGraphics.lineStyle(
            3,
            owner === "team1" ? 0x60a5fa : 0xf87171,
            0.95,
          );
          objectGraphics.strokeCircle(container.x, container.y, 74);
        } else {
          // Draw unclaimed mine glow
          objectGraphics.lineStyle(2, 0xfbbf24, 0.6);
          objectGraphics.strokeCircle(container.x, container.y, 74);
        }
        label.setText(
          `Mine\n${Math.max(0, Number(runtime?.state?.storedGold) || 0)}g`,
        );
        label.setFontSize(13);
        label.setAlign("center");
      } else if (entry.type === "claimableTurret") {
        const ownerTeam = runtime?.state?.claimedByTeam || null;
        label.setText(ownerTeam ? "Turret" : "Turret Slot");
        const turretBase = ensureTurretSprite(
          turretBaseSprites,
          entry.id,
          "bank-bust-turret-base",
          11,
        );
        const turretHead = ensureTurretSprite(
          turretHeadSprites,
          entry.id,
          "bank-bust-turret-head",
          12,
        );
        if (turretBase) {
          turretBase.setVisible(true);
          turretBase.setPosition(container.x, container.y - 60);
          turretBase.setDisplaySize(64, 64);
          turretBase.setTint(
            ownerTeam === "team1"
              ? 0xbcdcff
              : ownerTeam === "team2"
                ? 0xffc2c2
                : 0xffffff,
          );
        }
        if (turretHead) {
          turretHead.setVisible(true);
          turretHead.setPosition(container.x, container.y - 80);
          turretHead.setScale(0.13);
          const aim = Number(runtime?.state?.aimAngle);
          turretHead.rotation = Number.isFinite(aim)
            ? aim + Math.PI
            : ownerTeam === "team2"
              ? 0
              : Math.PI;
          turretHead.setFlipY(Number.isFinite(aim) ? Math.sin(aim) < 0 : false);
          turretHead.setTint(
            ownerTeam === "team1"
              ? 0xbcdcff
              : ownerTeam === "team2"
                ? 0xffc2c2
                : 0xffffff,
          );
        }
        if (ownerTeam === "team1" || ownerTeam === "team2") {
          objectGraphics.lineStyle(
            3,
            ownerTeam === "team1" ? 0x60a5fa : 0xf87171,
            0.9,
          );
          objectGraphics.strokeCircle(container.x, container.y + 10, 46);
        }
      } else if (entry.type === "wallSlot") {
        const builtByTeam = runtime?.state?.builtByTeam || null;
        const wallWidth = Math.max(80, Number(entry.width) || 120);
        const wallHeight = Math.max(34, Number(entry.height) || 46);
        const wallSprite = ensureObjectSprite(
          wallSprites,
          entry.id,
          builtByTeam ? "bank-bust-wall-built" : "bank-bust-wall-slot",
          10,
        );
        if (wallSprite) {
          wallSprite.setVisible(true);
          wallSprite.setPosition(container.x, container.y);
          wallSprite.setDisplaySize(wallWidth, wallHeight);
          wallSprite.clearTint();
          if (builtByTeam === "team1") wallSprite.setTint(0xa5d8ff);
          if (builtByTeam === "team2") wallSprite.setTint(0xffb4b4);
        }
        label.setText(builtByTeam ? "Built Wall" : "Wall Slot");
        if (builtByTeam === "team1" || builtByTeam === "team2") {
          objectGraphics.lineStyle(
            3,
            builtByTeam === "team1" ? 0x60a5fa : 0xf87171,
            0.9,
          );
          objectGraphics.strokeRoundedRect(
            container.x - wallWidth / 2,
            container.y - wallHeight / 2,
            wallWidth,
            wallHeight,
            8,
          );
        }
        updateWallBody(entry.id, entry, !!builtByTeam);
      } else {
        label.setText(entry.type || "Object");
      }
    }
    cleanupUnused(objectContainers, usedObjectIds);
    cleanupUnused(mineSprites, usedObjectIds);
    cleanupUnused(wallSprites, usedObjectIds);
    cleanupUnused(turretBaseSprites, usedObjectIds);
    cleanupUnused(turretHeadSprites, usedObjectIds);

    const usedSpawnPoints = new Set();
    for (const entry of Array.isArray(layout?.randomGoldSpawnPoints)
      ? layout.randomGoldSpawnPoints
      : []) {
      usedSpawnPoints.add(entry.id);
      const marker = ensureSpawnPointMarker(entry.id);
      marker.setPosition(Number(entry.x) || 0, Number(entry.y) || 0);
      marker.setVisible(!!state.editMode);
    }
    cleanupUnused(spawnPointMarkers, usedSpawnPoints);
    hideUnusedWallBodies(modeState);
  }

  function hideUnusedWallBodies(modeState) {
    const activeWallIds = new Set(
      (Array.isArray(modeState?.objects) ? modeState.objects : [])
        .filter(
          (entry) => entry?.type === "wallSlot" && entry?.state?.builtByTeam,
        )
        .map((entry) => entry.id),
    );
    for (const id of Array.from(wallBodies.keys())) {
      if (activeWallIds.has(id)) continue;
      updateWallBody(id, null, false);
    }
  }

  function renderPickups(modeState) {
    const used = new Set();
    for (const pickup of Array.isArray(modeState?.randomGoldPickups)
      ? modeState.randomGoldPickups
      : []) {
      used.add(pickup.id);
      let sprite = pickupSprites.get(pickup.id) || null;
      if (!sprite?.scene) {
        sprite = scene.add.image(pickup.x, pickup.y, "deathdrop-coin");
        sprite.setScale(0.18);
        sprite.setDepth(13);
        pickupSprites.set(pickup.id, sprite);
      }
      sprite.setVisible(true);
      sprite.setPosition(Number(pickup.x) || 0, Number(pickup.y) || 0);
      sprite.angle = (scene.time.now / 12) % 360;
    }
    for (const [id, sprite] of pickupSprites.entries()) {
      if (used.has(id)) continue;
      sprite.destroy();
      pickupSprites.delete(id);
    }
  }

  function renderTurretProjectiles(modeState) {
    const activeIds = new Set();
    for (const shot of Array.isArray(modeState?.turretProjectiles)
      ? modeState.turretProjectiles
      : []) {
      activeIds.add(shot.id);
      const sprite = ensureObjectSprite(
        turretProjectileSprites,
        shot.id,
        "bank-bust-bullet",
        14,
      );
      if (!sprite) continue;
      const ownerTeam = shot?.ownerTeam || null;
      sprite.setVisible(true);
      sprite.setPosition(Number(shot?.x) || 0, Number(shot?.y) || 0);
      sprite.setDisplaySize(22, 14);
      sprite.setRotation(Number(shot?.angle) || 0);
      sprite.clearTint();
      if (ownerTeam === "team1") sprite.setTint(0x93c5fd);
      if (ownerTeam === "team2") sprite.setTint(0xfca5a5);
    }
    for (const [id, sprite] of turretProjectileSprites.entries()) {
      if (activeIds.has(id)) continue;
      sprite.destroy();
      turretProjectileSprites.delete(id);
    }
  }

  function processModeEvents(modeState) {
    for (const event of Array.isArray(modeState?.collectionEvents)
      ? modeState.collectionEvents
      : []) {
      const at = Number(event?.at) || 0;
      if (!at || at <= state.lastCollectionEventAt) continue;
      if (event?.type === "goldMine") {
        safePlaySfx("sfx-bankbust-mine-collect", { volume: 0.15 });
        if (
          event?.source &&
          (event?.team === "team1" || event?.team === "team2")
        ) {
          const previousOwner = state.mineOwnerById.get(event.source) || null;
          if (previousOwner !== event.team) {
            safePlaySfx("sfx-bankbust-mine-claim", { volume: 0.22 });
          }
          state.mineOwnerById.set(event.source, event.team);
        }
      }
      if (event?.type === "randomGold") {
        safePlaySfx("sfx-coin-pickup", { volume: 0.1 });
      }
      state.lastCollectionEventAt = Math.max(state.lastCollectionEventAt, at);
    }

    const nextStates = new Map();
    for (const entry of Array.isArray(modeState?.objects)
      ? modeState.objects
      : []) {
      const prev = state.previousObjectStates.get(entry.id) || {};
      const cur = entry?.state || {};
      if (
        entry?.type === "claimableTurret" &&
        !prev?.claimedByTeam &&
        cur?.claimedByTeam
      ) {
        safePlaySfx("sfx-bankbust-turret-claim", { volume: 0.35 });
      }
      if (
        entry?.type === "wallSlot" &&
        !prev?.builtByTeam &&
        cur?.builtByTeam
      ) {
        safePlaySfx("sfx-bankbust-wall-claim", { volume: 0.35 });
      }
      nextStates.set(entry.id, cloneJson(cur) || {});
    }
    state.previousObjectStates = nextStates;

    const nextProjectileIds = new Set(
      (Array.isArray(modeState?.turretProjectiles)
        ? modeState.turretProjectiles
        : []
      ).map((entry) => entry.id),
    );
    for (const id of nextProjectileIds) {
      if (state.recentProjectileIds.has(id)) continue;
      safePlaySfx("sfx-bankbust-turret-shoot", { volume: 0.16 });
    }
    state.recentProjectileIds = nextProjectileIds;
  }

  function buildExportPayload() {
    const layout = getWorkingLayout();
    return {
      schema: "bank-bust-layout.v1",
      vaults: cloneJson(layout?.vaults || {}),
      objects: cloneJson(layout?.objects || []),
      randomGoldSpawnPoints: cloneJson(layout?.randomGoldSpawnPoints || []),
    };
  }

  function exportLayout() {
    if (!editorUi) return;
    const payload = JSON.stringify(buildExportPayload(), null, 2);
    editorUi.textarea.value = payload;
    navigator?.clipboard?.writeText?.(payload).catch(() => {});
  }

  if (canEdit && editorUi?.exportBtn) {
    editorUi.exportBtn.addEventListener("click", exportLayout);
  }

  const dragHandler = (_pointer, go, dragX, dragY) => {
    if (!state.editMode || !canEdit) return;
    const meta = go?.__bankBustMeta;
    if (!meta) return;
    const layout = getWorkingLayout();
    if (meta.kind === "vault") {
      const vault = layout?.vaults?.[meta.id];
      if (!vault) return;
      vault.x = dragX;
      vault.y = dragY;
    } else if (meta.kind === "object") {
      const target = (layout?.objects || []).find(
        (entry) => entry.id === meta.id,
      );
      if (!target) return;
      target.x = dragX;
      target.y = dragY;
    } else if (meta.kind === "randomGoldSpawnPoint") {
      const target = (layout?.randomGoldSpawnPoints || []).find(
        (entry) => entry.id === meta.id,
      );
      if (!target) return;
      target.x = dragX;
      target.y = dragY;
    }
  };
  scene.input.on("drag", dragHandler);
  window.addEventListener("bb:map-editor-ui-state", onMapEditorUiState);

  function render() {
    objectiveGraphics.clear();
    uiGraphics.clear();
    objectGraphics.clear();
    markerGraphics.clear();

    const modeState = getModeState?.() || null;
    if (modeState?.type !== "bank-bust") {
      setEditorVisible(false);
      setPrompt("");
      cleanupUnused(vaultSprites, new Set());
      cleanupUnused(objectContainers, new Set());
      cleanupUnused(mineSprites, new Set());
      cleanupUnused(wallSprites, new Set());
      cleanupUnused(turretBaseSprites, new Set());
      cleanupUnused(turretHeadSprites, new Set());
      cleanupUnused(spawnPointMarkers, new Set());
      for (const sprite of pickupSprites.values()) sprite.setVisible(false);
      for (const sprite of turretProjectileSprites.values())
        sprite.setVisible(false);
      hideUnusedWallBodies(null);
      return;
    }

    syncLayoutFromModeState(modeState);
    processModeEvents(modeState);

    const event = modeState?.lastVaultDamageEvent;
    const eventAt = Number(event?.at) || 0;
    if (eventAt && eventAt > state.damageEventAt) {
      state.damageEventAt = eventAt;
      const targetVault = modeState?.vaults?.[event?.targetTeam] || null;
      if (targetVault) {
        spawnVaultCoins(event.targetTeam, targetVault, event.damage);
      }
    }

    renderObjects(modeState);
    renderPickups(modeState);
    renderTurretProjectiles(modeState);
    renderVaults(modeState);
    setPrompt(computeInteractPrompt(modeState));
    setEditorVisible(canEdit && state.editMode);
  }

  function destroy() {
    try {
      scene.input.off("drag", dragHandler);
    } catch (_) {}
    try {
      window.removeEventListener("bb:map-editor-ui-state", onMapEditorUiState);
    } catch (_) {}
    try {
      objectiveGraphics.destroy();
      uiGraphics.destroy();
      objectGraphics.destroy();
      markerGraphics.destroy();
    } catch (_) {}
    for (const sprite of vaultSprites.values()) destroyContainer(sprite);
    for (const sprite of pickupSprites.values()) destroyContainer(sprite);
    for (const sprite of spawnPointMarkers.values()) destroyContainer(sprite);
    for (const entry of objectContainers.values()) destroyContainer(entry);
    for (const sprite of turretBaseSprites.values()) destroyContainer(sprite);
    for (const sprite of turretHeadSprites.values()) destroyContainer(sprite);
    for (const sprite of mineSprites.values()) destroyContainer(sprite);
    for (const sprite of wallSprites.values()) destroyContainer(sprite);
    for (const sprite of turretProjectileSprites.values())
      destroyContainer(sprite);
    for (const coin of floatingCoins) destroyContainer(coin);
    for (const id of Array.from(wallBodies.keys())) {
      updateWallBody(id, null, false);
    }
    try {
      editorUi?.host?.remove?.();
    } catch (_) {}
  }

  return {
    render,
    destroy,
    setEditMode,
    exportLayout,
  };
}
