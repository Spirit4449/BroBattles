import { API_PATHS } from "../../../shared/net/apiPaths.js";
import { $, node, button, titleCase, fetchJson, showToast, openModal, confirmDialog } from "../common";
import { TABS, DRAFT_KEY, PREFS_KEY, store, storage, isStoreDirty, initStore, offers, dailies, sectionName, offerById, problemTarget, problemText, openProblem, markChanged, scheduleCheck, refreshProblemMarks, changeSummary } from "./catalogDraft";
import { renderPreview } from "./livePreview";
import { renderOffers } from "./offerList";
import { renderSales } from "./sales";
import { renderDailies } from "./dailies";
import { renderSections } from "./sections";
import { renderPayments } from "./orderList";

// ---- Shell ----
function render() {
  const root = store.root;
  const header = node("div", null, "store-header");
  const titles = node("div", null, "store-titles");
  titles.append(node("h1", "Store", "view-title"), node("p", "Edit the shop, check it in the live preview, then publish. Players see changes the next time they open the shop.", "hint"));
  header.append(titles, node("span", null, "spacer"), node("div", null, "store-pills"));

  const tabs = node("nav", null, "tabs store-tabs");
  tabs.setAttribute("aria-label", "Store sections");
  for (const [id, label] of TABS) {
    const tab = button(label, "", () => selectTab(id));
    tab.dataset.storeTab = id;
    tabs.append(tab);
  }
  const body = node("div", null, "store-body");
  const publish = node("div", null, "save-bar store-publish");
  publish.hidden = true;
  root.replaceChildren(header, tabs, body, publish);
  renderPills();
  renderTab();
  renderPublishBar();
}

function selectTab(id) {
  store.tab = id;
  storage.set(PREFS_KEY, { tab: store.tab, layout: store.layout });
  renderTab();
}

function renderPills() {
  const pills = $(".store-pills", store.root);
  if (!pills) return;
  const payment = store.status?.payment || {};
  const stripe = node("span", payment.enabled ? "Payments on" : "Payments off", `pill ${payment.enabled ? "is-good" : "is-bad"}`);
  stripe.title = payment.enabled ? "Real-money offers can be bought" : `Missing: ${(payment.missing || []).join(", ") || "configuration"}`;
  const count = store.errors.length;
  const health = button(store.checking && !count ? "Checking…" : count ? `${count} problem${count === 1 ? "" : "s"}` : "No problems", `pill pill-button ${count ? "is-bad" : "is-good"}`, () => { if (count) showProblems(); });
  health.title = count ? "Show problems" : "The draft passes every shop rule";
  pills.replaceChildren(health, stripe, node("span", `${offers().length} offers`, "pill"));
}

function showProblems() {
  const modal = openModal(`${store.errors.length} shop problem${store.errors.length === 1 ? "" : "s"}`, { submitLabel: "Close", cancelLabel: "", dismissible: true });
  modal.body.append(node("p", "Publishing is blocked until these are fixed. Click one to open it.", "hint"));
  modal.body.append(problemList(store.errors, () => modal.close()));
}

function problemList(messages, beforeOpen) {
  const list = node("ul", null, "problem-list");
  for (const message of messages) {
    const target = problemTarget(message);
    const owner = target.type === "offer" ? offerById(target.id)?.name : target.type === "daily" ? dailies().find((r) => r.id === target.id)?.name : target.type === "section" ? sectionName(target.id) : null;
    const li = node("li");
    const open = button(null, "row-link", () => { beforeOpen?.(); openProblem(message); });
    open.append(node("strong", owner || titleCase(target.type)), node("span", problemText(message), "muted"));
    li.append(open);
    list.append(li);
  }
  return list;
}

function renderPublishBar(failure = null) {
  const bar = $(".store-publish", store.root);
  if (!bar) return;
  const dirty = isStoreDirty();
  bar.hidden = !dirty && !failure;
  if (bar.hidden) return;
  const text = node("div", null, "publish-text");
  const lines = dirty ? changeSummary() : [];
  text.append(node("strong", failure ? "Publishing failed" : `Unpublished changes${lines.length ? ` · ${lines.length}` : ""}`));
  if (failure?.length) {
    const list = node("ul", null, "publish-errors");
    for (const error of failure.slice(0, 6)) list.append(node("li", error));
    if (failure.length > 6) list.append(node("li", `…and ${failure.length - 6} more`));
    text.append(list);
  } else if (store.errors.length) {
    const fix = button(`Fix ${store.errors.length} problem${store.errors.length === 1 ? "" : "s"} to publish`, "row-link is-bad", showProblems);
    text.append(fix);
  } else text.append(node("span", lines.join(" · ") || "Nothing changes for players until you publish.", "muted publish-lines"));
  const discard = button("Discard", "", discardChanges);
  discard.disabled = !dirty;
  const publish = button("Publish", "primary", publishCatalog);
  publish.disabled = !dirty || store.errors.length > 0 || store.checking;
  publish.title = store.errors.length ? "Fix the problems first" : store.checking ? "Checking the draft…" : "";
  bar.replaceChildren(text, discard, publish);
}

async function discardChanges() {
  if (!await confirmDialog({ title: "Discard unpublished changes?", details: changeSummary(), confirmLabel: "Discard", danger: true })) return;
  store.draft = JSON.parse(store.saved);
  markChanged();
  showToast("Changes discarded");
}

async function publishCatalog() {
  const lines = changeSummary();
  if (!await confirmDialog({ title: "Publish to the shop?", message: "Players see these changes the next time they open the shop.", details: lines, confirmLabel: "Publish" })) return;
  const btn = $(".store-publish .primary", store.root);
  if (btn) btn.disabled = true;
  try {
    const data = await fetchJson(API_PATHS.API_ADMIN_SHOP_CATALOG, { method: "PUT", body: { catalog: store.draft, revision: store.revision } });
    store.draft = data.catalog;
    store.saved = JSON.stringify(data.catalog);
    store.revision = data.revision;
    store.errors = [];
    storage.set(DRAFT_KEY, null);
    store.onDirtyChange?.(false);
    showToast("Shop published");
    renderPills();
    renderPublishBar();
    renderTab();
    scheduleCheck(0);
  } catch (error) {
    showToast(error.message, true);
    if (error.status === 409) {
      const reload = await confirmDialog({ title: "The shop changed elsewhere", message: "Someone published since you opened the store. Reload the latest version? Your unpublished changes will be lost.", confirmLabel: "Reload", danger: true });
      if (reload) { storage.set(DRAFT_KEY, null); await initStore(store.root); }
      return;
    }
    renderPublishBar(error.data?.errors || [error.message]);
  }
}

function renderTab() {
  const body = $(".store-body", store.root);
  if (!body) return;
  store.root.querySelectorAll("[data-store-tab]").forEach((tab) => tab.setAttribute("aria-pressed", String(tab.dataset.storeTab === store.tab)));
  const renderers = { preview: renderPreview, offers: renderOffers, sales: renderSales, dailies: renderDailies, sections: renderSections, payments: renderPayments };
  body.replaceChildren(renderers[store.tab]());
  refreshProblemMarks();
}

export { render, selectTab, renderPills, showProblems, renderPublishBar, renderTab };

