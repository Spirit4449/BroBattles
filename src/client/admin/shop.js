// Store editor. The whole shop catalog is edited as a local draft and published
// in one step. Every change is checked by the server with the runtime rules and
// previewed with the lobby's own shop cards, so what you see is what players get.
import { pixelArrow } from "../ui/pixelArrow.js";
import { titleMarkup } from "../views/titleView.js";
import { offerMarkup, sectionTree } from "../lobby/shop/shop.js";
import { getCharacterDisplayName } from "../../shared/characters/characterStats.js";
import {
  $, node, button, field, input, select, fmt, titleCase, currencyIcon, fetchJson, formatAdminDate, timeAgo,
  showToast, openModal, confirmDialog, promptDialog,
} from "./common";
import {
  getSaleOfferIds, getSalePrice, getBundleValue, buildOfferIndexes, getRotatingOfferIds, isRotatingSection, getSectionRotationSize,
} from "../../server/services/shop/shopOfferRules";

const RARITIES = ["common", "rare", "epic", "legendary"];
const KINDS = { item: "Single item", bundle: "Bundle", "currency-pack": "Currency pack" };
const GRANT_KINDS = [["coins", "Coins"], ["gems", "Gems"], ["skin", "Skin"], ["card", "Player card"], ["profileIcon", "Profile icon"], ["title", "Title"]];
const COSMETIC_LABEL = { skin: "Skin", card: "Player card", profileIcon: "Profile icon", title: "Title" };
const TABS = [["preview", "Live preview"], ["offers", "Offers"], ["sales", "Weekly rotation"], ["dailies", "Daily rewards"], ["sections", "Sections"], ["payments", "Orders"]];
const LAYOUTS = [["grid", "Grid"], ["featured", "Featured"], ["list", "List"]];
const DRAFT_KEY = "bb-admin-shop-draft";
const PREFS_KEY = "bb-admin-shop-prefs";

const store = {
  root: null, draft: null, saved: "", revision: null, options: null, status: null,
  tab: "preview", filter: "all", show: "all", query: "", layout: "cards",
  errors: [], preview: null, previewWeeks: 0, previewDays: 0, checking: false, checkTimer: 0, checkGeneration: 0,
  openPlayer: null, onDirtyChange: null,
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const storage = {
  get(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } },
  set(key, value) { try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private mode keeps working without it. */ } },
};

export const isStoreDirty = () => !!store.draft && JSON.stringify(store.draft) !== store.saved;
export function setStorePlayerOpener(open) { store.openPlayer = open; }
export function onStoreDirtyChange(listener) { store.onDirtyChange = listener; }

export async function initStore(root) {
  store.root = root;
  root.className = "store";
  Object.assign(store, pick(storage.get(PREFS_KEY), ["tab", "layout"]));
  if (!TABS.some(([id]) => id === store.tab)) store.tab = "preview";
  root.replaceChildren(node("p", "Loading the shop…", "muted pad"));
  try {
    await Promise.all([loadCatalog(), loadStatus()]);
    render();
    offerDraftRestore();
    scheduleCheck(0);
  } catch (error) {
    root.replaceChildren(node("p", error.message, "muted pad"));
  }
}

function pick(source, keys) {
  return Object.fromEntries(keys.filter((key) => source?.[key] != null).map((key) => [key, source[key]]));
}

async function loadCatalog() {
  const data = await fetchJson("/api/admin/shop/catalog");
  store.draft = data.catalog;
  store.saved = JSON.stringify(data.catalog);
  store.revision = data.revision;
  store.options = data.options;
  store.errors = data.errors || [];
}

async function loadStatus() {
  store.status = await fetchJson("/api/admin/shop/status");
}

// ---- Catalog helpers ----
const offers = () => store.draft.offers || [];
const sections = () => store.draft.sections || [];
const sales = () => store.draft.rotation.sales;
const dailies = () => store.draft.rotation.dailies.rewards;
const sectionOf = (id) => sections().find((s) => s.id === id);
const sectionName = (id) => sectionOf(id)?.name || id;
const offerById = (id) => offers().find((o) => o.id === id);
const allIds = () => new Set([...offers().map((o) => o.id), ...dailies().map((r) => r.id)]);
const optionsFor = (kind) => ({ skin: store.options.skins, card: store.options.cards, profileIcon: store.options.profileIcons, title: store.options.titles }[kind] || []);
const salesOrdinal = () => Number(store.status?.rotations?.sales?.ordinal) || 0;
const dailyOrdinal = () => Number(store.status?.rotations?.dailies?.ordinal) || 0;

