import { node, button, input, showToast, openModal, confirmDialog, promptDialog } from "../common";
import { getSaleOfferIds, isRotatingSection, getSectionRotationSize } from "../../../server/services/shop/shopOfferRules";
import { LAYOUTS, store, offers, sections, dailies, salesOrdinal, slug, uniqueId, problemText, problemsFor, markChanged } from "./catalogDraft";
import { arrowButton } from "./offerList";
import { segmented } from "./offerControls";

// ---- Sections ----
function renderSections() {
  const list = sections();
  const wrap = node("div", null, "store-panel");
  const bar = node("div", null, "store-toolbar");
  bar.append(node("p", `Sections appear in this order as shop tabs. Sales and Dailies are required. Resets use ${store.draft.timezone}.`, "hint"), node("span", null, "spacer"), button("+ Add section", "primary", addSection));
  const grid = node("div", null, "section-grid");
  list.forEach((section, index) => grid.append(sectionCard(section, index, list)));
  wrap.append(bar, grid);
  return wrap;
}

function sectionCard(section, index, list) {
  const card = node("article", null, "panel section-card");
  const head = node("div", null, "section-head");
  const icon = button(null, "section-icon", () => pickIcon(section.icon, (src) => { section.icon = src; markChanged(); }));
  icon.title = "Change icon";
  icon.setAttribute("aria-label", `Change icon for ${section.name}`);
  icon.append(Object.assign(node("img"), { src: section.icon, alt: "" }));
  const nameInput = input("text", section.name, { "aria-label": "Section name", maxlength: "30" });
  nameInput.addEventListener("change", () => { section.name = nameInput.value.trim() || section.name; nameInput.value = section.name; markChanged(); });
  const up = arrowButton("up", () => { [list[index - 1], list[index]] = [list[index], list[index - 1]]; markChanged(); });
  const down = arrowButton("down", () => { [list[index + 1], list[index]] = [list[index], list[index + 1]]; markChanged(); });
  up.disabled = index === 0; down.disabled = index === list.length - 1;
  const used = offers().filter((o) => o.section === section.id).length;
  const required = section.id === "sales" || section.id === "dailies";
  const remove = button("Delete", "mini danger", async () => {
    if (!await confirmDialog({ title: `Delete the ${section.name} section?`, confirmLabel: "Delete", danger: true })) return;
    list.splice(list.indexOf(section), 1);
    markChanged();
  });
  remove.disabled = required || used > 0;
  remove.title = required ? "Required section" : used ? `Move its ${used} offers to another section first` : "";
  head.append(icon, nameInput, up, down, remove);

  const facts = node("p", null, "hint section-facts");
  const count = section.id === "dailies" ? `${dailies().length} daily rewards` : section.id === "sales" ? `${getSaleOfferIds(store.draft, { ordinal: salesOrdinal() }).length} on sale this week` : `${used} offer${used === 1 ? "" : "s"}`;
  facts.append(node("span", section.id, "tag mono"), document.createTextNode(` ${count}`));
  if (isRotatingSection(section)) facts.append(document.createTextNode(` · ${Math.min(used, getSectionRotationSize(section))} shown each week`));

  const settings = node("div", null, "section-settings");
  const setting = (label, control, hint) => { const f = node("div", null, "field"); f.append(node("span", label, "field-label"), control); if (hint) f.append(node("small", hint, "hint")); return f; };
  if (required) {
    settings.append(setting("Content", node("span", section.id === "sales" ? "Weekly sales (see Weekly rotation)" : "Today's free reward (see Daily rewards)", "muted")));
  } else {
    settings.append(setting("Rotation", segmented([["none", "Always show all"], ["sales", "Rotate weekly"]], section.rotation === "sales" ? "sales" : "none", (value) => {
      if (value === "sales") { section.rotation = "sales"; section.rows ??= 2; } else delete section.rotation;
      markChanged();
    }), isRotatingSection(section) ? `Shows ${getSectionRotationSize(section)} offers a week (rows × 3), on the Sales schedule.` : null));
  }
  settings.append(setting("Layout", segmented(LAYOUTS, section.layout || "grid", (value) => { if (value === "grid") delete section.layout; else section.layout = value; markChanged(); }), { grid: "Three columns.", featured: "A large first card, then a grid.", list: "One wide column." }[section.layout || "grid"]));
  const rowsValue = section.rows ? String(section.rows) : "all";
  settings.append(setting("Rows shown", segmented([["all", "All", isRotatingSection(section) ? "Rotating sections need a row count" : null], ["1", "1"], ["2", "2"], ["3", "3"]], rowsValue, (value) => {
    if (value === "all") { delete section.rows; delete section.collapsible; } else section.rows = Number(value);
    markChanged();
  }), section.rows ? (section.collapsible ? "Extra offers hide behind Expand." : "Extra offers stay hidden.") : "Every offer is shown."));
  const toggle = (key, label, disabledReason) => {
    const box = Object.assign(node("input"), { type: "checkbox", checked: !!section[key], disabled: !!disabledReason });
    box.addEventListener("change", () => { if (box.checked) section[key] = true; else delete section[key]; markChanged(); });
    const el = node("label", null, "check");
    el.append(box, node("span", label));
    if (disabledReason) el.title = disabledReason;
    return el;
  };
  const toggles = node("div", null, "section-toggles");
  toggles.append(
    toggle("showRarity", "Show rarity"),
    toggle("hideOwned", "Hide owned items"),
    toggle("collapsible", "Expand button", section.rows ? null : "Set a row count first"),
  );
  settings.append(toggles);
  const problems = problemsFor("section", section.id);
  if (problems.length) {
    const box = node("div", null, "editor-problems");
    const ul = node("ul");
    for (const message of problems) ul.append(node("li", problemText(message)));
    box.append(ul);
    settings.append(box);
  }
  card.append(head, facts, settings);
  return card;
}

function pickIcon(current, onPick) {
  const modal = openModal("Choose an icon", { submitLabel: "Close", cancelLabel: "", dismissible: true });
  const grid = node("div", null, "icon-grid");
  for (const src of store.options.icons) {
    const choice = button(null, `icon-choice${src === current ? " is-active" : ""}`, () => { onPick(src); modal.close(); });
    choice.title = src.split("/").pop();
    choice.append(Object.assign(node("img"), { src, alt: "" }), node("small", choice.title.replace(/\.(webp|svg)$/, "")));
    grid.append(choice);
  }
  modal.body.append(grid);
}

async function addSection() {
  const name = await promptDialog({ title: "New shop section", label: "Section name", placeholder: "e.g. Titles", confirmLabel: "Add section", maxLength: 30 });
  if (!name) return;
  const list = sections();
  const id = uniqueId(slug(name).replace(/^[^a-z]+/, "") || "section", new Set(list.map((s) => s.id)));
  list.push({ id, name, icon: store.options.icons.find((i) => i.includes("shop")) || store.options.icons[0], showRarity: true });
  markChanged();
  showToast(`Added the ${name} section`);
}

export { renderSections };

