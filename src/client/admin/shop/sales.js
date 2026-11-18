import { API_PATHS } from "../../../shared/net/apiPaths.js";
import { node, button, field, input, fmt, fetchJson, formatAdminDate, showToast, confirmDialog } from "../common";
import { getSaleOfferIds, getRotatingOfferIds, isRotatingSection } from "../../../server/services/shop/shopOfferRules";
import { store, loadStatus, offers, sections, sales, sectionName, offerById, salesOrdinal, priceNode, salePriceNode, markChanged, scheduleCheck } from "./catalogDraft";
import { renderTab } from "./shopShell";
import { arrowButton } from "./offerList";
import { editOffer } from "./offerEditor";

// ---- Weekly rotation ----
function renderSales() {
  const config = sales();
  const wrap = node("div", null, "store-panel sales-grid");
  const rotation = store.status?.rotations?.sales || {};

  const settings = node("article", null, "panel");
  settings.append(node("div", "Sale settings", "panel-title"));
  const discount = input("number", config.discountPercent, { min: "0", max: "90", step: "1" });
  discount.addEventListener("change", () => { config.discountPercent = Math.max(0, Math.min(90, Math.floor(Number(discount.value) || 0))); markChanged(); });
  const count = input("number", config.promotedCount, { min: "0", max: String(config.promotedOfferIds.length || 0), step: "1" });
  count.addEventListener("change", () => { config.promotedCount = Math.max(0, Math.floor(Number(count.value) || 0)); markChanged(); });
  const fields = node("div", null, "field-row");
  fields.append(field("Default discount %", discount, "Items only. Bundles keep their price unless they set their own discount."), field("Rotating sales per week", count, `Taken in order from the pool of ${config.promotedOfferIds.length}.`));
  const refreshRow = node("div", null, "rotation-status");
  refreshRow.append(node("span", `${cycleLabel(rotation)} · next reset ${formatAdminDate(rotation.nextRefreshAt, true)}`, "muted"), button("Rotate now", "", () => refreshRotation("sales")));
  settings.append(fields, refreshRow);

  const schedule = node("article", null, "panel schedule-panel");
  schedule.append(node("div", "Schedule", "panel-title"), node("p", "Sales and rotating sections, week by week, from your draft.", "hint"));
  const rotating = sections().filter(isRotatingSection);
  const table = node("div", null, "schedule");
  const base = salesOrdinal();
  for (let week = 0; week < 4; week += 1) {
    const column = node("div", null, `schedule-week${week === 0 ? " is-current" : ""}`);
    column.append(node("strong", week === 0 ? "This week" : week === 1 ? "Next week" : `In ${week} weeks`, "schedule-title"));
    const saleIds = getSaleOfferIds(store.draft, { ordinal: base + week });
    column.append(scheduleGroup("Sales", saleIds, true));
    for (const meta of rotating) column.append(scheduleGroup(meta.name, getRotatingOfferIds(store.draft, { ordinal: base + week }, meta.id, saleIds)));
    table.append(column);
  }
  schedule.append(table);

  settings.classList.add("sales-settings");
  wrap.append(settings, schedule, offerList("Every week (pinned)", "pinnedOfferIds", "Always on sale, in this order."), offerList("Rotation pool", "promotedOfferIds", `Each week the next ${config.promotedCount} go on sale, looping through the list.`));
  return wrap;
}

function scheduleGroup(title, ids, onSale = false) {
  const group = node("div", null, "schedule-group");
  group.append(node("span", title, "field-label"));
  const list = node("ul");
  for (const id of ids) {
    const offer = offerById(id);
    if (!offer) continue;
    const li = node("li");
    const open = button(null, "row-link", () => editOffer(offer));
    open.append(Object.assign(node("img", null, "schedule-thumb"), { src: offer.banner || "", alt: "" }), node("span", offer.name));
    li.append(open, onSale ? salePriceNode(offer) : priceNode(offer.price));
    list.append(li);
  }
  if (!list.children.length) list.append(node("li", "Nothing", "muted"));
  group.append(list);
  return group;
}

