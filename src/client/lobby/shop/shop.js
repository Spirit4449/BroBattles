import { titleMarkup } from "../../views/titleView.js";
import { getCharacterDisplayName } from "../../../shared/characters/characterStats.js";
import { applyWallet, subscribeWallet, walletRevision } from "../wallet.mjs";
import { mountWallet, releaseWallet, renderWalletBalances } from "../walletView.js";
import { escapeHtml } from "../../../shared/site/html.cjs";
import { playerCardImage, hydratePlayerCardMedia, disposePlayerCardMediaWithin } from "../../views/playerCardAnimation.cjs";
import { showRewardPreview } from "../../views/playerCardPreview.js";
import { sonner } from "../../ui/sonner.js";
import { currencyRewardImage, rewardSound, currencyParticleCount, currencyFlightPlan, resolveRewardGrants } from "../../views/rewardPresentation.js";
import { playSound } from "../../ui/uiSounds.js";
import { createModalFocus } from "../../ui/modalFocus.js";
import { dismissPopup } from "../../ui/popupMotion.js";
import "../../styles/shop.css";

/*
 * Shop overview
 * - Section presentation (layout, rarity, owned filtering, row limits) comes from
 *   each catalog section in src/shared/catalogs/shopCatalog.json.
 * - Everything a grant kind shows (type label, name icon, reward label, artwork)
 *   lives in GRANT_KINDS / grantArtMarkup below. Add new kinds there.
 * - render() builds plain markup strings and patchChildren() swaps only the nodes
 *   whose markup changed, so refreshes never flash or reset untouched cards.
 *   View state (active tab, expanded sections) is applied after patching and
 *   never baked into markup.
 */

const FRIENDLY_ERRORS = {
  insufficient_funds: { title: "Not enough currency", message: "Check your balance and choose another item or get more currency." },
  payments_unavailable: { title: "Checkout unavailable", message: "Try again in a moment." },
  account_required: { title: null, message: "Create an account to buy currency." },
  offer_ineligible: { title: "Offer unavailable", message: "You already own the featured cosmetic in this offer." },
  unknown_offer: { title: "Shop refreshed", message: "Pick from the latest offers." },
  price_changed: { title: "Price changed", message: "The sale refreshed. Open the shop again to see the current price." },
  order_not_found: { title: "Could not find this order", message: "Refresh the shop and check your balance before trying another purchase." },
};

const RARITY_ORDER = { common: 0, rare: 1, epic: 2, legendary: 3 };
const SHOP_ICON = "/assets/shop/icons/shop-v2.webp";
const PROFILE_ICON = "/assets/shop/icons/profile-v2.webp";

// One place for everything a grant kind shows in cards, dialogs and reveals.
const GRANT_KINDS = {
  currency: {
    offerType: grant => (grant.currency === "gems" ? "GEM PACK" : "COIN PACK"),
    icon: grant => currencyImage(grant.currency),
    reward: () => "Currency",
  },
  skin: {
    offerType: grant => (grant.character ? `${getCharacterDisplayName(grant.character).toUpperCase()} SKIN` : "FIGHTER SKIN"),
    icon: () => "/assets/shop/icons/skins-hanger.webp",
    reward: grant => `${grant.character || "Bro"} Skin`,
  },
  card: { offerType: () => "PLAYER CARD", icon: () => PROFILE_ICON, reward: () => "Player Card" },
  profileIcon: { offerType: () => "PROFILE ICON", icon: () => PROFILE_ICON, reward: () => "Player Icon" },
  title: { offerType: () => "PLAYER TITLE", icon: () => PROFILE_ICON, reward: () => "Player Title" },
  character: { offerType: () => "NEW BRO", icon: () => SHOP_ICON, reward: () => "New Bro" },
  mode: { offerType: () => "GAME MODE", icon: () => SHOP_ICON, reward: () => "Game Mode" },
};
const UNKNOWN_KIND = { offerType: () => "SHOP ITEM", icon: () => SHOP_ICON, reward: () => "Reward" };
const grantKind = grant => GRANT_KINDS[grant?.kind] || UNKNOWN_KIND;

function safeCssToken(value) {
  return String(value || "item").replace(/[^a-z0-9_-]/gi, "-");
}

