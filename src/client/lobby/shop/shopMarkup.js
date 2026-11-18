import { rarityRank } from "../../../shared/catalogs/rarities.js";
import { formatCount, formatUsd } from "../../../shared/format.js";
import { titleMarkup } from "../../views/titleView.js";
import { getCharacterDisplayName } from "../../../shared/characters/characterStats.js";
import { escapeHtml } from "../../../shared/site/html.cjs";
import { playerCardImage } from "../../views/playerCardAnimation.cjs";
import { currencyRewardImage } from "../../views/rewardPresentation.js";


export const SHOP_ICON = "/assets/shop/icons/shop-v2.webp";

const PROFILE_ICON = "/assets/shop/icons/profile-v2.webp";

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

export const grantKind = grant => GRANT_KINDS[grant?.kind] || UNKNOWN_KIND;

export function safeCssToken(value) {
  return String(value || "item").replace(/[^a-z0-9_-]/gi, "-");
}

function formatMoney(price) {
  return formatUsd(price?.amountCents);
}

const currencyImage = currency => `/assets/icons/${currency === "coins" ? "coin" : "gem"}.webp`;

export function currencyIcon(currency) {
  return `<img class="purchase-currency-icon" src="${currencyImage(currency)}" alt="">`;
}

export function priceMarkup(price) {
  if (!price || price.type === "free") return '<span class="shop-price-free">FREE</span>';
  if (price.type === "money") return `<span class="shop-price-money">${formatMoney(price)}</span>`;
  const currency = price.currency === "coins" ? "coins" : "gems";
  return `<span class="shop-price-virtual"><img src="${currencyImage(currency)}" alt="${currency}" /><strong>${formatCount(price.amount)}</strong></span>`;
}

export const isFree = price => !price || price.type === "free" || (price.type === "virtual" && !(Number(price.amount) > 0));

export function grantLabel(grant, { signed = false } = {}) {
  if (grant.kind !== "currency") return grant.name;
  return `${signed ? "+" : ""}${formatCount(grant.amount)} ${grant.name}`;
}

export function grantArtMarkup(grant, { reveal = false } = {}) {
  if (grant.kind === "title") return `<span class="title-presentation-box">${titleMarkup(grant.id)}</span>`;
  if (grant.kind === "currency") return `<img src="${escapeHtml(currencyRewardImage(grant.currency, grant.amount))}" alt="${reveal ? escapeHtml(grant.name) : ""}" />`;
  if (reveal && grant.kind === "card") return `<img data-animated-card-id="${escapeHtml(grant.id)}" src="${escapeHtml(playerCardImage(grant.id, { animate: false }))}" alt="${escapeHtml(grant.name)}" />`;
  return `<img src="${escapeHtml((reveal ? grant.image : grant.shopImage || grant.image) || "")}" alt="${reveal ? escapeHtml(grant.name) : ""}" />`;
}

export function getActionState(item) {
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

export function isBigPurchase(item) {
  if (item?.kind === "bundle") return true;
  if (item?.price?.type === "money") return Number(item.price.amountCents) >= 499;
  return Number(item?.price?.amount) >= 250;
}

const INFO_ICON = '<svg class="shop-info-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><path fill="currentColor" d="M6 2h4v3H6zM4 7h6v5h2v2H4v-2h2V9H4z" /></svg>';

export const NEW_TAG = '<span class="shop-new-tag" data-shop-new>NEW</span>';

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
      .sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || String(a.name).localeCompare(String(b.name)));
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

export function tabMarkup(meta, notifications) {
  return `<button type="button" data-shop-jump="${escapeHtml(meta.id)}" data-sound="cursor4" data-volume="0.22"><img class="shop-tab-icon" src="${escapeHtml(meta.icon)}" alt="" /><span>${escapeHtml(meta.name)}</span>${notifications?.sections?.[meta.id]?.hasNew ? NEW_TAG : ""}</button>`;
}

const renderedMarkup = new WeakMap();

function elementFromHtml(html) {
  const box = document.createElement("div");
  box.innerHTML = html.trim();
  return box.firstElementChild;
}

export function patchChildren(parent, entries) {
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