function offerList(title, key, hint) {
  const config = sales();
  const panel = node("article", null, "panel");
  panel.append(node("div", `${title} · ${config[key].length}`, "panel-title"), node("p", hint, "hint"));
  const list = node("ol", null, "order-list");
  config[key].forEach((id, index) => {
    const offer = offerById(id);
    const li = node("li");
    const thumb = node("img", null, "order-thumb");
    thumb.src = offer?.banner || ""; thumb.alt = "";
    const label = node("span", null, "order-label");
    const open = button(null, "row-link", () => offer && editOffer(offer));
    open.append(node("strong", offer?.name || id));
    label.append(open, offer ? salePriceNode(offer) : node("span", "Missing offer", "bad-text"));
    const up = arrowButton("up", () => { [config[key][index - 1], config[key][index]] = [config[key][index], config[key][index - 1]]; markChanged(); });
    const down = arrowButton("down", () => { [config[key][index + 1], config[key][index]] = [config[key][index], config[key][index + 1]]; markChanged(); });
    up.disabled = index === 0; down.disabled = index === config[key].length - 1;
    const remove = button("Remove", "mini danger", () => { config[key].splice(index, 1); markChanged(); });
    if (offer?.section === "sales") { remove.disabled = true; remove.title = "Lives in the Sales section, so it must stay on sale. Move it to another section first."; }
    li.append(thumb, label, up, down, remove);
    list.append(li);
  });
  if (!config[key].length) list.append(node("li", "Empty", "muted"));
  const used = new Set([...config.pinnedOfferIds, ...config.promotedOfferIds]);
  const candidates = offers().filter((o) => o.price?.type === "virtual" && !used.has(o.id));
  const groups = new Map();
  for (const offer of candidates) groups.set(offer.section, [...(groups.get(offer.section) || []), offer]);
  const add = node("select");
  add.setAttribute("aria-label", `Add to ${title}`);
  add.append(Object.assign(node("option", candidates.length ? "+ Add an offer…" : "Every coin and gem offer is already listed"), { value: "" }));
  for (const [sectionId, list_] of groups) {
    const optgroup = node("optgroup");
    optgroup.label = sectionName(sectionId);
    for (const offer of list_) optgroup.append(Object.assign(node("option", `${offer.name} · ${fmt(offer.price.amount)} ${offer.price.currency}`), { value: offer.id }));
    add.append(optgroup);
  }
  add.disabled = !candidates.length;
  add.addEventListener("change", () => { if (add.value) { config[key].push(add.value); markChanged(); } });
  panel.append(list, add);
  return panel;
}

// "week:2026-11-09:g1" → "Week of Nov 9 (rotated early 1×)".
function cycleLabel(rotation) {
  const [kind, date, generation] = String(rotation?.cycleKey || "").split(":");
  if (!date) return "Current cycle unknown";
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  const early = Number(String(generation || "").slice(1)) || 0;
  return `${kind === "week" ? "Week of" : "Day"} ${day}${early ? ` (rotated early ${early}×)` : ""}`;
}

async function refreshRotation(section) {
  const ok = await confirmDialog(section === "sales"
    ? { title: "Rotate the week now?", message: "Sales and rotating sections jump to next week's offers for every player right away.", confirmLabel: "Rotate now" }
    : { title: "Skip to the next daily reward?", message: "Every player gets the next reward now, including players who already claimed today.", confirmLabel: "Skip ahead" });
  if (!ok) return;
  try {
    await fetchJson(API_PATHS.API_ADMIN_SHOP_REFRESH, { method: "POST", body: { section } });
    await loadStatus();
    showToast(section === "sales" ? "Week rotated" : "Daily reward advanced");
    renderTab();
    scheduleCheck(0);
  } catch (error) { showToast(error.message, true); }
}

export { renderSales, refreshRotation };