function slug(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function uniqueId(base, taken) {
  const root = base && base.length >= 2 ? base : `${base || "offer"}-item`;
  let id = root;
  for (let n = 2; taken.has(id); n += 1) id = `${root}-${n}`;
  return id;
}

function cosmeticName(grant) {
  const match = optionsFor(grant.kind).find((entry) => entry.id === grant.id);
  const character = grant.kind === "skin" && match?.character ? ` (${getCharacterDisplayName(match.character)})` : "";
  return `${match?.name || grant.id}${character}`;
}

function grantLabel(grant) {
  if (grant.kind === "currency") return `${fmt(grant.amount)} ${grant.currency}`;
  return `${COSMETIC_LABEL[grant.kind] || grant.kind}: ${cosmeticName(grant)}`;
}

// Mirrors resolveGrantDisplay in shopService so client cards match the shop.
function resolveGrant(grant) {
  if (grant.kind === "currency") {
    return { kind: "currency", currency: grant.currency, amount: Number(grant.amount) || 0, name: grant.currency === "gems" ? "Gems" : "Coins", image: `/assets/icons/${grant.currency === "gems" ? "gem" : "coin"}.webp` };
  }
  const option = optionsFor(grant.kind).find((entry) => entry.id === grant.id);
  if (!option) return { kind: grant.kind, id: grant.id, name: grant.id || "Missing", image: "/assets/icons/lock.webp" };
  if (grant.kind === "title") return { ...option, kind: "title", image: "/assets/shop/icons/profile-v2.webp" };
  return { kind: grant.kind, id: option.id, name: option.name, image: option.assetUrl, shopImage: option.shopImage || null, character: option.character, rarity: option.rarity };
}

function saleInfo(offer) {
  if (offer?.price?.type !== "virtual") return null;
  const price = getSalePrice(offer, store.draft);
  const percent = price.amount < offer.price.amount ? Math.round((offer.price.amount - price.amount) * 100 / offer.price.amount) : 0;
  return { price, percent };
}

// The shape the lobby shop renders, built from a draft offer (or daily reward).
function toShopItem(offer, { onSale = false, daily = false } = {}) {
  const item = {
    id: offer.id, kind: daily ? "daily" : offer.kind, name: offer.name || "Untitled", rarity: offer.rarity || "common",
    badge: offer.badge || null, banner: offer.banner || null, offerId: offer.id,
    price: daily ? { type: "free" } : offer.price, grants: (offer.grants || []).map(resolveGrant),
    state: { available: true, owned: false, purchased: false, claimed: false },
  };
  if (daily) return item;
  const { offerByGrant } = buildOfferIndexes(store.draft);
  const value = getBundleValue(offer, offerByGrant);
  if (onSale && offer.price?.type === "virtual") {
    const { price, percent } = saleInfo(offer);
    Object.assign(item, { price, originalPrice: percent ? offer.price : value?.cosmeticPrice || offer.price, discountPercent: percent || null, bundleValue: value });
  } else {
    Object.assign(item, { originalPrice: value?.cosmeticPrice || null, bundleValue: value });
  }
  return item;
}

function shopCard(offer, options = {}) {
  const holder = node("div", null, "shop-card-frame");
  const meta = { showRarity: !!sectionOf(options.daily ? "dailies" : options.onSale ? "sales" : offer.section)?.showRarity };
  holder.innerHTML = offerMarkup(toShopItem(offer, options), meta, 0);
  holder.querySelectorAll("button").forEach((el) => { el.tabIndex = -1; el.setAttribute("aria-hidden", "true"); });
  return holder;
}

function priceNode(price, struck = false) {
  const el = node("span", null, `price${struck ? " is-struck" : ""}`);
  if (!price) return el;
  if (price.type === "money") el.textContent = `$${(Number(price.amountCents || 0) / 100).toFixed(2)}`;
  else if (price.type === "free") el.textContent = "Free";
  else el.append(currencyIcon(price.currency, 16), document.createTextNode(fmt(price.amount)));
  return el;
}

function salePriceNode(offer) {
  const wrap = node("span", null, "sale-price");
  const info = saleInfo(offer);
  if (!info?.percent) { wrap.append(priceNode(offer.price)); return wrap; }
  wrap.append(priceNode(offer.price, true), priceNode(info.price), node("span", `-${info.percent}%`, "tag tag-discount"));
  return wrap;
}

// Where an offer appears this week: "sale", "shown", "hidden" (rotated out) or "sales-only".
function weeklyStatus(offer, ordinal = salesOrdinal()) {
  const saleIds = getSaleOfferIds(store.draft, { ordinal });
  if (saleIds.includes(offer.id)) return "sale";
  if (offer.section === "sales") return "hidden";
  const section = sectionOf(offer.section);
  if (isRotatingSection(section)) return getRotatingOfferIds(store.draft, { ordinal }, section.id, saleIds).includes(offer.id) ? "shown" : "hidden";
  return "shown";
}

function saleRole(id) {
  if (sales().pinnedOfferIds.includes(id)) return "pinned";
  if (sales().promotedOfferIds.includes(id)) return "pool";
  return "none";
}

function setSaleRole(id, role) {
  const config = sales();
  config.pinnedOfferIds = config.pinnedOfferIds.filter((x) => x !== id);
  config.promotedOfferIds = config.promotedOfferIds.filter((x) => x !== id);
  if (role === "pinned") config.pinnedOfferIds.push(id);
  if (role === "pool") config.promotedOfferIds.push(id);
}

// ---- Problems reported by the server, mapped back to what they belong to ----
function problemTarget(message) {
  let match = /^offers\[(\d+)\](?: \(([^)]+)\))?/.exec(message);
  if (match) return { type: "offer", id: match[2] || offers()[Number(match[1])]?.id };
  match = /^daily reward (\d+)/.exec(message);
  if (match) return { type: "daily", id: dailies()[Number(match[1])]?.id };
  match = /^sections\.([a-z0-9-]+)/.exec(message);
  if (match) return { type: "section", id: match[1] };
  match = /offer ([a-z0-9-]+)/.exec(message);
  if (/^rotation\.sales/.test(message)) return { type: "sales", id: match?.[1] };
  if (/^sections/.test(message)) return { type: "section" };
  return { type: "catalog" };
}

function problemText(message) {
  return message.replace(/^offers\[\d+\](?: \([^)]+\))?(\.[a-zA-Z[\]0-9.]+)?:\s*/, "").replace(/^daily reward \d+(\.[a-zA-Z[\]0-9.]+)?:\s*/, "").replace(/^sections\.[a-z0-9-]+:\s*/, "");
}

const problemsFor = (type, id) => store.errors.filter((message) => { const target = problemTarget(message); return target.type === type && target.id === id; });

function openProblem(message) {
  const target = problemTarget(message);
  if (target.type === "offer" && offerById(target.id)) return editOffer(offerById(target.id));
  if (target.type === "daily") { const reward = dailies().find((r) => r.id === target.id); if (reward) return editDaily(reward); }
  selectTab({ section: "sections", sales: "sales", daily: "dailies" }[target.type] || "offers");
}

// ---- Change tracking, live checks and draft recovery ----
function markChanged({ rerender = true } = {}) {
  const dirty = isStoreDirty();
  storage.set(DRAFT_KEY, dirty ? { revision: store.revision, draft: store.draft, savedAt: new Date().toISOString() } : null);
  store.onDirtyChange?.(dirty);
  renderPills();
  renderPublishBar();
  // The preview tab redraws once the server has rebuilt it.
  if (rerender && store.tab !== "preview") renderTab();
  scheduleCheck();
}

function scheduleCheck(delay = 450) {
  clearTimeout(store.checkTimer);
  store.checking = true;
  renderPills();
  store.checkTimer = setTimeout(runCheck, delay);
}

async function runCheck() {
  const generation = ++store.checkGeneration;
  try {
    const data = await fetchJson("/api/admin/shop/preview", { method: "POST", body: { catalog: store.draft, weeks: store.previewWeeks, days: store.previewDays } });
    if (generation !== store.checkGeneration) return;
    store.errors = data.errors || [];
    store.preview = data.previewError ? { error: data.previewError } : data;
    if (data.rotations) store.status = { ...store.status, rotations: data.rotations };
  } catch (error) {
    if (generation !== store.checkGeneration) return;
    store.preview = { error: error.message };
  }
  store.checking = false;
  renderPills();
  renderPublishBar();
  if (store.tab === "preview") renderTab();
  else refreshProblemMarks();
}