function delay(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function idempotencyKey(prefix) {
  const uuid = window.crypto?.randomUUID?.();
  return uuid ? `${prefix}:${uuid}` : `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

async function fetchShopJson(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || "Shop request failed.");
    error.code = data?.code || null;
    error.wallet = data?.wallet || null;
    throw error;
  }
  return data;
}

function postShopJson(url, body) {
  return fetchShopJson(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function formatMoney(price) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
    .format((Number(price?.amountCents) || 0) / 100);
}

function formatCountdown(targetIso, now = Date.now()) {
  const totalSeconds = Math.floor(Math.max(0, new Date(targetIso).getTime() - now) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  return [hours, minutes, totalSeconds % 60].map(part => String(part).padStart(2, "0")).join(":");
}

const formatCount = value => (Number(value) || 0).toLocaleString();
const currencyImage = currency => `/assets/icons/${currency === "coins" ? "coin" : "gem"}.webp`;

function currencyIcon(currency) {
  return `<img class="purchase-currency-icon" src="${currencyImage(currency)}" alt="">`;
}

function priceMarkup(price) {
  if (!price || price.type === "free") return '<span class="shop-price-free">FREE</span>';
  if (price.type === "money") return `<span class="shop-price-money">${formatMoney(price)}</span>`;
  const currency = price.currency === "coins" ? "coins" : "gems";
  return `<span class="shop-price-virtual"><img src="${currencyImage(currency)}" alt="${currency}" /><strong>${formatCount(price.amount)}</strong></span>`;
}

const isFree = price => !price || price.type === "free" || (price.type === "virtual" && !(Number(price.amount) > 0));

function grantLabel(grant, { signed = false } = {}) {
  if (grant.kind !== "currency") return grant.name;
  return `${signed ? "+" : ""}${formatCount(grant.amount)} ${grant.name}`;
}

// Artwork for a grant. Reveals use the animated player card; dialogs use shop art.
function grantArtMarkup(grant, { reveal = false } = {}) {
  if (grant.kind === "title") return `<span class="title-presentation-box">${titleMarkup(grant.id)}</span>`;
  if (grant.kind === "currency") return `<img src="${escapeHtml(currencyRewardImage(grant.currency, grant.amount))}" alt="${reveal ? escapeHtml(grant.name) : ""}" />`;
  if (reveal && grant.kind === "card") return `<img data-animated-card-id="${escapeHtml(grant.id)}" src="${escapeHtml(playerCardImage(grant.id, { animate: false }))}" alt="${escapeHtml(grant.name)}" />`;
  return `<img src="${escapeHtml((reveal ? grant.image : grant.shopImage || grant.image) || "")}" alt="${reveal ? escapeHtml(grant.name) : ""}" />`;
}

function getActionState(item) {
  const itemState = item?.state || {};
  if (item.kind === "daily") {
    return {
      disabled: !!itemState.claimed || !itemState.available,
      label: itemState.claimed ? "CLAIMED" : itemState.available ? "FREE" : "UNAVAILABLE",
      action: "daily",
    };
  }
  if (itemState.purchased) return { disabled: true, label: "PURCHASED", action: null };
  if (itemState.owned) return { disabled: true, label: "OWNED", action: null };
  const offerId = item.offerId || (item.kind !== "browse-item" ? item.id : null);
  if (!offerId || !itemState.available) return { disabled: true, label: "UNAVAILABLE", action: null };
  return { disabled: false, label: null, action: item?.price?.type === "money" ? "checkout" : "purchase", offerId };
}

function getItemTypeLabel(item, grants) {
  if (item.kind === "daily") return `DAILY REWARD · ${grants[0]?.currency === "gems" ? "GEMS" : "COINS"}`;
  return grantKind(grants[0]).offerType(grants[0] || {});
}

function getItemIcon(item, grants) {
  if (item.kind === "bundle") return "/assets/shop/icons/bundle-v2.webp";
  return grantKind(grants[0]).icon(grants[0] || {});
}

function isBigPurchase(item) {
  if (item?.kind === "bundle") return true;
  if (item?.price?.type === "money") return Number(item.price.amountCents) >= 499;
  return Number(item?.price?.amount) >= 250;
}

/* ---------- Markup. Pure functions of catalog data; no view state. ---------- */

const INFO_ICON = '<svg class="shop-info-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><path fill="currentColor" d="M6 2h4v3H6zM4 7h6v5h2v2H4v-2h2V9H4z" /></svg>';
const NEW_TAG = '<span class="shop-new-tag" data-shop-new>NEW</span>';

function offerVisualMarkup(item, grants, { showRarity, rarity }) {
  const primary = grants[0] || {};
  const cardArt = grants.length === 1 && primary.kind === "card" ? primary.shopImage : null;
  return `<div class="shop-offer-visual">
      <img class="shop-banner-art" src="${escapeHtml(item.banner || "/assets/lushy/lobbyBg.webp")}" alt="" loading="lazy" />
      <span class="shop-banner-scrim" aria-hidden="true"></span>
      <span class="shop-banner-light" aria-hidden="true"></span>
      ${primary.kind === "title" ? `<div class="shop-title-preview">${titleMarkup(primary.id)}</div>` : ""}
      ${cardArt ? `<img class="shop-original-card" src="${escapeHtml(cardArt)}" alt="" loading="lazy" />` : ""}
      ${item.kind === "bundle" || grants.some(grant => grant.kind === "card") ? `<button class="shop-card-info bb-button" type="button" data-shop-preview="${escapeHtml(item.id)}" aria-label="See what's in ${escapeHtml(item.name)}" title="See what's inside">${INFO_ICON}</button>` : ""}
      ${item.isNew ? '<span class="shop-new-tag shop-item-new" aria-label="New item">NEW</span>' : ""}
      ${item.badge ? `<span class="shop-offer-badge">${escapeHtml(item.badge)}</span>` : ""}
      ${showRarity ? `<span class="shop-rarity-badge">${escapeHtml(rarity)}</span>` : ""}
    </div>`;
}

function offerBodyMarkup(item, grants) {
  // Bundle contents live behind the info button; the card just says how many.
  const type = item.kind === "bundle" ? `BUNDLE · ${grants.length} ITEM${grants.length === 1 ? "" : "S"}` : getItemTypeLabel(item, grants);
  return `<div class="shop-offer-body">
      <div class="shop-offer-name"><img src="${escapeHtml(getItemIcon(item, grants))}" alt="" /><h3>${escapeHtml(item.name)}</h3></div>
      <span class="shop-offer-type">${escapeHtml(type)}</span>
    </div>`;
}

function offerFooterMarkup(item, action) {
  const original = item.originalPrice;
  const discounted = original?.type === "virtual" && Number(original.amount) > Number(item.price?.amount);
  const showBadge = discounted && Number(item.discountPercent) > 0 && !action.disabled;
  const claimable = !action.disabled && (action.action === "daily" || (action.action === "purchase" && isFree(item.price)));
  let label;
  if (action.disabled) label = `<span class="shop-action-state">${escapeHtml(action.label)}</span>`;
  else if (discounted) {
    const reason = item.bundleValue && !item.discountPercent ? "Unowned cosmetic value" : "Original price";
    label = `<span class="shop-sale-prices"><s class="shop-original-price" aria-label="${reason} ${formatCount(original.amount)} ${escapeHtml(original.currency)}">${formatCount(original.amount)}</s>${priceMarkup(item.price)}</span>`;
  } else label = priceMarkup(item.price);
  return `<div class="shop-offer-footer${showBadge ? " has-discount" : ""}">
      ${showBadge ? `<span class="shop-sale-discount" aria-label="${escapeHtml(item.discountPercent)} percent off">${escapeHtml(item.discountPercent)}%<small>OFF!</small></span>` : ""}
      <button class="shop-buy-button${claimable ? " is-claimable" : ""}" type="button" data-sound="none"
        data-shop-action="${escapeHtml(action.action || "")}" data-offer-id="${escapeHtml(action.offerId || "")}" data-item-id="${escapeHtml(item.id)}"
        ${action.disabled ? "disabled" : ""}>${label}</button>
    </div>`;
}

export function offerMarkup(item, meta, index) {
  const grants = Array.isArray(item?.grants) ? item.grants : [];
  const action = getActionState(item);
  const rarity = safeCssToken(String(item?.rarity || "common").toLowerCase());
  const showRarity = !!meta.showRarity;
  const owned = item?.state?.owned || item?.state?.purchased;
  const classes = [
    "shop-offer",
    showRarity && `has-rarity shop-rarity-${rarity}`,
    `shop-product-${safeCssToken(grants[0]?.kind || item.kind || "item")}`,
    item.kind === "bundle" && "shop-offer-bundle",
    action.disabled && !owned && !item?.state?.claimed && "is-unavailable",
    owned && "is-owned",
    item?.state?.claimed && "is-claimed",
  ].filter(Boolean).join(" ");
  return `<article class="${classes}" data-shop-item-id="${escapeHtml(item.id)}" style="--offer-index:${index}">
      ${offerVisualMarkup(item, grants, { showRarity, rarity })}
      ${offerBodyMarkup(item, grants)}
      ${offerFooterMarkup(item, action)}
    </article>`;
}

function visibleOffers(meta, items) {
  let shown = items.filter(item => getActionState(item).label !== "UNAVAILABLE");
  if (meta.hideOwned) {
    shown = shown
      .filter(item => !item?.state?.owned && !item?.state?.purchased)
      .sort((a, b) => (RARITY_ORDER[a.rarity] ?? 4) - (RARITY_ORDER[b.rarity] ?? 4) || String(a.name).localeCompare(String(b.name)));
  }
  return shown;
}

function emptyStateMarkup(meta, items) {
  // Nothing left to buy in a collection section (owned offers are filtered out,
  // and an empty catalog section counts too) reads as complete.
  const everythingOwned = meta.hideOwned && !items.some(item => getActionState(item).label === "UNAVAILABLE");
  if (everythingOwned) {
    const note = meta.rotation ? "You own everything in this rotation. New items arrive at the reset." : "You own everything here. Time to show it off.";
    return `<div class="shop-empty shop-collection-complete"><img class="shop-collection-star" src="/assets/icons/special.webp" alt="" /><strong>Collection complete!</strong><p>${note}</p><button class="bb-button" type="button" data-shop-open-profile>Go to Profile</button></div>`;
  }
  return '<div class="shop-empty"><strong>Nothing available right now.</strong></div>';
}

// Keyed render tree for one section; patchChildren() turns it into DOM.
export function sectionTree(meta, items) {
  const offers = visibleOffers(meta, items);
  const layout = safeCssToken(meta.layout || "grid");
  const rows = meta.rows ? ` data-rows="${Number(meta.rows)}"` : "";
  const head = `<header class="shop-section-head">
      <div class="shop-section-copy"><img src="${escapeHtml(meta.icon)}" alt="" /><h2>${escapeHtml(meta.name)}</h2></div>
      ${meta.rotation ? `<div class="shop-reset-chip"><img class="shop-clock-icon" src="/assets/ui/shop-clock.webp" alt="" /><strong data-shop-countdown="${escapeHtml(meta.rotation)}">--:--:--</strong></div>` : ""}
    </header>`;
  const children = [
    { key: "head", html: head },
    {
      key: "grid",
      html: `<div id="shop-grid-${escapeHtml(meta.id)}" class="shop-offer-grid shop-layout-${layout}"></div>`,
      children: offers.length
        ? offers.map((item, index) => ({ key: `offer:${item.id}`, html: offerMarkup(item, meta, index) }))
        : [{ key: "empty", html: emptyStateMarkup(meta, items) }],
    },
  ];
  if (meta.collapsible) {
    children.push({ key: "expand", html: `<button class="shop-expand bb-button" type="button" aria-expanded="false" aria-controls="shop-grid-${escapeHtml(meta.id)}">Expand</button>` });
  }
  return {
    key: `section:${meta.id}`,
    html: `<section class="shop-section shop-section-${escapeHtml(meta.id)}${meta.collapsible ? " shop-section-collapsible" : ""}" id="shop-section-${escapeHtml(meta.id)}"${rows}></section>`,
    children,
  };
}

function tabMarkup(meta, notifications) {
  return `<button type="button" data-shop-jump="${escapeHtml(meta.id)}" data-sound="cursor4" data-volume="0.22"><img class="shop-tab-icon" src="${escapeHtml(meta.icon)}" alt="" /><span>${escapeHtml(meta.name)}</span>${notifications?.sections?.[meta.id]?.hasNew ? NEW_TAG : ""}</button>`;
}

/* ---------- Keyed DOM patching. ---------- */

const renderedMarkup = new WeakMap();

function elementFromHtml(html) {
  const box = document.createElement("div");
  box.innerHTML = html.trim();
  return box.firstElementChild;
}

// Reuses a child whose key and markup are unchanged, so images, media, focus and
// layout survive refreshes; replaces only changed nodes and drops stale ones.
function patchChildren(parent, entries) {
  const existing = new Map();
  for (const child of [...parent.children]) {
    if (child.dataset.key) existing.set(child.dataset.key, child);
    else child.remove();
  }
  let previous = null;
  for (const entry of entries) {
    let node = existing.get(entry.key);
    existing.delete(entry.key);
    if (!node || renderedMarkup.get(node) !== entry.html) {
      const fresh = elementFromHtml(entry.html);
      fresh.dataset.key = entry.key;
      renderedMarkup.set(fresh, entry.html);
      node?.replaceWith(fresh);
      node = fresh;
    }
    const expected = previous ? previous.nextElementSibling : parent.firstElementChild;
    if (node !== expected) parent.insertBefore(node, expected);
    if (entry.children) patchChildren(node, entry.children);
    previous = node;
  }
  for (const stale of existing.values()) stale.remove();
}

/* ---------- Dialogs. ---------- */

// With holdOnConfirm, confirming fades out only the dialog card and resolves to
// a bridge: the dimmed backdrop stays up until bridge.release(), so the screen
// never flashes undimmed between "Buy" and the reward reveal.
function purchaseDialog(title, content, confirm = "", { headerClose = false, onPack, holdOnConfirm = false } = {}) {
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.className = "cs-confirm-backdrop";
    const header = headerClose
      ? `<header class="cs-confirm-title purchase-dialog-header"><h2>${escapeHtml(title)}</h2><button type="button" class="bb-close pixel-menu-button" data-dismiss aria-label="Close">×</button></header>`
      : `<h2 class="cs-confirm-title">${escapeHtml(title)}</h2>`;
    const actions = headerClose ? "" : `<div class="cs-confirm-actions"><button type="button" class="cs-btn cancel pixel-menu-button" data-dismiss>${confirm ? "Cancel" : "Close"}</button>
      ${confirm ? `<button type="button" class="cs-btn confirm pixel-menu-button" data-confirm>${confirm}</button>` : ""}</div>`;
    backdrop.innerHTML = `<section class="cs-confirm cs-purchase-confirm purchase-review" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      ${header}<div class="cs-confirm-body">${content}</div>${actions}</section>`;
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      focus.deactivate();
      backdrop.remove();
      resolve(value);
    };
    const handOff = () => {
      if (settled) return;
      settled = true;
      focus.deactivate();
      backdrop.classList.add("is-handing-off");
      let released = false;
      resolve({
        release({ instant = false } = {}) {
          if (released) return;
          released = true;
          if (instant) backdrop.remove();
          else dismissPopup(backdrop, () => backdrop.remove());
        },
      });
    };
    const focus = createModalFocus(backdrop.firstElementChild, { onEscape: () => finish(null) });
    let reviewingPack = false;
    backdrop.addEventListener("click", async event => {
      if (settled) return;
      const button = event.target.closest("button");
      if (event.target === backdrop || button?.hasAttribute("data-dismiss")) finish(null);
      else if (button?.hasAttribute("data-confirm")) (holdOnConfirm ? handOff() : finish(true));
      else if (button?.dataset.pack && !reviewingPack) {
        reviewingPack = true;
        try {
          const missing = await onPack(button);
          if (missing <= 0) finish(null);
          else backdrop.querySelector("[data-shortfall]").textContent = missing.toLocaleString();
        } finally {
          reviewingPack = false;
        }
      }
    });
    document.body.append(backdrop);
    focus.activate();
  });
}

function purchaseReviewMarkup(item) {
  const grants = item.grants || [];
  const rewards = grants.map(grant => {
    const tint = grant.kind === "currency"
      ? `reward-tint-${safeCssToken(grant.currency)}`
      : `shop-rarity-${safeCssToken(grant.rarity || item.rarity || "common")}`;
    // Titles render their own nameplate, so they skip the caption.
    const caption = grant.kind === "title" ? "" : `<strong>${grant.kind === "currency" ? currencyIcon(grant.currency) : ""} ${escapeHtml(grantLabel(grant, { signed: true }))}</strong>`;
    return `<li class="purchase-grant ${tint} purchase-grant-${safeCssToken(grant.kind)}"><div class="purchase-stage">${grantArtMarkup(grant)}</div>${caption}</li>`;
  }).join("");
  return `${grants.length > 1 ? `<h3>${escapeHtml(item.name)}</h3>` : ""}<ul class="purchase-grants">${rewards}</ul>`;
}

function loadStripeJs() {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (window.__bbStripeJsPromise) return window.__bbStripeJsPromise;
  window.__bbStripeJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/clover/stripe.js";
    script.async = true;
    script.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error("Stripe.js did not initialize.")));
    script.onerror = () => reject(new Error("Unable to load Stripe.js."));
    document.head.appendChild(script);
  });
  return window.__bbStripeJsPromise;
}

export function initializeShop({ userData, guest, onWalletChange, onProfileInvalidate, onOpenProfile } = {}) {
  const state = {
    data: null,
    overlay: null,
    scroll: null,
    tabs: null,
    open: false,
    loading: false,
    timer: null,
    refreshingAtBoundary: false,
    actionPending: false,
    checkout: null,
    checkoutSessionId: null,
    checkoutOfferId: null,
    completingSessionId: null,
    reveal: null,
    // View state, applied after each render.
    activeSection: null,
    expandedSections: new Set(),
    // Programmatic scrolls (tab clicks) pause the scroll spy until they settle.
    spyPaused: false,
    spyResumeTimer: null,
    scrollSpyFrame: null,
    viewObserver: null,
    viewTimers: new Map(),
    viewedOffers: new Set(),
    viewedRotations: new Map(),
    savingViews: null,
  };

  const sectionMeta = () => state.data?.sectionMeta || [];
  const sectionNode = id => state.scroll?.querySelector(`#shop-section-${CSS.escape(String(id))}`);

  /* ---------- NEW tags and viewed tracking. ---------- */

  function updateShopButtonTag() {
    const shopButton = document.getElementById("shop-button");
    const notifications = state.data?.notifications;
    if (!shopButton || !notifications) return;
    shopButton.querySelector("[data-shop-new]")?.remove();
    if (notifications.hasNew) shopButton.insertAdjacentHTML("beforeend", NEW_TAG);
    shopButton.setAttribute("aria-label", notifications.hasNew ? "Shop, new content" : "Shop");
  }

  function stopViewTracking() {
    state.viewObserver?.disconnect();
    state.viewObserver = null;
    for (const timer of state.viewTimers.values()) window.clearTimeout(timer);
    state.viewTimers.clear();
  }

  function trackViewedContent() {
    stopViewTracking();
    if (!state.open || !state.data?.notifications) return;
    const snapshot = state.data;
    state.viewObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const node = entry.target;
        if (!entry.isIntersecting || entry.intersectionRatio < 0.5) {
          window.clearTimeout(state.viewTimers.get(node));
          state.viewTimers.delete(node);
          continue;
        }
        if (state.viewTimers.has(node)) continue;
        state.viewTimers.set(node, window.setTimeout(() => {
          state.viewTimers.delete(node);
          if (!state.open || document.visibilityState !== "visible" || state.checkout || state.reveal || state.data !== snapshot) return;
          const section = node.closest(".shop-section").id.replace("shop-section-", "");
          const notification = snapshot.notifications.sections[section];
          if (!notification) return;
          // Seeing the section covers every offer, including collapsed cards.
          for (const id of notification.offerIds) state.viewedOffers.add(id);
          if (notification.refreshed) state.viewedRotations.set(section, notification.cycleKey);
        }, 1000));
      }
    }, { root: state.scroll, threshold: 0.5 });
    state.scroll.querySelectorAll(".shop-section-head, .shop-offer").forEach(node => state.viewObserver.observe(node));
  }

  function saveViewedSections() {
    const offerIds = [...state.viewedOffers];
    const rotations = Object.fromEntries(state.viewedRotations);
    if (!offerIds.length && !Object.keys(rotations).length) return state.savingViews;
    state.viewedOffers.clear();
    state.viewedRotations.clear();
    const save = Promise.resolve(state.savingViews).then(async () => {
      try {
        await postShopJson("/api/shop/viewed", { rotations, offerIds });
        if (!state.data || state.open) return;
        const notifications = state.data.notifications;
        for (const [section, notification] of Object.entries(notifications.sections)) {
          if (rotations[section] === notification.cycleKey) notification.refreshed = false;
          notification.offerIds = notification.offerIds.filter(id => !offerIds.includes(id));
          notification.hasNew = notification.refreshed || notification.offerIds.length > 0;
        }
        Object.values(state.data.sections).flat().forEach(item => { if (offerIds.includes(item.id)) item.isNew = false; });
        notifications.hasNew = Object.values(notifications.sections).some(section => section.hasNew);
        render();
      } catch (error) {
        // Keep failed acknowledgments for the next close and leave NEW visible.
        offerIds.forEach(id => state.viewedOffers.add(id));
        for (const [section, cycleKey] of Object.entries(rotations)) {
          if (!state.viewedRotations.has(section)) state.viewedRotations.set(section, cycleKey);
        }
        console.warn("[shop] Could not save viewed sections", error);
      }
    }).finally(() => { if (state.savingViews === save) state.savingViews = null; });
    state.savingViews = save;
    return save;
  }

  /* ---------- Feedback. ---------- */

  function shopToast(tone, title, message, duration = 4800) {
    return sonner(title, message, "Got it", undefined, {
      duration,
      tone,
      sound: tone === "error" ? "shopError" : tone === "success" ? "shopConfirm" : null,
      soundVolume: 0.35,
    });
  }

  function friendlyError(error, context = "action") {
    if (error?.code === "insufficient_funds") {
      const currency = /Not enough (coins|gems)\./i.exec(error.message)?.[1]?.toLowerCase();
      if (currency) return { title: `Not enough ${currency}`, message: `Check your balance and choose another item or get more ${currency}.` };
    }
    if (FRIENDLY_ERRORS[error?.code]) return FRIENDLY_ERRORS[error.code];
    if (context === "load") return { title: "Shop unavailable", message: "Try again in a moment." };
    if (context === "checkout") return { title: "Checkout unavailable", message: "Please try again in a moment. If you already paid, check your balance first." };
    return {
      title: context === "daily" ? "Could not claim daily reward" : "Could not complete purchase",
      message: "Please try again in a moment.",
    };
  }

  function reportError(error, context) {
    console.error(`[shop] ${context}`, error);
    const copy = friendlyError(error, context);
    shopToast("error", copy.title, copy.message);
  }

  /* ---------- Shell and delegated events. ---------- */

  function ensureShell() {
    if (state.overlay) return;
    const overlay = document.createElement("div");
    overlay.className = "shop-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="shop-backdrop"><span></span><span></span></div>
      <section class="shop-window" role="dialog" aria-modal="true" aria-labelledby="shop-title">
        <header class="shop-header">
          <div class="shop-brand"><img class="shop-title-icon" src="${SHOP_ICON}" alt="" /><h1 id="shop-title">Bro Shop</h1></div>
          <div class="shop-header-wallet"></div>
          <button class="shop-close bb-close pixel-menu-button" type="button" aria-label="Close shop">×</button>
        </header>
        <nav class="shop-tabs" aria-label="Jump to a shop section"></nav>
        <div class="shop-scroll"><div class="shop-loading"><span class="shop-loading-rune bb-battle-loader" aria-hidden="true"></span><strong>Opening shop...</strong></div></div>
      </section>
      <div class="shop-checkout" aria-hidden="true">
        <div class="shop-checkout-backdrop"></div>
        <section class="shop-checkout-panel" role="dialog" aria-modal="true" aria-labelledby="shop-checkout-title">
          <header><h2 id="shop-checkout-title">Secure Checkout</h2><button type="button" class="shop-checkout-close bb-close pixel-menu-button" aria-label="Close checkout">×</button></header>
          <div class="shop-checkout-body">
            <p class="shop-checkout-notice">Currency is delivered after payment confirmation. Refund and withdrawal rights depend on applicable law. See the <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a> or contact <a href="mailto:support@brobattles.dev">support@brobattles.dev</a>.</p>
            <div class="shop-checkout-host"></div>
          </div>
        </section>
      </div>`;
    document.body.appendChild(overlay);
    state.overlay = overlay;
    state.scroll = overlay.querySelector(".shop-scroll");
    state.tabs = overlay.querySelector(".shop-tabs");
    state.focus = createModalFocus(overlay, {
      initialFocus: () => overlay.querySelector(".shop-close"),
    });

    overlay.querySelector(".shop-close").addEventListener("click", close);
    overlay.querySelector(".shop-backdrop").addEventListener("click", close);
    overlay.querySelector(".shop-checkout-close").addEventListener("click", () => {
      playSound("cancel", 0.3);
      closeCheckout();
    });
    overlay.querySelector(".shop-checkout-backdrop").addEventListener("click", closeCheckout);
    state.tabs.addEventListener("click", event => {
      const button = event.target.closest("[data-shop-jump]");
      if (button) jumpTo(button.dataset.shopJump);
    });
    state.scroll.addEventListener("click", handleScrollClick);
    state.scroll.addEventListener("scroll", handleScroll, { passive: true });
    // Any direct user scroll takes over from a tab jump right away.
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
      state.scroll.addEventListener(type, resumeScrollSpy, { passive: true });
    }
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !state.open) return;
      if (state.reveal?.dataset.ready === "1") closeReveal();
      else if (state.overlay.querySelector(".shop-checkout")?.getAttribute("aria-hidden") === "false") closeCheckout();
      else close();
    });
  }

  function handleScrollClick(event) {
    // Only buttons act; clicking the card art or text does nothing.
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-shop-preview]")) {
      const item = findItem(target.dataset.shopPreview);
      showRewardPreview(item?.grants || [], { title: item?.kind === "bundle" ? item.name : undefined });
    } else if (target.matches("[data-shop-open-profile]")) {
      close();
      if (onOpenProfile) onOpenProfile();
      else window.location.assign("/index.html?profile=self");
    } else if (target.matches(".shop-expand")) {
      const id = target.closest(".shop-section").id.replace("shop-section-", "");
      setExpanded(id, !state.expandedSections.has(id));
    } else if (target.matches("[data-shop-action]")) {
      void runOfferAction(target);
    }
  }

  async function runOfferAction(button) {
    if (button.disabled || state.actionPending) return;
    const item = findItem(button.dataset.itemId) || findItem(button.dataset.offerId);
    if (!item) return;
    state.actionPending = true;
    try {
      await reviewItem(item, button);
    } finally {
      state.actionPending = false;
    }
  }

  /* ---------- Wallet. ---------- */

  subscribeWallet((wallet, user) => {
    if (user === userData) updateWallet(wallet, false);
  });

  function updateWallet(wallet, notify = true, pulse = false) {
    if (!wallet) return;
    const normalized = { coins: Number(wallet.coins) || 0, gems: Number(wallet.gems) || 0 };
    if (state.data) state.data.wallet = normalized;
    renderWalletBalances(normalized);
    state.overlay?.querySelectorAll("[data-shop-wallet]").forEach(node => {
      node.textContent = normalized[node.dataset.shopWallet].toLocaleString();
      if (pulse) {
        node.closest("[data-shop-wallet-shell]")?.animate([
          { transform: "scale(1)", filter: "brightness(1)" },
          { transform: "scale(1.12)", filter: "brightness(1.5)", offset: 0.42 },
          { transform: "scale(1)", filter: "brightness(1)" },
        ], { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    });
    if (notify) {
      applyWallet(userData, normalized);
      onWalletChange?.(normalized);
    }
  }

  /* ---------- Rendering. ---------- */

  function render() {
    updateShopButtonTag();
    if (!state.data || !state.scroll) return;
    updateWallet(state.data.wallet, false);
    const metas = sectionMeta();
    const notifications = state.data.notifications;
    patchChildren(state.tabs, metas.map(meta => ({ key: `tab:${meta.id}`, html: tabMarkup(meta, notifications) })));
    patchChildren(state.scroll, metas.map(meta => sectionTree(meta, state.data.sections?.[meta.id] || [])));
    applyViewState();
    updateCountdowns();
    trackViewedContent();
  }

  function applyViewState() {
    for (const meta of sectionMeta()) {
      if (meta.collapsible) paintExpanded(meta.id);
    }
    paintActiveTab();
  }

  function setExpanded(id, expanded) {
    if (expanded) state.expandedSections.add(id);
    else state.expandedSections.delete(id);
    paintExpanded(id);
  }

  function paintExpanded(id) {
    const section = sectionNode(id);
    const expanded = state.expandedSections.has(id);
    section?.classList.toggle("is-expanded", expanded);
    const button = section?.querySelector(".shop-expand");
    if (!button) return;
    button.setAttribute("aria-expanded", String(expanded));
    button.textContent = expanded ? "Show less" : "Expand";
  }

  async function refresh({ preserveScroll = true } = {}) {
    if (state.loading) return state.loading;
    state.loading = (async () => {
      try {
        const revision = walletRevision();
        state.data = await fetchShopJson("/api/shop/bootstrap");
        applyWallet(userData, state.data.wallet, revision);
        if (userData) state.data.wallet = { coins: userData.coins, gems: userData.gems };
        state.clockOffset = new Date(state.data.serverNow).getTime() - Date.now();
        render();
        if (!preserveScroll && state.scroll) state.scroll.scrollTop = 0;
        return state.data;
      } finally {
        state.loading = false;
      }
    })();
    return state.loading;
  }

  /* ---------- Section tabs and scroll spy. ---------- */

  function pauseScrollSpy() {
    state.spyPaused = true;
    window.clearTimeout(state.spyResumeTimer);
    // Released once scrolling has been quiet for a moment (scrollend is not universal).
    state.spyResumeTimer = window.setTimeout(resumeScrollSpy, 180);
  }

  function resumeScrollSpy() {
    window.clearTimeout(state.spyResumeTimer);
    state.spyPaused = false;
  }

  function handleScroll() {
    // While a tab jump animates, keep the clicked tab lit instead of tracking
    // every section the scroll passes through.
    if (state.spyPaused) return pauseScrollSpy();
    if (state.scrollSpyFrame) return;
    state.scrollSpyFrame = window.requestAnimationFrame(() => {
      state.scrollSpyFrame = null;
      updateActiveSection();
    });
  }

  function jumpTo(section, { instant = false } = {}) {
    setActiveSection(section);
    const target = sectionNode(state.activeSection);
    if (!target) return;
    pauseScrollSpy();
    target.scrollIntoView({ behavior: instant ? "instant" : "smooth", block: "start" });
  }

  function spotlightOffer(offerId) {
    const offer = [...(state.scroll?.querySelectorAll("[data-shop-item-id]") || [])]
      .find(node => node.dataset.shopItemId === String(offerId));
    if (!offer) return jumpTo("sales", { instant: true });
    const id = offer.closest(".shop-section").id.replace("shop-section-", "");
    if (sectionMeta().find(meta => meta.id === id)?.collapsible) setExpanded(id, true);
    setActiveSection(id);
    pauseScrollSpy();
    offer.scrollIntoView({ behavior: "instant", block: "center" });
    const buy = offer.querySelector(".shop-buy-button:not(:disabled)");
    buy?.focus({ preventScroll: true });
    offer.classList.add("is-spotlight");
    window.setTimeout(() => offer.classList.remove("is-spotlight"), 1800);
  }

  function setActiveSection(section) {
    state.activeSection = sectionMeta().some(meta => meta.id === section) ? section : sectionMeta()[0]?.id || null;
    paintActiveTab();
  }

  function paintActiveTab() {
    let activeButton = null;
    state.tabs?.querySelectorAll("[data-shop-jump]").forEach(button => {
      const active = button.dataset.shopJump === state.activeSection;
      if (button.classList.contains("is-active") === active) {
        if (active) activeButton = button;
        return;
      }
      button.classList.toggle("is-active", active);
      if (active) {
        activeButton = button;
        button.setAttribute("aria-current", "location");
        // Keep the active tab visible when the tab strip scrolls (narrow screens).
        if (state.tabs.scrollWidth > state.tabs.clientWidth) {
          state.tabs.scrollTo({ left: button.offsetLeft - (state.tabs.clientWidth - button.offsetWidth) / 2, behavior: "smooth" });
        }
      } else button.removeAttribute("aria-current");
    });
    return activeButton;
  }

  function updateActiveSection() {
    const metas = sectionMeta();
    if (!state.scroll || !metas.length) return;
    let active = metas[0].id;
    const threshold = state.scroll.getBoundingClientRect().top + Math.min(160, state.scroll.clientHeight * 0.24);
    for (const meta of metas) {
      if ((sectionNode(meta.id)?.getBoundingClientRect().top ?? Infinity) <= threshold) active = meta.id;
    }
    if (state.scroll.scrollTop + state.scroll.clientHeight >= state.scroll.scrollHeight - 4) active = metas.at(-1).id;
    if (active !== state.activeSection) setActiveSection(active);
  }

  /* ---------- Open / close. ---------- */

  function open(section = "sales", offerId = null) {
    ensureShell();
    const trigger = document.activeElement;
    state.open = true;
    void state.overlay.offsetWidth;
    state.overlay.classList.add("is-open");
    state.overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("shop-is-open");
    mountWallet(state.overlay.querySelector(".shop-header-wallet"));
    renderWalletBalances(userData);
    state.focus.activate(trigger);
    playSound("shopOpen", 0.38);
    if (!state.timer) state.timer = window.setInterval(updateCountdowns, 1000);
    const position = () => (offerId ? spotlightOffer(offerId) : jumpTo(section, { instant: true }));
    // Content from the previous visit is placed right away and patched in place.
    if (state.data) position();
    return Promise.resolve(state.savingViews)
      .then(() => refresh())
      .then(() => { if (state.open) position(); })
      .catch(error => {
        state.scroll.innerHTML = '<div class="shop-load-error"><strong>Shop unavailable.</strong><button type="button" class="bb-button" data-sound="cursor4">Try Again</button></div>';
        state.scroll.querySelector("button").addEventListener("click", () => void refresh().catch(retryError => reportError(retryError, "load")));
        reportError(error, "load");
      });
  }

  function openOffer(offerId) {
    return open("sales", offerId);
  }

  async function getFeaturedSale() {
    if (!state.data) await refresh({ preserveScroll: false });
    const sales = Array.isArray(state.data?.sections?.sales) ? state.data.sections.sales : [];
    const offer = sales.find(item => item?.state?.available && !item?.state?.owned) || sales.find(item => item?.state?.available) || null;
    if (!offer) return null;
    return { offer, nextRefreshAt: state.data?.rotations?.sales?.nextRefreshAt || null };
  }

  function close() {
    if (!state.overlay || !state.open) return;
    closeReveal();
    closeCheckout();
    state.open = false;
    stopViewTracking();
    state.overlay.classList.remove("is-open");
    state.overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("shop-is-open");
    releaseWallet(state.overlay.querySelector(".shop-header-wallet"));
    state.focus.deactivate();
    playSound("cancel", 0.34);
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
    return saveViewedSections();
  }

  function updateCountdowns() {
    if (!state.open || !state.data) return;
    const now = Date.now() + (state.clockOffset || 0);
    let expired = false;
    for (const kind of ["dailies", "sales"]) {
      const target = state.data.rotations?.[kind]?.nextRefreshAt;
      const text = target ? formatCountdown(target, now) : "--:--:--";
      state.overlay.querySelectorAll(`[data-shop-countdown="${kind}"]`).forEach(node => {
        if (node.textContent !== text) node.textContent = text;
      });
      if (target && new Date(target).getTime() <= now) expired = true;
    }
    if (expired && !state.refreshingAtBoundary) {
      state.refreshingAtBoundary = true;
      void refresh().catch(error => reportError(error, "refresh")).finally(() => {
        state.refreshingAtBoundary = false;
      });
    }
  }

  /* ---------- Purchases and claims. ---------- */

  const { closeReveal, showRewardReveal } = createRewardPresentation({ state, updateWallet, onProfileInvalidate });

  async function handleSuccess({ result, button, item, kind = "purchase", floating = false, bridge = null }) {
    if (result.duplicate || result.alreadyOwned) {
      updateWallet(result.wallet);
      onProfileInvalidate?.();
      await refresh();
      return;
    }
    const card = button?.closest?.(".shop-offer");
    const sourceRect = card?.querySelector(".shop-offer-visual")?.getBoundingClientRect();
    card?.classList.add("is-completing");
    playSound(isBigPurchase(item) ? "shopBigSuccess" : "shopConfirm", isBigPurchase(item) ? 0.52 : 0.42);
    try {
      // The reveal takes over the confirm dialog's dim in the same frame it mounts.
      await showRewardReveal({ result, item, kind, sourceRect, floating, seamless: !!bridge, onMounted: () => bridge?.release({ instant: true }) });
    } finally {
      // Repeatable offers keep their card node across the refresh.
      card?.classList.remove("is-completing");
    }
    await refresh();
  }

  async function chooseCurrencyPack(currency, missing) {
    playSound("shopError", 0.35);
    const required = Number(state.data.wallet[currency]) + missing;
    const packs = (state.data?.sections?.currency || []).filter(item =>
      item.grants.some(grant => grant.kind === "currency" && grant.currency === currency));
    const cards = packs.map(pack => {
      const action = getActionState(pack);
      const grant = pack.grants.find(grant => grant.kind === "currency" && grant.currency === currency);
      return `<button type="button" class="purchase-pack" data-currency="${currency}" data-pack="${escapeHtml(pack.id)}" ${action.disabled ? "disabled" : ""}>
        <span class="shop-offer-visual purchase-pack-stage"><img class="purchase-pack-art" src="${currencyRewardImage(currency, grant.amount)}" alt=""><strong class="shop-offer-name">${currencyIcon(currency)} +${grant.amount.toLocaleString()} ${currency}</strong></span>
        <span class="shop-buy-button purchase-pack-price">${priceMarkup(pack.price)}</span>${action.disabled ? `<small>${escapeHtml(pack.state.reason || action.label)}</small>` : ""}</button>`;
    }).join("");
    return purchaseDialog("Insufficient Funds", `<p class="purchase-shortfall">You need <span>${currencyIcon(currency)} <b data-shortfall>${missing.toLocaleString()}</b> more ${currency}.</span></p>
      <div class="purchase-packs">${cards || "No packs available."}</div>`, "", {
      headerClose: true,
      onPack: async button => {
        const pack = packs.find(candidate => candidate.id === button.dataset.pack);
        await reviewItem(pack, button, true);
        return required - Number(state.data.wallet[currency]);
      },
    });
  }

  async function characterShortfall({ currency, missing }) {
    try {
      if (!state.data) await refresh();
      await chooseCurrencyPack(currency, missing);
    } catch (error) {
      reportError(error, "load");
    }
  }

  async function reviewItem(item, button, floating = false) {
    const { action, offerId } = getActionState(item);
    const price = item.price;
    button.disabled = true;
    const original = button.innerHTML;
    const showBusy = label => { button.innerHTML = `<span>${label}</span>`; };
    let bridge = null;
    try {
      const remaining = price?.type === "virtual" ? state.data.wallet[price.currency] - price.amount : null;
      if (remaining !== null && remaining < 0) {
        await chooseCurrencyPack(price.currency, -remaining);
        return;
      }
      // Free things are granted straight away; only spending asks first.
      const free = action === "daily" || (action === "purchase" && isFree(price));
      if (!free) {
        bridge = await purchaseDialog("Confirm purchase", purchaseReviewMarkup(item), `Buy ${priceMarkup(price)}`, { holdOnConfirm: true });
        if (!bridge) return;
      }
      if (action === "daily") {
        showBusy("Claiming...");
        const result = await postShopJson("/api/shop/claim-daily", { idempotencyKey: idempotencyKey("daily") });
        await handleSuccess({ result, button, item, kind: "daily" });
      } else if (action === "purchase") {
        showBusy(free ? "Claiming..." : "Buying...");
        const result = await postShopJson("/api/shop/purchase", {
          offerId,
          expectedPrice: Number(price?.amount) || 0,
          expectedCurrency: price?.currency === "coins" ? "coins" : "gems",
          idempotencyKey: idempotencyKey("purchase"),
        });
        await handleSuccess({ result, button, item, floating, bridge });
      } else if (action === "checkout") {
        if (state.data?.account?.guest || guest) {
          window.location.href = `/signup?next=${encodeURIComponent(`${window.location.pathname}?shop=currency`)}`;
          return;
        }
        showBusy("Opening...");
        try {
          // The checkout panel opens synchronously with its own backdrop.
          bridge?.release({ instant: true });
          await openCheckout(offerId, floating);
        } catch (error) {
          closeCheckout();
          reportError(error, "checkout");
        }
      }
    } catch (error) {
      if (error.wallet) updateWallet(error.wallet);
      reportError(error, action);
      if (["price_changed", "offer_unavailable", "offer_ineligible"].includes(error.code)) {
        await refresh().catch(refreshError => reportError(refreshError, "refresh"));
      }
    } finally {
      bridge?.release();
      if (button.isConnected) {
        button.disabled = false;
        button.innerHTML = original;
        if (document.activeElement === document.body) button.focus({ preventScroll: true });
      }
    }
  }

  function findItem(id) {
    const wanted = String(id || "");
    for (const items of Object.values(state.data?.sections || {})) {
      const item = (items || []).find(candidate => String(candidate?.id || "") === wanted || String(candidate?.offerId || "") === wanted);
      if (item) return item;
    }
    return null;
  }

  /* ---------- Stripe checkout. ---------- */

  async function openCheckout(offerId, floating) {
    ensureShell();
    closeCheckout();
    const attempt = state.checkoutAttempt;
    const panel = state.overlay.querySelector(".shop-checkout");
    let dismissed;
    if (floating) {
      state.floatingCheckout = panel;
      document.body.appendChild(panel);
      panel.classList.add("shop-floating-layer");
      state.checkoutFocus = createModalFocus(panel, { onEscape: closeCheckout });
      dismissed = new Promise(resolve => { state.checkoutDismissed = resolve; });
    }
    const host = panel.querySelector(".shop-checkout-host");
    panel.setAttribute("aria-hidden", "false");
    panel.classList.add("is-open");
    state.checkoutFocus?.activate();
    playSound("shopOpen", 0.28);
    host.innerHTML = '<div class="shop-checkout-loading"><span class="shop-loading-rune bb-battle-loader" aria-hidden="true"></span><strong>Opening checkout...</strong></div>';
    const result = await postShopJson("/api/shop/checkout-session", {
      offerId,
      idempotencyKey: idempotencyKey("checkout"),
      returnPath: window.location.pathname,
    });
    if (attempt !== state.checkoutAttempt) return;
    state.checkoutSessionId = result.sessionId;
    state.checkoutOfferId = offerId;
    const Stripe = await loadStripeJs();
    if (attempt !== state.checkoutAttempt) return;
    const stripe = Stripe(state.data.payment.publishableKey);
    const checkout = await stripe.initEmbeddedCheckout({
      clientSecret: result.clientSecret,
      onComplete: () => void completeCheckout(result.sessionId),
    });
    if (attempt !== state.checkoutAttempt) { checkout.destroy(); return; }
    state.checkout = checkout;
    host.innerHTML = "";
    checkout.mount(host);
    await dismissed;
  }

  async function completeCheckout(sessionId) {
    if (state.completingSessionId === sessionId) return;
    state.completingSessionId = sessionId;
    const terminalStatuses = ["failed", "expired", "refunded", "disputed"];
    try {
      let result = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        result = await fetchShopJson(`/api/shop/checkout-status?sessionId=${encodeURIComponent(sessionId)}`);
        const status = result?.order?.status;
        if (status === "fulfilled" || terminalStatuses.includes(status)) break;
        await delay(750);
      }
      if (result?.order?.status === "fulfilled") {
        const item = findItem(state.checkoutOfferId || result?.order?.offer_id);
        const floating = !!state.floatingCheckout;
        const dismissed = state.checkoutDismissed;
        state.checkoutDismissed = null;
        const panel = state.floatingCheckout || state.overlay.querySelector(".shop-checkout-panel");
        closeCheckout();
        try { await handleSuccess({ result, button: panel, item, kind: "checkout", floating }); }
        finally { dismissed?.(); }
      } else {
        closeCheckout();
        await refresh();
        const terminal = terminalStatuses.includes(result?.order?.status);
        shopToast(
          terminal ? "error" : "info",
          terminal ? "Payment not completed" : "Payment processing",
          terminal ? `Order status: ${result.order.status}. Check your balance before trying again.` : "Payment confirmation is pending. Reopen the shop to check your balance.",
          5000,
        );
      }
    } catch (error) {
      reportError(error, "checkout");
    } finally {
      state.completingSessionId = null;
    }
  }

  function closeCheckout() {
    state.checkoutAttempt = (state.checkoutAttempt || 0) + 1;
    if (!state.overlay) return;
    try {
      state.checkout?.destroy?.();
    } catch (_) {}
    state.checkout = null;
    state.checkoutSessionId = null;
    state.checkoutOfferId = null;
    const panel = state.floatingCheckout || state.overlay.querySelector(".shop-checkout");
    if (state.floatingCheckout) {
      state.checkoutFocus.deactivate();
      state.checkoutFocus = null;
      panel.classList.remove("shop-floating-layer");
      state.overlay.appendChild(panel);
      state.floatingCheckout = null;
      state.checkoutDismissed?.();
      state.checkoutDismissed = null;
    }
    panel?.classList.remove("is-open");
    panel?.setAttribute("aria-hidden", "true");
    const host = panel?.querySelector(".shop-checkout-host");
    if (host) host.innerHTML = "";
  }

  /* ---------- Background refresh and deep links. ---------- */

  // Refresh account state in the lobby too, including changes made on another device.
  function refreshNotifications() {
    if (state.open || document.visibilityState !== "visible") return;
    return refresh().catch(error => console.warn("[shop] Notification refresh failed", error));
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (state.open) trackViewedContent();
      else void refreshNotifications();
    } else stopViewTracking();
  });
  window.setInterval(() => { if (!state.checkout && !state.reveal) void refreshNotifications(); }, 60000);
  const url = new URL(window.location.href);
  const returnedSession = url.searchParams.get("shop_checkout");
  const requestedSection = url.searchParams.get("shop");
  if (returnedSession || requestedSection) {
    url.searchParams.delete("shop_checkout");
    url.searchParams.delete("shop");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    window.setTimeout(async () => {
      await open(returnedSession ? "currency" : requestedSection || "sales");
      if (returnedSession) await completeCheckout(returnedSession);
    }, 0);
  }

  return { open, openOffer, characterShortfall, close, refresh, refreshNotifications, jumpTo, getFeaturedSale };
}

// Shared by Shop and Trophy Road so reward motion, audio and wallet impacts stay identical.
export function createRewardPresentation({ state, updateWallet, onProfileInvalidate, onWalletTick }) {
  function closeReveal() {
    if (!state.reveal) return;
    const reveal = state.reveal;
    state.reveal = null;
    reveal.__dismiss?.();
    reveal.classList.add("is-leaving");
    window.setTimeout(() => {
      disposePlayerCardMediaWithin(reveal);
      reveal.remove();
    }, 260);
  }

  function readWalletCount(counter) {
    return (
      Number(String(counter?.textContent || "0").replace(/[^0-9-]/g, "")) || 0
    );
  }

  function writeWalletCount(counter, value) {
    if (counter) counter.textContent = Math.round(value).toLocaleString();
  }

  function animateWalletCount(counter, targetValue, duration = 620) {
    if (!counter) return Promise.resolve();
    const startValue = readWalletCount(counter);
    const endValue = Number(targetValue) || 0;
    if (startValue === endValue) return Promise.resolve();
    return new Promise((resolve) => {
      const startedAt = performance.now();
      const frame = (now) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        writeWalletCount(counter, startValue + (endValue - startValue) * eased);
        if (progress < 1) window.requestAnimationFrame(frame);
        else resolve();
      };
      window.requestAnimationFrame(frame);
    });
  }

  function burstWalletTarget(
    target,
    counter,
    currency,
    impactIndex,
    totalImpacts,
  ) {
    const rect = target.getBoundingClientRect();
    target.animate(
      [
        {
          filter: "brightness(1)",
          boxShadow: "0 5px 0 #03050a, inset 0 3px rgba(255,255,255,.08)",
        },
        {
          filter: "brightness(1.55)",
          boxShadow: `0 5px 0 #03050a, 0 0 18px rgba(${currency === "gems" ? "86,216,255" : "255,193,53"},.72), inset 0 3px rgba(255,255,255,.18)`,
          offset: 0.42,
        },
        {
          filter: "brightness(1)",
          boxShadow: "0 5px 0 #03050a, inset 0 3px rgba(255,255,255,.08)",
        },
      ],
      { duration: 240, easing: "ease-out" },
    );
    counter?.animate(
      [
        { opacity: 0.65, filter: "brightness(1)" },
        { opacity: 1, filter: "brightness(1.75)", offset: 0.48 },
        { opacity: 1, filter: "brightness(1)" },
      ],
      { duration: 190, easing: "ease-out" },
    );
    for (let sparkIndex = 0; sparkIndex < 2; sparkIndex += 1) {
      const angle = (Math.PI * 2 * sparkIndex) / 2 + impactIndex * 0.37;
      const distance = 22 + (sparkIndex % 2) * 10;
      const spark = document.createElement("i");
      spark.className = `shop-wallet-spark shop-wallet-spark-${currency}`;
      spark.style.left = `${rect.left + rect.width / 2}px`;
      spark.style.top = `${rect.top + rect.height / 2}px`;
      document.body.appendChild(spark);
      spark
        .animate(
          [
            { opacity: 1, transform: "translate(-50%, -50%) scale(1)" },
            {
              opacity: 0,
              transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${Math.sin(angle) * distance}px)) scale(.2)`,
            },
          ],
          { duration: 320, easing: "cubic-bezier(.12,.72,.25,1)" },
        )
        .finished.finally(() => spark.remove());
    }
    const pitchRange =
      totalImpacts > 1 ? impactIndex / (totalImpacts - 1) : 0.5;
    playSound(currency === "gems" ? "rewardGemImpact" : "rewardCoinImpact", 0.11, {
      overlap: true,
      maxVoices: 8,
      playbackRate: 0.88 + pitchRange * 0.3 + (currency === "gems" ? 0.08 : 0),
    });
  }

  function flyWalletParticle({ sourceRect, targetRect, currency, index, count, onImpact, onTiming, reveal }) {
    const icon = document.createElement("img");
    icon.className = `shop-flying-currency shop-flying-${currency}`;
    icon.src = currency === "gems" ? "/assets/icons/gem.webp" : "/assets/icons/coin.webp";
    icon.alt = "";
    document.body.appendChild(icon);
    const { keyframes, duration, delay: flightDelay } = currencyFlightPlan({ sourceRect, targetRect, index, count });
    onTiming(duration + flightDelay);
    const animation = icon.animate(keyframes, {
      duration, delay: flightDelay, easing: "cubic-bezier(.2,.05,.55,1)", fill: "both",
    });
    // The compositor owns the flight; no per-frame DOM reads or physics loops.
    return new Promise(resolve => {
      const cancel = () => animation.cancel();
      reveal.addEventListener("reward-dismiss", cancel, { once: true });
      animation.finished.then(() => { if (reveal.dataset.dismissed !== "1") onImpact(); }, () => {}).finally(() => {
        reveal.removeEventListener("reward-dismiss", cancel);
        icon.remove();
        resolve();
      });
    });
  }

  async function animateWalletDebits(wallet, grantedCurrencies) {
    if (!wallet) return;
    const animations = [];
    for (const currency of ["coins", "gems"]) {
      if (grantedCurrencies.has(currency)) continue;
      const counter =
        state.reveal?.querySelector(`[data-reveal-wallet="${currency}"]`) ||
        state.overlay?.querySelector(`[data-shop-wallet="${currency}"]`);
      const targetValue = Number(wallet[currency]) || 0;
      if (counter && targetValue < readWalletCount(counter)) {
        animations.push(animateWalletCount(counter, targetValue, 720));
      }
    }
    await Promise.all(animations);
  }

  async function flyRewardCurrency(grants, reveal, wallet, onReady) {
    const grouped = new Map();
    for (const grant of grants || []) {
      if (grant.kind !== "currency") continue;
      const currency = grant.currency === "gems" ? "gems" : "coins";
      grouped.set(
        currency,
        (grouped.get(currency) || 0) + (Number(grant.amount) || 0),
      );
    }
    const flights = [];
    let flightEnd = 0;
    for (const [currency, amount] of grouped) {
      const target =
        reveal?.querySelector(`[data-reveal-wallet-shell="${currency}"]`) ||
        state.overlay?.querySelector(`[data-shop-wallet-shell="${currency}"]`);
      const counter = target?.querySelector(
        `[data-reveal-wallet="${currency}"], [data-shop-wallet="${currency}"]`,
      );
      const source =
        reveal?.querySelector(`[data-reveal-currency="${currency}"]`) ||
        reveal?.querySelector(".shop-reveal-grants");
      if (!target || !counter || !source) continue;
      const sourceRect = (source.querySelector(".shop-reveal-art") || source).getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const startValue = readWalletCount(counter);
      const endValue = Number.isFinite(Number(wallet?.[currency])) ? Number(wallet[currency]) : startValue + amount;
      const count = currencyParticleCount(currency, amount);
      let impacts = 0;
      const onImpact = () => {
        impacts += 1;
        const progress = impacts / count;
        const eased = 1 - Math.pow(1 - progress, 2);
        writeWalletCount(counter, startValue + (endValue - startValue) * eased);
        onWalletTick?.(currency, readWalletCount(counter));
        burstWalletTarget(target, counter, currency, impacts - 1, count);
      };
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
        writeWalletCount(counter, endValue);
        onWalletTick?.(currency, endValue);
        continue;
      }
      for (let index = 0; index < count; index += 1) {
        flights.push(
          flyWalletParticle({
            sourceRect,
            targetRect,
            reveal,
            currency,
            index,
            count,
            onImpact,
            onTiming: end => { flightEnd = Math.max(flightEnd, end); },
          }),
        );
      }
    }
    onReady(Math.max(0, flightEnd - 1000));
    await Promise.all(flights);
    for (const currency of grouped.keys()) {
      const finalValue =
        wallet && Object.hasOwn(wallet, currency)
          ? Number(wallet[currency]) || 0
          : readWalletCount(
              reveal?.querySelector(`[data-reveal-wallet="${currency}"]`),
            );
      writeWalletCount(
        reveal?.querySelector(`[data-reveal-wallet="${currency}"]`) ||
          state.overlay?.querySelector(`[data-shop-wallet="${currency}"]`),
        finalValue,
      );
    }
  }

  // Multi-item reveals frame each reward like the info preview: type, artwork,
  // name, rarity. Single rewards hide the frame and caption (the heading names
  // them) so the artwork gets the full height.
  function revealGrantMarkup(grant, index, { multi = false } = {}) {
    const currency = grant.kind === "currency" ? (grant.currency === "gems" ? "gems" : "coins") : null;
    const tint = !multi ? "" : currency ? ` reward-tint-${currency}` : grant.rarity ? ` shop-rarity-${safeCssToken(grant.rarity)}` : "";
    const rarity = !currency && grant.rarity
      ? `<span class="shop-reveal-rarity">${escapeHtml(grant.rarity)}</span>`
      : '<span class="shop-reveal-rarity-slot" aria-hidden="true"></span>';
    // A title's nameplate already shows its name.
    const name = grant.kind === "title" ? "" : `<strong class="shop-reveal-name">${escapeHtml(grantLabel(grant, { signed: true }))}</strong>`;
    return `<div class="shop-reveal-grant shop-reveal-${safeCssToken(grant.kind)}${tint}" data-character="${escapeHtml(grant.character || "")}" style="--reveal-index:${index}"${currency ? ` data-reveal-currency="${currency}"` : ""}>
      <span class="shop-reveal-type">${escapeHtml(rewardTypeLabel(grant))}</span>
      <span class="shop-reveal-art">${grantArtMarkup(grant, { reveal: true })}</span>
      <span class="shop-reveal-caption">${name}${rarity}</span>
    </div>`;
  }

  function rewardTypeLabel(grant) {
    return grantKind(grant).reward(grant || {});
  }

  function getRevealHeading(item, grants) {
    if (grants.length !== 1) {
      return { name: item?.name || "Reward Bundle", type: "Reward Bundle" };
    }
    const grant = grants[0];
    const quantity = grant.kind === "currency" ? Number(grant.amount) || 0 : 0;
    const fallbackName = grant.kind === "currency" ? (grant.currency === "gems" ? "Gems" : "Coins") : "Reward";
    return {
      name: `${quantity ? `+${quantity.toLocaleString()} ` : ""}${grant.name || item?.name || fallbackName}`,
      type: rewardTypeLabel(grant),
    };
  }

  async function showRewardReveal({ result, item, kind, sourceRect, startingWallet: walletBefore, floating = false, seamless = false, onMounted }) {
    closeReveal();
    const grants = resolveRewardGrants(result?.grants, item?.grants);
    const rarity = safeCssToken(item?.rarity || "rare");
    const collectibles = grants.filter(grant => grant.kind !== "currency");
    const currencies = grants.filter(grant => grant.kind === "currency");
    // Center the Bro or skin. The icon and full-height player card flank it.
    const priority = { profileIcon: 0, character: 1, skin: 1, mode: 1, card: 2 };
    collectibles.sort((a, b) => (priority[a.kind] ?? 1) - (priority[b.kind] ?? 1));
    const heading = getRevealHeading(item, grants);
    // Currencies sit inline after the collectibles, one tile each.
    const ordered = [...collectibles, ...currencies];
    const multi = ordered.length > 1;
    const startingWallet = walletBefore || {
      coins: readWalletCount(
        state.overlay?.querySelector('[data-shop-wallet="coins"]'),
      ),
      gems: readWalletCount(
        state.overlay?.querySelector('[data-shop-wallet="gems"]'),
      ),
    };
    const grantedCurrencies = new Set(
      grants
        .filter((grant) => grant.kind === "currency")
        .map((grant) => (grant.currency === "gems" ? "gems" : "coins")),
    );
    const reveal = document.createElement("div");
    reveal.className = `shop-reward-reveal reward-showcase shop-rarity-${rarity}${collectibles.length ? " has-collectibles" : " currency-only"}${kind === "trophy" ? " trophy-reward-reveal" : ""}`;
    reveal.classList.toggle("is-multi", multi);
    reveal.classList.toggle("single-card-reveal", collectibles.length === 1 && collectibles[0].kind === "card" && currencies.length === 0);
    if (grants.length === 1 && currencies.length) {
      reveal.classList.add(`reward-tint-${safeCssToken(currencies[0].currency)}`);
    }
    if (grants.length === 1 && grants[0].kind === "title") reveal.classList.add("single-title-reveal");
    const previousFocus = document.activeElement;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (sourceRect) {
      reveal.style.setProperty(
        "--reveal-origin-x",
        `${sourceRect.left + sourceRect.width / 2}px`,
      );
      reveal.style.setProperty(
        "--reveal-origin-y",
        `${sourceRect.top + sourceRect.height / 2}px`,
      );
    }
    reveal.innerHTML = `
      <div class="shop-reveal-backdrop"></div>
      <div class="shop-reveal-rays" aria-hidden="true"></div>
      <div class="shop-reveal-origin" aria-hidden="true"></div>
      <div class="shop-reveal-wallet" aria-label="Updated wallet">
        <span data-reveal-wallet-shell="coins"><img src="/assets/icons/coin.webp" alt="Coins" /><strong data-reveal-wallet="coins">${startingWallet.coins.toLocaleString()}</strong></span>
        <span data-reveal-wallet-shell="gems"><img src="/assets/icons/gem.webp" alt="Gems" /><strong data-reveal-wallet="gems">${startingWallet.gems.toLocaleString()}</strong></span>
      </div>
      <section class="shop-reveal-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(heading.name)}" tabindex="-1">
        ${grants.length === 1 && grants[0].kind === "title" ? `<header class="shop-reveal-heading"><h2>New Title!</h2><p class="shop-reveal-subheader">Equip it from your profile</p></header>` : `<header class="shop-reveal-heading"><h2>${grants.length === 1 && currencies.length ? currencyIcon(currencies[0].currency) : ""}${escapeHtml(heading.name)}</h2><p class="shop-reveal-subheader">${escapeHtml(heading.type)}</p></header>`}
        <div class="shop-reveal-grants" style="--reward-columns:${Math.min(4, ordered.length)}">
          ${ordered.map((grant, index) => revealGrantMarkup(grant, index, { multi })).join("")}
        </div>
        <button type="button" class="pixel-menu-button reward-continue" aria-hidden="true" tabindex="-1" data-sound="cursor4" data-volume="0.28">Done</button>
      </section>
      ${Array.from({ length: 8 }, (_, index) => `<i class="shop-reveal-shard" style="--shard:${index}"></i>`).join("")}`;
    hydratePlayerCardMedia(reveal, { interactive: true });
    if (floating) reveal.classList.add("shop-floating-layer");
    // Seamless reveals replace an already-dimmed screen, so skip the fade-in.
    if (seamless) reveal.classList.add("is-seamless");
    (floating ? document.body : state.overlay).appendChild(reveal);
    onMounted?.();
    const floatingFocus = floating ? createModalFocus(reveal) : null;
    floatingFocus?.activate();
    state.reveal = reveal;
    const continueButton = reveal.querySelector("button");
    continueButton.style.visibility = "hidden";
    reveal.querySelector("[role=dialog]").focus({ preventScroll: true });
    let resolveDismissed;
    const dismissed = new Promise((resolve) => {
      resolveDismissed = resolve;
    });
    const dismiss = () => {
      closeReveal();
      resolveDismissed();
    };
    reveal.__dismiss = () => {
      floatingFocus?.deactivate();
      reveal.dataset.dismissed = "1";
      reveal.dispatchEvent(new Event("reward-dismiss"));
      reveal.querySelectorAll("[data-reveal-wallet]").forEach(node => writeWalletCount(node, result?.wallet?.[node.dataset.revealWallet]));
      updateWallet(result?.wallet, true, false);
      resolveDismissed();
    };
    continueButton.addEventListener("click", dismiss);
    reveal
      .querySelector(".shop-reveal-backdrop")
      ?.addEventListener("click", dismiss);
    const handleKey = (event) => {
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Escape") dismiss();
        else if (reveal.dataset.ready !== "1") reveal.querySelector("[role=dialog]").focus({ preventScroll: true });
        else {
          const buttons = [...reveal.querySelectorAll("button:not(:disabled)")];
          const index = buttons.indexOf(document.activeElement);
          buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKey, true);
    try {
      playSound(rewardSound(grants, rarity), 0.46);
      const debitAnimation = reducedMotion ? Promise.resolve() : animateWalletDebits(result?.wallet, grantedCurrencies);
      await Promise.race([delay(reducedMotion ? 0 : Math.max(420, 220 + grants.length * 75)), dismissed]);
      let readyDelay = 0;
      const animations = reveal.dataset.dismissed !== "1"
        ? Promise.all([debitAnimation, flyRewardCurrency(result?.grants || [], reveal, result?.wallet, ms => { readyDelay = ms; })])
        : Promise.resolve();
      await Promise.race([delay(readyDelay), dismissed]);
      if (reveal.dataset.dismissed === "1") return;
      onProfileInvalidate?.();
      reveal.dataset.ready = "1";
      continueButton.style.visibility = "";
      continueButton.removeAttribute("aria-hidden");
      continueButton.removeAttribute("tabindex");
      if (reveal.dataset.dismissed !== "1") continueButton.focus({ preventScroll: true });
      await dismissed;
      await animations;
    } finally {
      window.removeEventListener("keydown", handleKey, true);
      // An interrupted reveal must never leave the confirmed wallet stale.
      updateWallet(result?.wallet, true, false);
      if (state.reveal === reveal) closeReveal();
      if (previousFocus?.isConnected) {
        // A busy buy button is disabled; reviewItem refocuses it once re-enabled.
        if (!previousFocus.disabled) previousFocus.focus();
      }
    }
    await delay(reducedMotion ? 0 : 260);
  }

  return { closeReveal, showRewardReveal };
}
