import { RARITIES } from "../../../shared/catalogs/rarities.js";
import { API_PATHS } from "../../../shared/net/apiPaths.js";
import { readJson, remove, writeJson } from "../../lib/safeStorage.js";
import { offerMarkup } from "../../lobby/shop/shopMarkup.js";
import { getCharacterDisplayName } from "../../../shared/characters/characterStats.js";
import { $, node, button, fmt, currencyIcon, fetchJson, timeAgo, showToast } from "../common";
import { getSaleOfferIds, getSalePrice, getBundleValue, buildOfferIndexes, getRotatingOfferIds, isRotatingSection } from "../../../server/services/shop/shopOfferRules";
import { render, selectTab, renderPills, renderPublishBar, renderTab } from "./shopShell";
import { editOffer } from "./offerEditor";
import { editDaily } from "./dailies";

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
  get(key) { return readJson(() => localStorage, key); },
  set(key, value) {
    if (value == null) remove(() => localStorage, key);
    else writeJson(() => localStorage, key, value);
  },
};

const isStoreDirty = () => !!store.draft && JSON.stringify(store.draft) !== store.saved;

function setStorePlayerOpener(open) { store.openPlayer = open; }

function onStoreDirtyChange(listener) { store.onDirtyChange = listener; }

async function initStore(root) {
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
  const data = await fetchJson(API_PATHS.API_ADMIN_SHOP_CATALOG);
  store.draft = data.catalog;
  store.saved = JSON.stringify(data.catalog);
  store.revision = data.revision;
  store.options = data.options;
  store.errors = data.errors || [];
}

async function loadStatus() {
  store.status = await fetchJson(API_PATHS.API_ADMIN_SHOP_STATUS);
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
    const data = await fetchJson(API_PATHS.API_ADMIN_SHOP_PREVIEW, { method: "POST", body: { catalog: store.draft, weeks: store.previewWeeks, days: store.previewDays } });
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

export { RARITIES, KINDS, GRANT_KINDS, COSMETIC_LABEL, TABS, LAYOUTS, DRAFT_KEY, PREFS_KEY, store, clone, storage, isStoreDirty, initStore, loadStatus, offers, sections, sales, dailies, sectionOf, sectionName, offerById, allIds, optionsFor, salesOrdinal, dailyOrdinal, slug, uniqueId, cosmeticName, grantLabel, saleInfo, shopCard, priceNode, salePriceNode, weeklyStatus, saleRole, setSaleRole, problemTarget, problemText, problemsFor, openProblem, markChanged, scheduleCheck, refreshProblemMarks, changeSummary, setStorePlayerOpener, onStoreDirtyChange };