function refreshProblemMarks() {
  store.root.querySelectorAll("[data-problem-offer]").forEach((el) => {
    const count = problemsFor("offer", el.dataset.problemOffer).length;
    el.classList.toggle("has-problem", count > 0);
    const badge = el.querySelector(".problem-badge");
    if (badge) { badge.hidden = !count; badge.textContent = `${count} problem${count === 1 ? "" : "s"}`; }
  });
}

function offerDraftRestore() {
  const saved = storage.get(DRAFT_KEY);
  if (!saved?.draft) return;
  if (saved.revision !== store.revision) { storage.set(DRAFT_KEY, null); return; }
  if (JSON.stringify(saved.draft) === store.saved) return;
  const banner = node("div", null, "restore-banner");
  banner.append(
    node("span", `You have unpublished shop changes from ${timeAgo(saved.savedAt)}.`),
    button("Restore changes", "primary mini", () => { store.draft = saved.draft; banner.remove(); markChanged(); showToast("Unpublished changes restored"); }),
    button("Discard", "mini", () => { storage.set(DRAFT_KEY, null); banner.remove(); }),
  );
  store.root.insertBefore(banner, $(".store-tabs", store.root));
}

function changeSummary() {
  const before = JSON.parse(store.saved);
  const lines = [];
  const beforeOffers = new Map(before.offers.map((o) => [o.id, JSON.stringify(o)]));
  const afterOffers = new Map(offers().map((o) => [o.id, JSON.stringify(o)]));
  const added = [...afterOffers.keys()].filter((id) => !beforeOffers.has(id));
  const removed = [...beforeOffers.keys()].filter((id) => !afterOffers.has(id));
  const changed = [...afterOffers.keys()].filter((id) => beforeOffers.has(id) && beforeOffers.get(id) !== afterOffers.get(id));
  const names = (ids, list) => ids.map((id) => list.find((o) => o.id === id)?.name || id).join(", ");
  if (added.length) lines.push(`Added: ${names(added, offers())}`);
  if (changed.length) lines.push(`Edited: ${names(changed, offers())}`);
  if (removed.length) lines.push(`Removed: ${names(removed, before.offers)}`);
  if (JSON.stringify(before.rotation?.sales) !== JSON.stringify(sales())) lines.push("Weekly sale settings");
  if (JSON.stringify(before.rotation?.dailies) !== JSON.stringify(store.draft.rotation.dailies)) lines.push("Daily rewards");
  if (JSON.stringify(before.sections) !== JSON.stringify(sections())) lines.push("Shop sections");
  if (before.offers.map((o) => o.id).join() !== offers().map((o) => o.id).join() && !added.length && !removed.length) lines.push("Offer order");
  return lines;
}

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
    const data = await fetchJson("/api/admin/shop/catalog", { method: "PUT", body: { catalog: store.draft, revision: store.revision } });
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

// ---- Offers ----
function renderOffers() {
  const wrap = node("div", null, "store-panel");
  const bar = node("div", null, "store-toolbar");
  const chips = node("div", null, "segmented");
  const filters = [["all", "All"], ...sections().filter((s) => s.id !== "dailies").map((s) => [s.id, s.name])];
  for (const [id, label] of filters) {
    const count = id === "all" ? offers().length : offers().filter((o) => o.section === id).length;
    const chip = button(`${label} ${count}`, id === store.filter ? "is-active" : "", () => { store.filter = id; renderTab(); });
    chips.append(chip);
  }
  const search = input("search", store.query, { placeholder: "Search offers…", "aria-label": "Search offers" });
  search.addEventListener("input", () => { store.query = search.value; draw(); });
  const show = select([["all", "Everything"], ["sale", "On sale this week"], ["shown", "In the shop this week"], ["hidden", "Not shown this week"], ["problems", "Has problems"], ["money", "Real money"]], store.show);
  show.setAttribute("aria-label", "Show");
  show.classList.add("compact-select");
  show.addEventListener("change", () => { store.show = show.value; draw(); });
  const layout = node("div", null, "segmented");
  for (const [id, label] of [["cards", "Cards"], ["table", "Table"]]) {
    layout.append(button(label, store.layout === id ? "is-active" : "", () => { store.layout = id; storage.set(PREFS_KEY, { tab: store.tab, layout: id }); renderTab(); }));
  }
  bar.append(chips, search, show, node("span", null, "spacer"), layout, button("+ New offer", "primary", () => editOffer(null)));
  const host = node("div");
  wrap.append(bar, host);

  function visible() {
    const query = store.query.trim().toLowerCase();
    return offers().filter((o) => {
      if (store.filter !== "all" && o.section !== store.filter) return false;
      if (query && !`${o.name} ${o.id} ${(o.grants || []).map(grantLabel).join(" ")}`.toLowerCase().includes(query)) return false;
      if (store.show === "problems") return problemsFor("offer", o.id).length > 0;
      if (store.show === "money") return o.price?.type === "money";
      if (store.show === "sale") return weeklyStatus(o) === "sale";
      if (store.show === "shown") return weeklyStatus(o) !== "hidden";
      if (store.show === "hidden") return weeklyStatus(o) === "hidden";
      return true;
    });
  }

  function draw() {
    const list = visible();
    host.replaceChildren(store.layout === "table" ? offerTable(list) : offerCards(list));
    if (!list.length) host.append(node("p", offers().length ? "No offers match these filters." : "No offers yet. Add the first one.", "muted pad"));
    refreshProblemMarks();
  }
  draw();
  return wrap;
}

const STATUS_FLAG = { sale: ["On sale this week", "is-sale"], shown: ["In the shop this week", "is-shown"], hidden: ["Not shown this week", "is-hidden"] };

