import { pixelArrow } from "../../ui/pixelArrow.js";
import { sectionTree } from "../../lobby/shop/shopMarkup.js";
import { node, button, formatAdminDate } from "../common";
import { store, isStoreDirty, dailies, offerById, scheduleCheck } from "./catalogDraft";
import { showProblems, renderTab } from "./shopShell";
import { editOffer } from "./offerEditor";
import { editDaily } from "./dailies";

// ---- Live preview: the real shop, built by the server from the draft ----
function stepper(label, value, onChange, describe) {
  const wrap = node("div", null, "stepper");
  const prev = button(null, "mini arrow", () => onChange(value - 1));
  prev.setAttribute("aria-label", `Previous ${label}`);
  prev.append(pixelArrow("left", "sm"));
  const next = button(null, "mini arrow", () => onChange(value + 1));
  next.setAttribute("aria-label", `Next ${label}`);
  next.append(pixelArrow("right", "sm"));
  prev.disabled = value <= 0;
  const text = node("span", describe(value), "stepper-label");
  wrap.append(node("span", label, "field-label"), prev, text, next);
  return wrap;
}

function renderPreview() {
  const wrap = node("div", null, "store-panel");
  const bar = node("div", null, "store-toolbar");
  const weekStart = (offset) => {
    const next = store.status?.rotations?.sales?.nextRefreshAt;
    if (!next) return "";
    const date = new Date(new Date(next).getTime() + (offset - 1) * 7 * 864e5);
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
  };
  const describeWeek = (n) => (n === 0 ? "This week" : n === 1 ? `Next week · ${weekStart(n)}` : `Week of ${weekStart(n)}`);
  const describeDay = (n) => (n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`);
  bar.append(
    stepper("Sales & rotations", store.previewWeeks, (n) => { store.previewWeeks = Math.max(0, n); renderTab(); scheduleCheck(0); }, describeWeek),
    stepper("Daily reward", store.previewDays, (n) => { store.previewDays = Math.max(0, n); renderTab(); scheduleCheck(0); }, describeDay),
    node("span", null, "spacer"),
    node("span", isStoreDirty() ? "Showing your unpublished draft" : "Showing the published shop", `pill ${isStoreDirty() ? "is-warn" : ""}`),
  );
  wrap.append(bar, node("p", "What a new player sees (they own nothing yet). Click any card to edit it.", "hint"));

  const preview = store.preview;
  if (!preview) { wrap.append(node("p", "Building the preview…", "muted pad")); return wrap; }
  if (preview.error) { wrap.append(node("p", preview.error, "bad-text pad")); return wrap; }
  if (store.errors.length) {
    const warn = node("div", null, "preview-warning");
    warn.append(node("strong", "Players would see an empty shop."), node("span", " A catalog with problems is switched off until it is fixed. The preview below shows the draft anyway.", "muted"), button("Show problems", "mini", showProblems));
    wrap.append(warn);
  }

  const window_ = node("section", null, "shop-window admin-shop-window");
  const header = node("header", null, "shop-header");
  header.innerHTML = '<div class="shop-brand"><img class="shop-title-icon" src="/assets/shop/icons/shop-v2.webp" alt="" /><h1>Bro Shop</h1></div>';
  const tabs = node("nav", null, "shop-tabs");
  const scroll = node("div", null, "shop-scroll");
  for (const meta of preview.sectionMeta || []) {
    const tab = button(null, "", () => scroll.querySelector(`#shop-section-${CSS.escape(meta.id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    tab.innerHTML = `<img class="shop-tab-icon" src="${meta.icon}" alt="" /><span></span>`;
    tab.querySelector("span").textContent = meta.name;
    tabs.append(tab);
    scroll.append(buildTree(sectionTree(meta, preview.sections?.[meta.id] || [])));
  }
  scroll.querySelectorAll("[data-shop-countdown]").forEach((el) => {
    const rotation = preview.rotations?.[el.dataset.shopCountdown];
    el.textContent = rotation?.nextRefreshAt ? `Resets ${formatAdminDate(rotation.nextRefreshAt, true)}` : "--";
  });
  scroll.addEventListener("click", (event) => {
    const expand = event.target.closest(".shop-expand");
    if (expand) {
      const section = expand.closest(".shop-section");
      const open = !section.classList.contains("is-expanded");
      section.classList.toggle("is-expanded", open);
      expand.textContent = open ? "Collapse" : "Expand";
      expand.setAttribute("aria-expanded", String(open));
      return;
    }
    const card = event.target.closest("[data-shop-item-id]");
    if (!card) return;
    const id = card.dataset.shopItemId;
    const offer = offerById(id);
    if (offer) editOffer(offer);
    else { const reward = dailies().find((r) => r.id === id); if (reward) editDaily(reward); }
  });
  scroll.querySelectorAll("button:not(.shop-expand)").forEach((el) => { el.tabIndex = -1; });
  window_.append(header, tabs, scroll);
  wrap.append(window_);
  return wrap;
}

function buildTree(entry) {
  const box = document.createElement("div");
  box.innerHTML = entry.html.trim();
  const el = box.firstElementChild;
  for (const child of entry.children || []) el.append(buildTree(child));
  return el;
}

export { renderPreview };

