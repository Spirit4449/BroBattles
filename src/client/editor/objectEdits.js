import { clone, validateMap } from "../../shared/maps/mapDocument";
import { RANDOM_CLOUD } from "../../shared/maps/scenery";
import { allRows, snapMove, removeRows } from "./editorModel";
import { $, editor, map, uid } from "./studioState";
import { transaction } from "./mapSession";
import { select } from "./inspector";
import { mapPoint } from "./canvasInteraction";

function addObject(kind = $("add-kind").value, textureKey = null) {
  if (editor.busy) return;
  textureKey ||= Object.keys(map().assets).sort((a, b) => {
    const x = map().textureSizes[a],
      y = map().textureSizes[b];
    return y.width / y.height - x.width / x.height;
  })[0];
  if (!editor.scene) return;
  const center = editor.scene.cameras.main.midPoint;
  let newId;
  transaction(() => {
    const p = {
      id: uid(kind),
      x: Math.round(center.x / 16) * 16,
      y: Math.round(center.y / 16) * 16,
    };
    newId = p.id;
    if (kind === "platform") {
      const scale = Math.min(1, 240 / map().textureSizes[textureKey].width);
      map().layout.platforms.push({ ...p, textureKey, scaleX: scale, scaleY: scale, flipX: false });
    } else if (kind === "hitbox")
      map().layout.hitboxes.push({
        ...p,
        width: 200,
        height: 24,
        collision: { up: true, down: true, left: true, right: true },
      });
    else if (kind === "powerup")
      map().spawns.powerups.push(
        snapMove(map(), { kind: "powerup", value: p }, p.x, p.y, 16).value,
      );
    else if (kind === "cloud") {
      map().scenery.clouds ||= { enabled: true, items: [] };
      map().scenery.clouds.items.push({
        ...p,
        type: RANDOM_CLOUD,
        direction: "right",
        speed: 6,
        scale: 0.8,
      });
    } else {
      const b = map().objectiveLayout.bankBust;
      if (!b)
        throw Error(
          "Bank Bust objects belong to a Bank Bust map. Select Iron Junction or create a map from it.",
        );
      if (kind === "gold") b.randomGoldSpawnPoints.push(p);
      else
        b.objects.push({
          ...p,
          type: kind,
          ...{
            goldMine: {
              radius: 86,
              collectionRadius: 110,
              yieldAmount: 10,
              yieldIntervalMs: 4000,
              maxStoredGold: 60,
            },
            claimableTurret: {
              claimRadius: 110,
              claimCost: 120,
              range: 520,
              fireRateMs: 900,
              damage: 115,
              projectileSpeed: 520,
              turnSpeed: 0.08,
            },
            wallSlot: { buildRadius: 100, cost: 90, width: 120, height: 46 },
          }[kind],
        });
    }
    if (["platform", "hitbox"].includes(kind)) {
      const placed = (kind === "platform" ? map().layout.platforms : map().layout.hitboxes).find(
        (r) => r.id === newId,
      );
      let valid = validateMap(map()).length === 0;
      for (let step = 1; !valid && step <= 20; step++)
        for (const [dx, dy] of [
          [0, -1],
          [1, 0],
          [-1, 0],
          [0, 1],
        ]) {
          placed.x = p.x + dx * step * 48;
          placed.y = p.y + dy * step * 48;
          if (validateMap(map()).length === 0) {
            valid = true;
            break;
          }
        }
    }
    editor.selectedId = newId;
  }, "Object added");
  select(editor.selectedId);
}

function duplicate() {
  const rows = allRows(map()).filter(
    (row) => editor.selectedIds.has(row.id) && !["spawn", "vault", "respawn"].includes(row.kind),
  );
  if (!rows.length) return;
  transaction(() => {
    const ids = [];
    for (const row of rows) {
      const p = clone(row.value);
      p.id = uid(row.kind);
      if (row.kind === "powerup" && p.anchorId) {
        Object.assign(p, mapPoint(row));
        delete p.anchorId;
        delete p.dx;
      }
      p.x = Math.round(p.x + 32);
      p.y = Math.round(p.y + 32);
      const target =
        row.kind === "platform"
          ? map().layout.platforms
          : row.kind === "hitbox"
            ? map().layout.hitboxes
            : row.kind === "powerup"
              ? map().spawns.powerups
              : row.kind === "cloud"
                ? map().scenery.clouds.items
                : row.kind === "gold"
                  ? map().objectiveLayout.bankBust.randomGoldSpawnPoints
                  : map().objectiveLayout.bankBust.objects;
      target.push(p);
      ids.push(p.id);
    }
    editor.selectedIds = new Set(ids);
    editor.selectedId = ids.at(-1);
  }, "Selection duplicated");
}

function remove() {
  const ids = allRows(map())
    .filter(
      (row) => editor.selectedIds.has(row.id) && !["spawn", "vault", "respawn"].includes(row.kind),
    )
    .map((row) => row.id);
  if (!ids.length) return;
  transaction(() => {
    removeRows(map(), ids);
    editor.selectedId = null;
    editor.selectedIds.clear();
  }, "Selection removed");
}

export { addObject, duplicate, remove };