function offerCards(list) {
  const grid = node("div", null, "offer-grid");
  for (const offer of list) {
    const holder = node("div", null, "offer-holder");
    holder.dataset.problemOffer = offer.id;
    const status = weeklyStatus(offer);
    const meta = node("div", null, "offer-meta");
    meta.append(node("span", sectionName(offer.section), "tag"), node("span", STATUS_FLAG[status][0], `tag status-flag ${STATUS_FLAG[status][1]}`));
    if (saleRole(offer.id) === "pinned") meta.append(node("span", "Pinned sale", "tag status-flag is-sale"));
    const badge = node("span", "", "tag problem-badge");
    badge.hidden = true;
    meta.append(badge);
    const card = shopCard(offer, { onSale: status === "sale" });
    card.classList.add("is-clickable");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Edit ${offer.name}`);
    card.addEventListener("click", () => editOffer(offer));
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); editOffer(offer); } });
    const actions = node("div", null, "offer-actions");
    actions.append(
      button("Edit", "mini", () => editOffer(offer)),
      button("Duplicate", "mini", () => duplicateOffer(offer)),
      button("Delete", "mini danger", () => deleteOffer(offer)),
    );
    holder.append(meta, card, actions);
    grid.append(holder);
  }
  return grid;
}

function offerTable(list) {
  const wrap = node("div", null, "panel table-panel");
  const scroll = node("div", null, "table-wrap");
  const table = node("table", null, "offer-table");
  table.innerHTML = "<thead><tr><th></th><th>Offer</th><th>Section</th><th>Rewards</th><th>Price</th><th>Sale</th><th>This week</th><th>Order</th><th></th></tr></thead><tbody></tbody>";
  for (const offer of list) {
    const tr = node("tr");
    tr.dataset.problemOffer = offer.id;
    const thumb = node("img", null, "order-thumb");
    thumb.src = offer.banner || ""; thumb.alt = "";
    const nameCell = node("td");
    const name = node("div", null, "offer-name-cell");
    nameCell.append(name);
    const open = button(null, "row-link", () => editOffer(offer));
    open.append(node("strong", offer.name));
    name.append(open, node("small", offer.id, "muted mono"));
    const badge = node("span", "", "tag problem-badge");
    badge.hidden = true;
    name.append(badge);

    const section = select(sections().filter((s) => s.id !== "dailies").map((s) => [s.id, s.name]), offer.section);
    section.setAttribute("aria-label", `Section for ${offer.name}`);
    section.addEventListener("change", () => {
      offer.section = section.value;
      if (offer.section === "sales" && saleRole(offer.id) === "none") setSaleRole(offer.id, "pinned");
      markChanged();
    });

    const price = node("td");
    const priceBox = node("div", null, "price-cell");
    price.append(priceBox);
    if (offer.price?.type === "money") priceBox.append(priceNode(offer.price));
    else {
      const amount = input("number", offer.price.amount, { min: "1", step: "1", "aria-label": `Price of ${offer.name}` });
      amount.addEventListener("change", () => { offer.price.amount = Math.max(1, Math.floor(Number(amount.value) || 1)); amount.value = offer.price.amount; markChanged(); });
      priceBox.append(currencyIcon(offer.price.currency, 18), amount);
    }

    const sale = node("td");
    if (offer.price?.type === "virtual") {
      const role = select([["none", "Not on sale"], ["pinned", "Always (pinned)"], ["pool", "Rotation pool"]], saleRole(offer.id));
      role.setAttribute("aria-label", `Sale for ${offer.name}`);
      role.addEventListener("change", () => {
        if (role.value === "none" && offer.section === "sales") { role.value = saleRole(offer.id); showToast("Sales-section offers must stay on sale. Move it to another section first.", true); return; }
        setSaleRole(offer.id, role.value);
        markChanged();
      });
      sale.append(role);
      const info = saleInfo(offer);
      if (saleRole(offer.id) !== "none" && info) sale.append(node("small", info.percent ? `${fmt(info.price.amount)} on sale (−${info.percent}%)` : "No discount", "muted"));
    } else sale.append(node("span", "—", "muted"));

    const status = weeklyStatus(offer);
    const statusCell = node("td");
    statusCell.append(node("span", STATUS_FLAG[status][0], `tag status-flag ${STATUS_FLAG[status][1]}`));

    const order = node("div", null, "order-cell");
    const siblings = offers().filter((o) => o.section === offer.section);
    const position = siblings.indexOf(offer);
    const move = (delta) => {
      const target = siblings[position + delta];
      const all = offers();
      const a = all.indexOf(offer), b = all.indexOf(target);
      [all[a], all[b]] = [all[b], all[a]];
      markChanged();
    };
    const up = arrowButton("up", () => move(-1));
    const down = arrowButton("down", () => move(1));
    up.disabled = position <= 0;
    down.disabled = position >= siblings.length - 1;
    order.append(up, down);

    const actions = node("div", null, "row-actions");
    actions.append(button("Edit", "mini", () => editOffer(offer)), button("Delete", "mini danger", () => deleteOffer(offer)));
    const orderCell = node("td");
    orderCell.append(order);
    const actionsCell = node("td");
    actionsCell.append(actions);
    const cells = [node("td"), nameCell, node("td"), node("td", (offer.grants || []).map(grantLabel).join(", "), "grants-cell"), price, sale, statusCell, orderCell, actionsCell];
    cells[0].append(thumb);
    cells[2].append(section);
    tr.append(...cells);
    table.tBodies[0].append(tr);
  }
  scroll.append(table);
  wrap.append(scroll);
  return wrap;
}

function arrowButton(direction, onClick) {
  const el = button(null, "mini arrow", onClick);
  el.setAttribute("aria-label", `Move ${direction}`);
  el.append(pixelArrow(direction, "sm"));
  return el;
}

function duplicateOffer(offer) {
  const copy = clone(offer);
  copy.id = uniqueId(`${offer.id}-copy`, allIds());
  copy.name = `${offer.name} (copy)`;
  // Only one single-item offer may sell a cosmetic, so the copy becomes a bundle.
  if (copy.kind === "item") copy.kind = "bundle";
  delete copy.eligibility;
  offers().splice(offers().indexOf(offer) + 1, 0, copy);
  if (copy.section === "sales") setSaleRole(copy.id, "pinned");
  markChanged();
  editOffer(copy);
}

async function deleteOffer(offer) {
  if (!await confirmDialog({ title: `Delete ${offer.name}?`, message: "It leaves the shop when you publish. Past orders keep their records.", confirmLabel: "Delete", danger: true })) return false;
  store.draft.offers = offers().filter((o) => o !== offer);
  setSaleRole(offer.id, "none");
  markChanged();
  return true;
}

// ---- Rewards editor shared by offers and daily rewards ----
function grantsEditor(grants, onChange, { currencyOnly = false } = {}) {
  const box = node("div", null, "grants-editor");
  function draw() {
    box.replaceChildren();
    grants.forEach((grant, index) => {
      const row = node("div", null, "grant-edit-row");
      const kindValue = grant.kind === "currency" ? grant.currency : grant.kind;
      const kind = select(GRANT_KINDS.filter(([id]) => !currencyOnly || ["coins", "gems"].includes(id) || id === kindValue), kindValue);
      kind.setAttribute("aria-label", "Reward type");
      kind.addEventListener("change", () => {
        grants[index] = ["coins", "gems"].includes(kind.value)
          ? { kind: "currency", currency: kind.value, amount: grant.kind === "currency" ? grant.amount : kind.value === "gems" ? 50 : 500 }
          : { kind: kind.value, id: unsoldCosmetic(kind.value) };
        draw(); onChange();
      });
      row.append(kind);
      if (grant.kind === "currency") {
        const label = node("label", null, "grant-amount-field");
        const amount = input("number", grant.amount, { min: "1", step: "1", "aria-label": "Amount" });
        amount.addEventListener("input", () => { grants[index].amount = Math.max(0, Math.floor(Number(amount.value) || 0)); onChange(); });
        label.append(currencyIcon(grant.currency, 20), amount);
        row.append(label);
      } else {
        const choose = button(null, "cosmetic-choice", () => pickCosmetic(grant.kind, grant.id, (id) => { grants[index].id = id; draw(); onChange(); }));
        choose.setAttribute("aria-label", `${COSMETIC_LABEL[grant.kind]}: ${cosmeticName(grant)}. Change`);
        choose.append(cosmeticThumb(grant.kind, grant.id), node("span", cosmeticName(grant)), node("small", "Change", "muted"));
        row.append(choose);
      }
      const remove = button("×", "mini danger", () => { grants.splice(index, 1); draw(); onChange(); });
      remove.setAttribute("aria-label", "Remove reward");
      row.append(remove);
      box.append(row);
    });
    const add = node("div", null, "grant-add");
    add.append(node("span", "Add", "field-label"));
    for (const [id, label] of GRANT_KINDS.filter(([id]) => !currencyOnly || ["coins", "gems"].includes(id))) {
      add.append(button(`+ ${label}`, "mini", () => {
        grants.push(["coins", "gems"].includes(id) ? { kind: "currency", currency: id, amount: id === "gems" ? 50 : 500 } : { kind: id, id: unsoldCosmetic(id) });
        draw(); onChange();
      }));
    }
    box.append(add);
  }
  draw();
  return { element: box, redraw: draw };
}

function cosmeticThumb(kind, id) {
  const holder = node("span", null, `cosmetic-thumb kind-${kind}`);
  if (kind === "title") holder.innerHTML = titleMarkup(id);
  else {
    const img = node("img");
    img.src = optionsFor(kind).find((o) => o.id === id)?.assetUrl || "/assets/icons/lock.webp";
    img.alt = "";
    img.loading = "lazy";
    holder.append(img);
  }
  return holder;
}

// Which offers grant each cosmetic, for "already sold" hints.
function cosmeticSellers(kind) {
  const map = new Map();
  for (const offer of offers()) for (const grant of offer.grants || []) if (grant.kind === kind) map.set(grant.id, [...(map.get(grant.id) || []), offer]);
  return map;
}

// First cosmetic of a kind that no offer sells yet (skipping free defaults).
function unsoldCosmetic(kind) {
  const sold = cosmeticSellers(kind);
  const choices = optionsFor(kind).filter((o) => o.id !== "default" && !/-default$/.test(o.id));
  return (choices.find((o) => !sold.has(o.id)) || choices[0] || optionsFor(kind)[0])?.id || "";
}

function pickCosmetic(kind, current, onPick) {
  const sellers = cosmeticSellers(kind);
  let query = "", unsoldOnly = false;
  const modal = openModal(`Choose a ${COSMETIC_LABEL[kind].toLowerCase()}`, { wide: true, submitLabel: "Close", cancelLabel: "", dismissible: true });
  const bar = node("div", null, "store-toolbar");
  const search = input("search", "", { placeholder: `Search ${COSMETIC_LABEL[kind].toLowerCase()}s…`, "aria-label": "Search" });
  const unsold = Object.assign(node("input"), { type: "checkbox" });
  const unsoldLabel = node("label", null, "check");
  unsoldLabel.append(unsold, node("span", "Only ones not sold yet"));
  bar.append(search, unsoldLabel);
  const grid = node("div", null, "cosmetic-grid");
  function draw() {
    const q = query.toLowerCase();
    grid.replaceChildren();
    for (const option of optionsFor(kind)) {
      const sold = sellers.get(option.id) || [];
      if (unsoldOnly && sold.length) continue;
      if (q && !`${option.name} ${option.id} ${option.character || ""}`.toLowerCase().includes(q)) continue;
      const tile = button(null, `cosmetic-tile rarity-${option.rarity || "common"}${option.id === current ? " is-active" : ""}`, () => { onPick(option.id); modal.close(); });
      const caption = node("span", null, "cosmetic-caption");
      caption.append(node("strong", option.name), node("small", [option.character && getCharacterDisplayName(option.character), option.rarity].filter(Boolean).join(" · "), "muted"));
      tile.append(cosmeticThumb(kind, option.id), caption);
      if (sold.length) {
        const tag = node("span", `Sold in ${sold.length === 1 ? sold[0].name : `${sold.length} offers`}`, "tag sold-tag");
        tag.title = sold.map((o) => o.name).join(", ");
        tile.append(tag);
      }
      grid.append(tile);
    }
    if (!grid.children.length) grid.append(node("p", "Nothing matches.", "muted pad"));
  }
  search.addEventListener("input", () => { query = search.value.trim(); draw(); });
  unsold.addEventListener("change", () => { unsoldOnly = unsold.checked; draw(); });
  modal.body.append(bar, grid);
  draw();
  search.focus();
}

function bannerPicker(current, onPick, related = []) {
  const wrap = node("div", null, "banner-picker-wrap");
  const search = input("search", "", { placeholder: "Filter banners…", "aria-label": "Filter banners" });
  const grid = node("div", null, "banner-picker");
  const words = related.map((word) => slug(word)).filter(Boolean);
  // Banners whose file name matches the offer's rewards come first.
  const score = (src) => words.some((word) => src.includes(word)) ? 0 : 1;
  const list = [...store.options.banners].sort((a, b) => score(a) - score(b));
  function draw() {
    const q = search.value.trim().toLowerCase();
    grid.replaceChildren();
    for (const src of list.filter((s) => !q || s.toLowerCase().includes(q))) {
      const choice = button(null, `banner-choice${src === current ? " is-active" : ""}`, () => {
        current = src;
        grid.querySelectorAll(".banner-choice").forEach((el) => el.classList.toggle("is-active", el === choice));
        onPick(src);
      });
      choice.title = src.split("/").pop();
      choice.setAttribute("aria-label", `Banner ${choice.title}`);
      choice.append(Object.assign(node("img"), { src, alt: "", loading: "lazy" }));
      grid.append(choice);
    }
  }
  search.addEventListener("input", draw);
  draw();
  wrap.append(search, grid);
  return wrap;
}

function segmented(options, value, onChange) {
  const wrap = node("div", null, "segmented");
  const buttons = options.map(([id, label, disabled]) => {
    const el = button(label, id === value ? "is-active" : "", () => {
      if (el.disabled) return;
      buttons.forEach((b) => b.classList.toggle("is-active", b === el));
      onChange(id);
    });
    el.dataset.value = id;
    if (disabled) { el.disabled = true; el.title = disabled; }
    return el;
  });
  wrap.append(...buttons);
  return wrap;
}

// ---- Offer editor ----
function allowedKinds(draft) {
  const grants = draft.grants || [];
  const cosmetics = grants.filter((g) => g.kind !== "currency");
  const one = grants.length === 1 && cosmetics.length === 1 ? cosmetics[0] : null;
  const taken = one && offers().some((o) => o.id !== draft.id && o.kind === "item" && o.grants?.length === 1 && o.grants[0].kind === one.kind && o.grants[0].id === one.id);
  return {
    item: !one ? "Needs exactly one cosmetic and nothing else" : taken ? "Another single-item offer already sells this cosmetic" : null,
    bundle: !grants.length ? "Add rewards first" : null,
    "currency-pack": !grants.length || cosmetics.length ? "Coins or gems only" : null,
  };
}

function suggestedKind(draft) {
  const blocked = allowedKinds(draft);
  if (!blocked[draft.kind]) return draft.kind;
  return !blocked.item ? "item" : !blocked["currency-pack"] ? "currency-pack" : "bundle";
}

function editOffer(existing) {
  const isNew = !existing;
  const firstSection = sections().find((s) => !["sales", "dailies"].includes(s.id))?.id || "currency";
  const draft = existing ? clone(existing) : {
    id: "", section: store.filter !== "all" && store.filter !== "sales" ? store.filter : firstSection, kind: "item", name: "", description: "",
    rarity: "common", banner: store.options.banners[0] || "", price: { type: "virtual", currency: "gems", amount: 49 }, purchaseLimit: "lifetime",
    grants: [{ kind: "card", id: unsoldCosmetic("card") }],
  };
  let role = existing ? saleRole(existing.id) : "none";
  let previewSale = role === "pinned";

  const preview = node("div", null, "offer-preview");
  const previewMode = segmented([["regular", "Regular"], ["sale", "On sale"]], previewSale ? "sale" : "regular", (mode) => { previewSale = mode === "sale"; drawPreview(); });
  const previewCard = node("div");
  const previewNote = node("p", null, "hint");
  preview.append(node("span", "Preview", "field-label"), previewMode, previewCard, previewNote);
  function drawPreview() {
    const saleable = draft.price.type === "virtual";
    previewMode.querySelector('[data-value="sale"]').disabled = !saleable;
    if (!saleable) previewSale = false;
    previewMode.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b.dataset.value === (previewSale ? "sale" : "regular")));
    previewCard.replaceChildren(shopCard(draft, { onSale: previewSale }));
    const status = existing ? weeklyStatus({ ...draft, id: existing.id }) : null;
    previewNote.textContent = status ? `${STATUS_FLAG[status][0]} · ${sectionName(draft.section)}` : `Goes in ${sectionName(draft.section)}`;
  }

  // Identity
  const name = input("text", draft.name, { maxlength: "60", required: "", placeholder: "e.g. Sky Duck" });
  const id = input("text", draft.id, { pattern: "[a-z0-9][a-z0-9\\-]{1,63}", required: "", spellcheck: "false" });
  id.disabled = !isNew;
  let idTouched = !isNew;
  name.addEventListener("input", () => { draft.name = name.value; if (!idTouched) { draft.id = uniqueId(slug(name.value), allIds()); id.value = draft.id; } drawPreview(); });
  id.addEventListener("input", () => { idTouched = true; draft.id = id.value.trim(); });
  const description = node("textarea");
  description.value = draft.description || ""; description.maxLength = 200; description.rows = 2;
  description.placeholder = "One short line shown in the purchase dialog";
  description.addEventListener("input", () => { draft.description = description.value; });
  const section = select(sections().filter((s) => s.id !== "dailies").map((s) => [s.id, s.name]), draft.section);
  const sectionHint = node("small", null, "hint");
  const drawSectionHint = () => {
    const meta = sectionOf(draft.section);
    sectionHint.textContent = draft.section === "sales" ? "Sales-section offers must stay on sale (pinned or in the pool)."
      : isRotatingSection(meta) ? `Rotates weekly: ${getSectionRotationSize(meta)} of this section's offers show each week.` : "";
  };
  section.addEventListener("change", () => {
    draft.section = section.value;
    if (draft.section === "sales" && role === "none") { role = "pinned"; drawSales(); }
    drawSectionHint(); drawPreview();
  });
  const rarity = segmented(RARITIES.map((r) => [r, titleCase(r)]), draft.rarity || "common", (value) => { draft.rarity = value; drawPreview(); });
  rarity.classList.add("rarity-segmented");
  const badge = input("text", draft.badge || "", { maxlength: "16", placeholder: "e.g. BEST VALUE" });
  badge.addEventListener("input", () => { if (badge.value.trim()) draft.badge = badge.value.trim().toUpperCase(); else delete draft.badge; drawPreview(); });

  // Type follows the rewards: only valid choices are enabled.
  const kindHost = node("div");
  const kindHint = node("small", null, "hint");
  function drawKind() {
    draft.kind = suggestedKind(draft);
    const blocked = allowedKinds(draft);
    kindHost.replaceChildren(segmented(Object.entries(KINDS).map(([value, label]) => [value, label, blocked[value]]), draft.kind, (value) => { draft.kind = value; drawKind(); drawPrice(); drawPreview(); }));
    kindHint.textContent = { item: "One cosmetic sold on its own. Bundles use its price to show their value.", bundle: "Several rewards for one price. The card shows their combined value.", "currency-pack": "Coins or gems only. The only type that can cost real money." }[draft.kind];
  }

  // Rewards
  const grants = grantsEditor(draft.grants, () => { drawKind(); drawPrice(); drawEligibility(); drawPreview(); });

  // Price
  const priceHost = node("div");
  const amount = input("number", "", { min: "0", step: "1", "aria-label": "Price" });
  const amountLabel = node("span");
  const valueHint = node("small", null, "hint");
  const limit = segmented([["lifetime", "Once per player"], ["unlimited", "Unlimited"]], draft.purchaseLimit, (value) => { draft.purchaseLimit = value; });
  function drawPrice() {
    const money = draft.price.type === "money";
    if (money && draft.kind !== "currency-pack") draft.price = { type: "virtual", currency: "gems", amount: 49 };
    const priceType = segmented([["gems", "Gems"], ["coins", "Coins"], ["money", "Real money", draft.kind === "currency-pack" ? null : "Only currency packs can cost real money"]],
      draft.price.type === "money" ? "money" : draft.price.currency,
      (value) => {
        draft.price = value === "money" ? { type: "money", currency: "usd", amountCents: draft.price.amountCents || 99 } : { type: "virtual", currency: value, amount: draft.price.amount || 49 };
        drawPrice(); drawSales(); drawEligibility(); drawPreview();
      });
    priceHost.replaceChildren(priceType);
    const isMoney = draft.price.type === "money";
    amountLabel.textContent = isMoney ? "Price in US dollars" : `Price in ${draft.price.currency}`;
    amount.step = isMoney ? "0.01" : "1";
    amount.min = isMoney ? "0.50" : "1";
    amount.value = isMoney ? (Number(draft.price.amountCents || 0) / 100).toFixed(2) : draft.price.amount;
    if (isMoney) { draft.purchaseLimit = "unlimited"; delete draft.eligibility; }
    limit.querySelectorAll("button").forEach((b) => { b.disabled = isMoney && b.dataset.value === "lifetime"; b.classList.toggle("is-active", b.dataset.value === draft.purchaseLimit); });
    const { offerByGrant } = buildOfferIndexes({ ...store.draft, offers: offers().filter((o) => o.id !== draft.id) });
    const value = getBundleValue(draft, offerByGrant);
    valueHint.textContent = value?.cosmeticPrice?.amount ? `Bought separately: ${fmt(value.cosmeticPrice.amount)} ${draft.price.currency}${Object.entries(value.bonusCurrencies).map(([c, a]) => ` + ${fmt(a)} ${c}`).join("")}` : "";
  }
  amount.addEventListener("input", () => {
    if (draft.price.type === "money") draft.price.amountCents = Math.round((Number(amount.value) || 0) * 100);
    else draft.price.amount = Math.max(0, Math.floor(Number(amount.value) || 0));
    drawSales(); drawPreview();
  });

  // Weekly sale
  const salesHost = node("div", null, "editor-sales");
  function drawSales() {
    salesHost.replaceChildren();
    if (draft.price.type !== "virtual") { role = "none"; salesHost.append(node("p", "Real-money offers can't go on sale.", "hint")); return; }
    const lockedOn = draft.section === "sales";
    salesHost.append(segmented([["none", "Not on sale", lockedOn ? "Sales-section offers must stay on sale" : null], ["pinned", "Every week"], ["pool", "In the rotation"]], role, (value) => { role = value; previewSale = value !== "none"; drawSales(); drawPreview(); }));
    const defaultPercent = sales().discountPercent;
    const discount = input("number", draft.saleDiscountPercent ?? "", { min: "0", max: "90", step: "1", placeholder: draft.kind === "bundle" ? "0 (bundles)" : `${defaultPercent} (default)`, "aria-label": "Sale discount percent" });
    discount.addEventListener("input", () => {
      if (discount.value === "") delete draft.saleDiscountPercent;
      else draft.saleDiscountPercent = Math.max(0, Math.min(90, Math.floor(Number(discount.value) || 0)));
      salePrice.textContent = describeSale(); drawPreview();
    });
    const salePrice = node("small", describeSale(), "hint");
    const row = node("div", null, "field-row");
    row.append(field("Sale discount %", discount, "Empty uses the weekly default. Bundles default to no discount."), node("div", null, "sale-result"));
    row.lastChild.append(node("span", "Sale price", "field-label"), salePrice);
    salesHost.append(row);
    if (role === "pool") {
      const pool = sales().promotedOfferIds;
      const position = existing ? pool.indexOf(existing.id) : -1;
      const perWeek = `${sales().promotedCount} of ${pool.length + (position < 0 ? 1 : 0)} pool offers go on sale each week.`;
      salesHost.append(node("small", position < 0 ? `Joins the end of the rotation pool. ${perWeek}` : `Number ${position + 1} in the rotation pool. ${perWeek}`, "hint"));
    }
  }
  function describeSale() {
    const info = saleInfo(draft);
    return info?.percent ? `${fmt(info.price.amount)} ${draft.price.currency} (${info.percent}% off ${fmt(draft.price.amount)})` : "Same as the regular price";
  }

  // Ownership rule
  const eligibilityHost = node("div");
  function drawEligibility() {
    const cosmetics = draft.grants.filter((g) => g.kind !== "currency");
    eligibilityHost.replaceChildren();
    if (draft.price.type === "money" || !cosmetics.length) { delete draft.eligibility; eligibilityHost.append(node("small", "Only offers with cosmetics can be blocked by ownership.", "hint")); return; }
    const current = draft.eligibility?.requiresNotOwned;
    const valid = current && cosmetics.some((g) => g.kind === current.kind && g.id === current.id);
    if (current && !valid) delete draft.eligibility;
    const options = [["", "Always available"], ...cosmetics.map((g) => [`${g.kind}:${g.id}`, `Not if they own ${cosmeticName(g)}`])];
    const choose = select(options, valid ? `${current.kind}:${current.id}` : "");
    choose.addEventListener("change", () => {
      if (!choose.value) delete draft.eligibility;
      else { const [kind, ...rest] = choose.value.split(":"); draft.eligibility = { requiresNotOwned: { kind, id: rest.join(":") } }; }
    });
    eligibilityHost.append(field("Availability", choose, "Hide a bundle from players who already own its main cosmetic."));
  }

  const problemsHost = node("div");
  if (existing) {
    const found = problemsFor("offer", existing.id);
    if (found.length) {
      const box = node("div", null, "editor-problems");
      box.append(node("strong", "Fix before publishing"));
      const list = node("ul");
      for (const message of found) list.append(node("li", problemText(message)));
      box.append(list);
      problemsHost.append(box);
    }
  }

  const modal = openModal(isNew ? "New offer" : `Edit ${existing.name}`, {
    wide: true,
    submitLabel: isNew ? "Add offer" : "Apply",
    extraActions: existing ? [
      { label: "Delete", className: "danger", run: async (close) => { if (await deleteOffer(existing)) close(); } },
      { label: "Duplicate", run: (close) => { close(); duplicateOffer(existing); } },
    ] : [],
    onSubmit: () => {
      draft.name = draft.name.trim();
      if (!draft.name) throw new Error("Give the offer a name.");
      if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(draft.id)) throw new Error("The ID needs 2–64 lowercase letters, numbers or dashes.");
      if (isNew && allIds().has(draft.id)) throw new Error("That ID is already used.");
      if (!draft.grants.length) throw new Error("Add at least one reward.");
      if (draft.grants.some((g) => g.kind === "currency" && !(g.amount > 0))) throw new Error("Currency rewards need an amount above zero.");
      if (draft.price.type === "money" ? draft.price.amountCents < 50 : !(draft.price.amount > 0)) throw new Error("Set a price (at least $0.50 for real money).");
      const blocked = allowedKinds(draft)[draft.kind];
      if (blocked) throw new Error(`${KINDS[draft.kind]}: ${blocked}.`);
      if (draft.section === "sales" && role === "none") throw new Error("Offers in the Sales section must be on sale every week or in the rotation.");
      if (!draft.description) delete draft.description;
      if (isNew) offers().push(draft);
      else offers()[offers().indexOf(existing)] = draft;
      if (saleRole(draft.id) !== role) setSaleRole(draft.id, role);
      markChanged();
      showToast(isNew ? `Added ${draft.name}` : `Updated ${draft.name}`);
    },
  });

  const form = node("div", null, "editor-grid");
  const left = node("div", null, "editor-fields");
  const row = (...children) => { const r = node("div", null, "field-row"); r.append(...children); return r; };
  const group = (title, ...children) => { const g = node("fieldset", null, "editor-group"); g.append(node("legend", title), ...children); return g; };
  const amountField = node("label", null, "field");
  amountField.append(amountLabel, amount, valueHint);
  const sectionField = field("Section", section);
  sectionField.append(sectionHint);
  const typeField = node("div", null, "field");
  typeField.append(node("span", "Type", "field-label"), kindHost, kindHint);
  const priceField = node("div", null, "field");
  priceField.append(node("span", "Paid with", "field-label"), priceHost);
  const limitField = node("div", null, "field");
  limitField.append(node("span", "Purchase limit", "field-label"), limit);
  const rarityField = node("div", null, "field");
  rarityField.append(node("span", "Rarity", "field-label"), rarity);
  left.append(
    problemsHost,
    group("Basics", row(field("Name", name), field("ID", id, isNew ? "Used in orders and can't change later." : "IDs can't change after creation.")), field("Description", description), row(sectionField, field("Badge", badge, "Optional corner label.")), rarityField),
    group("Rewards", grants.element, typeField),
    group("Price", row(priceField, amountField), row(limitField, eligibilityHost)),
    group("Weekly sale", salesHost),
    group("Banner", bannerPicker(draft.banner, (src) => { draft.banner = src; drawPreview(); }, [draft.name, ...draft.grants.map((g) => g.id || g.currency)])),
  );
  form.append(left, preview);
  modal.body.append(form);
  drawKind();
  drawPrice();
  drawSales();
  drawEligibility();
  drawSectionHint();
  drawPreview();
  name.focus();
}

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
    await fetchJson("/api/admin/shop/refresh", { method: "POST", body: { section } });
    await loadStatus();
    showToast(section === "sales" ? "Week rotated" : "Daily reward advanced");
    renderTab();
    scheduleCheck(0);
  } catch (error) { showToast(error.message, true); }
}

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

