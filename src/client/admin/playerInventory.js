import { node, button, fetchJson, showToast, confirmDialog } from "./common";

const LABELS = { skins: "Skins", icons: "Profile icons", cards: "Player cards", titles: "Titles" };

export function createInventoryEditor(host, { onSaved = async () => {}, onDirty = () => {} } = {}) {
  let userId = null, inventory = {}, draft = new Map(), saving = false;
  const keyFor = (kind, id) => `${kind}:${id}`;
  function set(playerId, data) {
    userId = playerId;
    inventory = data || {};
    draft = new Map();
    render();
    onDirty();
  }
  function render() {
    host.replaceChildren();
    if (inventory.error) { host.append(node("p", inventory.error, "muted")); return; }
    const actions = node("div", null, "inventory-actions");
    const summary = node("span", null, "muted");
    const save = button("Save inventory", "primary", async () => {
      if (saving || !draft.size) return;
      const changes = [...draft.values()];
      const names = changes.map(change => `${change.owned ? "Grant" : "Remove"} ${inventory[change.kind].items.find(item => item.id === change.id)?.name || change.id}`);
      if (!await confirmDialog({ title: `Save ${changes.length} inventory change${changes.length === 1 ? "" : "s"}?`, details: names, confirmLabel: "Save inventory" })) return;
      const target = userId;
      saving = true;
      save.disabled = true;
      onDirty();
      host.querySelectorAll("input").forEach(input => { input.disabled = true; });
      try {
        await fetchJson(`/api/admin/users/${target}/inventory`, { method: "POST", body: { changes } });
        if (target !== userId) return;
        for (const change of changes) inventory[change.kind].items.find(item => item.id === change.id).owned = change.owned;
        draft.clear();
        showToast("Saved cosmetic inventory");
        try { await onSaved(target); }
        catch { showToast("Inventory saved. Reopen the player to refresh the details.", true); }
      } catch (error) {
        if (target === userId) showToast(error.message || "Unable to save inventory", true);
      } finally {
        saving = false;
        if (target === userId) render();
        onDirty();
      }
    });
    const update = () => {
      summary.textContent = draft.size ? `${draft.size} unsaved change${draft.size === 1 ? "" : "s"}` : "";
      save.disabled = saving || !draft.size;
      onDirty();
    };
    actions.append(summary, save);
    host.append(actions);
    for (const [kind, label] of Object.entries(LABELS)) {
      const group = inventory[kind];
      if (!group) continue;
      const section = node("article", null, "panel inventory-section");
      section.append(node("div", `${label} · ${(group.items || []).filter(item => draft.get(keyFor(kind, item.id))?.owned ?? item.owned).length} owned`, "panel-title"));
      if (group.error) { section.append(node("p", group.error, "muted")); host.append(section); continue; }
      const filter = node("input");
      filter.type = "search";
      filter.placeholder = `Find ${label.toLowerCase()}…`;
      filter.setAttribute("aria-label", `Find ${label.toLowerCase()}`);
      const grid = node("div", null, "inventory-grid");
      const tiles = [];
      for (const item of group.items || []) {
        const tile = node("label", null, "inventory-item");
        const input = node("input");
        input.type = "checkbox";
        input.checked = draft.get(keyFor(kind, item.id))?.owned ?? item.owned;
        input.disabled = saving || item.automatic;
        input.setAttribute("aria-label", `Own ${item.name}`);
        input.addEventListener("change", () => {
          const key = keyFor(kind, item.id);
          if (input.checked === item.owned) draft.delete(key);
          else draft.set(key, { kind, id: item.id, owned: input.checked });
          tile.classList.toggle("is-dirty", draft.has(key));
          update();
        });
        tile.classList.toggle("is-dirty", draft.has(keyFor(kind, item.id)));
        tile.append(input);
        if (item.assetUrl) {
          const img = node("img");
          img.src = item.assetUrl;
          img.alt = "";
          img.loading = "lazy";
          tile.append(img);
        }
        const text = node("span");
        text.append(node("strong", item.name), node("small", [item.character, item.rarity, item.automatic ? "Automatic" : "", item.equipped ? "Equipped" : ""].filter(Boolean).join(" · "), "muted"));
        tile.append(text);
        grid.append(tile);
        tiles.push({ tile, text: `${item.name} ${item.id} ${item.character || ""}`.toLowerCase() });
      }
      filter.addEventListener("input", () => { for (const item of tiles) item.tile.hidden = !item.text.includes(filter.value.trim().toLowerCase()); });
      section.append(filter, grid);
      host.append(section);
    }
    update();
  }
  return { set, isDirty: () => saving || draft.size > 0 };
}
