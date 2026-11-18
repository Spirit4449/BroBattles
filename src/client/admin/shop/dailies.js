import { node, button, field, input, titleCase, formatAdminDate, showToast, openModal, confirmDialog } from "../common";
import { RARITIES, store, clone, dailies, allIds, dailyOrdinal, slug, uniqueId, shopCard, problemsFor, markChanged } from "./catalogDraft";
import { arrowButton } from "./offerList";
import { grantsEditor, bannerPicker, segmented } from "./offerControls";
import { refreshRotation } from "./sales";

// ---- Daily rewards ----
function renderDailies() {
  const rewards = dailies();
  const rotation = store.status?.rotations?.dailies || {};
  const today = rewards.length ? (Math.abs(dailyOrdinal()) % rewards.length) : -1;
  const wrap = node("div", null, "store-panel");
  const bar = node("div", null, "store-toolbar");
  bar.append(node("p", `One free reward a day, in this order, looping. Next reset ${formatAdminDate(rotation.nextRefreshAt, true)}.`, "hint"), node("span", null, "spacer"), button("Skip to next", "", () => refreshRotation("dailies")), button("+ New daily reward", "primary", () => editDaily(null)));
  const grid = node("div", null, "offer-grid");
  rewards.forEach((reward, index) => {
    const holder = node("div", null, `offer-holder${index === today ? " is-today" : ""}`);
    const daysAway = (index - today + rewards.length) % rewards.length;
    const meta = node("div", null, "offer-meta");
    meta.append(node("span", index === today ? "Today" : daysAway === 1 ? "Tomorrow" : `In ${daysAway} days`, `tag status-flag ${index === today ? "is-sale" : ""}`));
    const problems = problemsFor("daily", reward.id);
    if (problems.length) meta.append(node("span", `${problems.length} problem${problems.length === 1 ? "" : "s"}`, "tag problem-badge"));
    const card = shopCard(reward, { daily: true });
    card.classList.add("is-clickable");
    card.addEventListener("click", () => editDaily(reward));
    const actions = node("div", null, "offer-actions");
    const left = arrowButton("left", () => { [rewards[index - 1], rewards[index]] = [rewards[index], rewards[index - 1]]; markChanged(); });
    const right = arrowButton("right", () => { [rewards[index + 1], rewards[index]] = [rewards[index], rewards[index + 1]]; markChanged(); });
    left.disabled = index === 0; right.disabled = index === rewards.length - 1;
    const remove = button("Delete", "mini danger", () => deleteDaily(reward));
    remove.disabled = rewards.length === 1;
    remove.title = rewards.length === 1 ? "Keep at least one daily reward" : "";
    actions.append(left, right, button("Edit", "mini", () => editDaily(reward)), remove);
    holder.append(meta, card, actions);
    grid.append(holder);
  });
  wrap.append(bar, grid);
  return wrap;
}

async function deleteDaily(reward) {
  const rewards = dailies();
  if (rewards.length === 1) { showToast("Keep at least one daily reward", true); return false; }
  if (!await confirmDialog({ title: `Delete ${reward.name}?`, message: "It leaves the daily rotation when you publish.", confirmLabel: "Delete", danger: true })) return false;
  rewards.splice(rewards.indexOf(reward), 1);
  markChanged();
  return true;
}

function editDaily(existing) {
  const isNew = !existing;
  const draft = existing ? clone(existing) : { id: "", name: "", description: "", rarity: "common", banner: store.options.banners.find((b) => b.includes("daily")) || store.options.banners[0], grants: [{ kind: "currency", currency: "coins", amount: 50 }] };
  const preview = node("div", null, "offer-preview");
  const drawPreview = () => preview.replaceChildren(node("span", "Preview", "field-label"), shopCard(draft, { daily: true }));
  const name = input("text", draft.name, { maxlength: "60", placeholder: "e.g. Coin Drop" });
  name.addEventListener("input", () => { draft.name = name.value; if (isNew) draft.id = uniqueId(`daily-${slug(name.value) || "reward"}`, allIds()); drawPreview(); });
  const description = node("textarea");
  description.value = draft.description || ""; description.rows = 2; description.maxLength = 200;
  description.addEventListener("input", () => { draft.description = description.value; });
  const rarity = segmented(RARITIES.map((r) => [r, titleCase(r)]), draft.rarity || "common", (value) => { draft.rarity = value; drawPreview(); });
  const modal = openModal(isNew ? "New daily reward" : `Edit ${existing.name}`, {
    wide: true,
    submitLabel: isNew ? "Add reward" : "Apply",
    extraActions: existing ? [{ label: "Delete", className: "danger", run: async (close) => { if (await deleteDaily(existing)) close(); } }] : [],
    onSubmit: () => {
      draft.name = draft.name.trim();
      if (!draft.name) throw new Error("Give the reward a name.");
      if (!draft.grants.length) throw new Error("Add at least one reward.");
      if (draft.grants.some((g) => g.kind === "currency" && !(g.amount > 0))) throw new Error("Currency rewards need an amount above zero.");
      const rewards = dailies();
      if (isNew) rewards.push(draft); else rewards[rewards.indexOf(existing)] = draft;
      markChanged();
      showToast(isNew ? `Added ${draft.name}` : `Updated ${draft.name}`);
    },
  });
  const left = node("div", null, "editor-fields");
  const row = node("div", null, "field-row");
  const rarityField = node("div", null, "field");
  rarityField.append(node("span", "Rarity", "field-label"), rarity);
  row.append(field("Name", name), rarityField);
  const group = (title, ...children) => { const g = node("fieldset", null, "editor-group"); g.append(node("legend", title), ...children); return g; };
  left.append(
    group("Basics", row, field("Description", description)),
    group("Rewards", grantsEditor(draft.grants, drawPreview).element),
    group("Banner", bannerPicker(draft.banner, (src) => { draft.banner = src; drawPreview(); }, ["daily", ...draft.grants.map((g) => g.currency || g.id)])),
  );
  const grid = node("div", null, "editor-grid");
  grid.append(left, preview);
  modal.body.append(grid);
  drawPreview();
  name.focus();
}

export { renderDailies, editDaily };