// ---- Orders & payments ----
function renderPayments() {
  const wrap = node("div", null, "store-panel payments-grid");
  const payment = store.status?.payment || {};
  const stripe = node("article", null, "panel");
  stripe.append(node("div", "Stripe payments", "panel-title"));
  stripe.append(node("p", payment.enabled ? "Stripe is configured. Real-money offers can be bought." : "Stripe is off, so real-money offers show as unavailable.", payment.enabled ? "good-text" : "bad-text"));
  if (payment.listener) stripe.append(node("p", payment.listener.message, payment.listener.state === "listening" ? "good-text" : "hint"));
  stripe.append(button("Refresh status", "", async () => {
    try { await loadStatus(); renderPills(); renderTab(); showToast("Payment status refreshed"); } catch (error) { showToast(error.message, true); }
  }));
  if (payment.missing?.length) {
    stripe.append(node("p", "Add these to the server's environment and restart:", "hint"));
    const list = node("ul", null, "plain-list");
    for (const key of payment.missing) list.append(node("li", key, "mono"));
    stripe.append(list);
  }
  const money = offers().filter((o) => o.price?.type === "money");
  stripe.append(node("span", "Real-money offers", "field-label"));
  const moneyList = node("ul", null, "recent-list");
  for (const offer of money) {
    const li = node("li");
    li.append(button(offer.name, "row-link", () => editOffer(offer)), node("span", (offer.grants || []).map(grantLabel).join(", "), "muted"), priceNode(offer.price));
    moneyList.append(li);
  }
  if (!money.length) moneyList.append(node("li", "None", "muted"));
  stripe.append(moneyList);

  const orders = node("article", null, "panel");
  orders.append(node("div", "Recent orders", "panel-title"));
  const rows = store.status?.recentOrders || [];
  if (!rows.length) orders.append(node("p", store.status?.error || "No orders yet.", "muted"));
  else {
    const table = node("table");
    table.innerHTML = "<thead><tr><th>Offer</th><th>Player</th><th>Status</th><th>Amount</th><th>Created</th><th>Fulfilled</th></tr></thead><tbody></tbody>";
    for (const order of rows) {
      const tr = node("tr");
      const player = node("td");
      if (store.openPlayer) player.append(button(`#${order.user_id}`, "row-link", () => store.openPlayer(order.user_id)));
      else player.textContent = `#${order.user_id}`;
      const status = node("td");
      status.append(node("span", order.status, `tag tag-${order.status}`));
      tr.append(node("td", offerById(order.offer_id)?.name || order.offer_id), player, status, node("td", `$${(Number(order.amount_cents || 0) / 100).toFixed(2)} ${String(order.currency || "usd").toUpperCase()}`), node("td", formatAdminDate(order.created_at, true)), node("td", formatAdminDate(order.fulfilled_at, true)));
      table.tBodies[0].append(tr);
    }
    const scroll = node("div", null, "table-wrap");
    scroll.append(table);
    orders.append(scroll);
  }
  wrap.append(stripe, orders);
  return wrap;
}
