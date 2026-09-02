import { sonner } from "./lib/sonner.js";
import { playSound } from "./lib/uiSounds.js";
import { showUiConfirm } from "./lib/uiConfirm.js";
import "./styles/shop.css";

const SECTION_META = [
  { id: "sales", title: "Sales", icon: "/assets/shop/icons/sales-v2.png" },
  {
    id: "dailies",
    title: "Dailies",
    icon: "/assets/shop/icons/dailies-v2.png",
  },
  { id: "skins", title: "Skins", icon: "/assets/shop/icons/skins-v2.png" },
  {
    id: "profile",
    title: "Profile",
    icon: "/assets/shop/icons/profile-v2.png",
  },
  {
    id: "currency",
    title: "Gems & Coins",
    icon: "/assets/shop/icons/currency-v2.png",
  },
];

const FRIENDLY_ERRORS = {
  insufficient_funds: {
    title: "Not enough gems",
    message: "Choose another item or get more gems.",
  },
  payments_unavailable: {
    title: "Checkout unavailable",
    message: "Try again in a moment.",
  },
  account_required: {
    title: "Account required",
    message: "Sign up to buy currency.",
  },
  offer_ineligible: {
    title: "Already owned",
    message: "This bundle is no longer available.",
  },
  unknown_offer: {
    title: "Shop refreshed",
    message: "Pick from the latest offers.",
  },
  order_not_found: {
    title: "Order still processing",
    message: "Your wallet will update when it is ready.",
  },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeCssToken(value) {
  return String(value || "item").replace(/[^a-z0-9_-]/gi, "-");
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function idempotencyKey(prefix) {
  const uuid = window.crypto?.randomUUID?.();
  if (uuid) return `${prefix}:${uuid}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

async function fetchShopJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || "Shop request failed.");
    error.code = data?.code || null;
    error.wallet = data?.wallet || null;
    throw error;
  }
  return data;
}

function formatMoney(price) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format((Number(price?.amountCents) || 0) / 100);
}

function formatCountdown(targetIso) {
  const remaining = Math.max(0, new Date(targetIso).getTime() - Date.now());
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function priceMarkup(price) {
  if (!price || price.type === "free") {
    return '<span class="shop-price-free">FREE</span>';
  }
  if (price.type === "money") {
    return `<span class="shop-price-money">${formatMoney(price)}</span>`;
  }
  const currency = price.currency === "coins" ? "coins" : "gems";
  return `<span class="shop-price-virtual"><img src="/assets/${currency === "coins" ? "coin" : "gem"}.webp" alt="${currency}" /><strong>${(Number(price.amount) || 0).toLocaleString()}</strong></span>`;
}

function getActionState(item) {
  const itemState = item?.state || {};
  if (item.kind === "daily") {
    return {
      disabled: !!itemState.claimed || !itemState.available,
      label: itemState.claimed
        ? "CLAIMED"
        : itemState.available
          ? "FREE"
          : "UNAVAILABLE",
      action: "daily",
    };
  }
  if (itemState.owned) {
    return { disabled: true, label: "OWNED", action: null };
  }
  const offerId =
    item.offerId || (item.kind !== "browse-item" ? item.id : null);
  if (!offerId || !itemState.available) {
    return { disabled: true, label: "UNAVAILABLE", action: null };
  }
  if (item?.price?.type === "money") {
    return { disabled: false, label: null, action: "checkout", offerId };
  }
  return { disabled: false, label: null, action: "purchase", offerId };
}

function getItemTypeLabel(item, grants) {
  const primary = grants[0] || {};
  if (item.kind === "daily") {
    const currency = primary.currency === "gems" ? "GEMS" : "COINS";
    return `DAILY REWARD · ${currency}`;
  }
  if (item.kind === "bundle") {
    return `BUNDLE · ${grants.length} ${grants.length === 1 ? "ITEM" : "ITEMS"}`;
  }
  if (primary.kind === "skin") {
    return primary.character
      ? `${primary.character.toUpperCase()} SKIN`
      : "FIGHTER SKIN";
  }
  if (primary.kind === "card") return "PLAYER CARD";
  if (primary.kind === "profileIcon") return "PROFILE ICON";
  if (primary.kind === "currency") {
    return primary.currency === "gems" ? "GEM PACK" : "COIN PACK";
  }
  return "SHOP ITEM";
}

function getItemIcon(item, grants) {
  const primary = grants[0] || {};
  if (item.kind === "bundle") return "/assets/shop/icons/bundle-v2.png";
  if (primary.kind === "currency") {
    return primary.currency === "gems"
      ? "/assets/gem.webp"
      : "/assets/coin.webp";
  }
  if (primary.kind === "skin") return "/assets/shop/icons/skins-v2.png";
  if (primary.kind === "card" || primary.kind === "profileIcon")
    return "/assets/shop/icons/profile-v2.png";
  return "/assets/shop/icons/shop-v2.png";
}

function isBigPurchase(item) {
  if (item?.kind === "bundle") return true;
  if (item?.price?.type === "money")
    return Number(item.price.amountCents) >= 499;
  return Number(item?.price?.amount) >= 250;
}

function grantMarkup(grant, index, bundle) {
  const quantity = grant.kind === "currency" ? Number(grant.amount) || 0 : null;
  const kind = safeCssToken(grant.kind || "item");
  return `
    <span class="shop-grant shop-grant-${kind}${bundle ? " shop-bundle-item" : ""}" style="--grant-index:${index}">
      <span class="shop-grant-art">
        <span class="shop-grant-halo" aria-hidden="true"></span>
        ${!bundle && grant.kind === "currency" ? `<img class="shop-grant-echo shop-grant-echo-a" src="${escapeHtml(grant.image)}" alt="" /><img class="shop-grant-echo shop-grant-echo-b" src="${escapeHtml(grant.image)}" alt="" />` : ""}
        <img class="shop-grant-image" src="${escapeHtml(grant.image)}" alt="${escapeHtml(grant.name)}" />
      </span>
      <span class="shop-grant-copy">
        <strong>${quantity ? `${quantity.toLocaleString()} ` : ""}${escapeHtml(grant.name)}</strong>
        ${grant.character ? `<small>${escapeHtml(grant.character)}</small>` : ""}
      </span>
    </span>`;
}

function itemMarkup(item, sectionId, itemIndex) {
  const grants = Array.isArray(item?.grants) ? item.grants : [];
  const action = getActionState(item);
  const rarity = safeCssToken(String(item?.rarity || "common").toLowerCase());
  const showsRarity = sectionId === "skins" || sectionId === "profile";
  const isBundle = item.kind === "bundle";
  const isFeatured = sectionId === "sales";
  const unavailable =
    action.disabled && !item?.state?.owned && !item?.state?.claimed;
  const itemId = safeCssToken(item.id);
  const primaryGrant = grants[0] || {};
  const productKind = safeCssToken(primaryGrant.kind || item.kind || "item");
  const itemType = getItemTypeLabel(item, grants);
  const itemIcon = getItemIcon(item, grants);
  return `
    <article class="shop-offer${showsRarity ? ` shop-rarity-${rarity} has-rarity` : ""} shop-product-${productKind} shop-item-${itemId}${isBundle ? " shop-offer-bundle" : ""}${isFeatured ? " shop-offer-featured" : ""}${unavailable ? " is-unavailable" : ""}${item?.state?.owned ? " is-owned" : ""}${item?.state?.claimed ? " is-claimed" : ""}"
      data-shop-item-id="${escapeHtml(item.id)}" style="--offer-index:${itemIndex}" tabindex="0">
      <div class="shop-offer-visual${isBundle ? " is-bundle" : ""}">
        <img class="shop-banner-art" src="${escapeHtml(item.banner || "/assets/lushy/lobbyBg.webp")}" alt="" loading="lazy" />
        <span class="shop-banner-scrim" aria-hidden="true"></span>
        <span class="shop-banner-light" aria-hidden="true"></span>
        ${item.badge ? `<span class="shop-offer-badge">${escapeHtml(item.badge)}</span>` : ""}
        ${showsRarity ? `<span class="shop-rarity-badge">${escapeHtml(rarity)}</span>` : ""}
        ${isFeatured ? '<span class="shop-sale-sheen" aria-hidden="true"></span>' : ""}
        <div class="shop-product-stage${isBundle ? " is-bundle" : ""}" data-product-count="${grants.length}">
          ${grants.map((grant, index) => grantMarkup(grant, index, isBundle)).join("")}
        </div>
      </div>
      <div class="shop-offer-body">
        <div class="shop-offer-name"><img src="${escapeHtml(itemIcon)}" alt="" /><h3>${escapeHtml(item.name)}</h3></div>
        <span class="shop-offer-type">${escapeHtml(itemType)}</span>
      </div>
      <div class="shop-offer-footer">
        <button class="shop-buy-button" type="button"
          data-shop-action="${escapeHtml(action.action || "")}" data-offer-id="${escapeHtml(action.offerId || "")}" data-item-id="${escapeHtml(item.id)}"
          ${action.disabled ? "disabled" : ""}>${action.disabled ? `<span class="shop-action-state">${escapeHtml(action.label)}</span>` : priceMarkup(item.price)}</button>
      </div>
    </article>`;
}

function sectionMarkup(meta, items) {
  const timerKind =
    meta.id === "sales" ? "sales" : meta.id === "dailies" ? "dailies" : null;
  return `
    <section class="shop-section shop-section-${meta.id}" id="shop-section-${meta.id}">
      <header class="shop-section-head">
        <div class="shop-section-copy"><img src="${escapeHtml(meta.icon)}" alt="" /><h2>${escapeHtml(meta.title)}</h2></div>
        ${timerKind ? `<div class="shop-reset-chip"><span>Refresh</span><strong data-shop-countdown="${timerKind}">--:--:--</strong></div>` : ""}
      </header>
      <div class="shop-offer-grid${meta.id === "sales" ? " shop-sales-grid" : ""}">
        ${items.length ? items.map((item, index) => itemMarkup(item, meta.id, index)).join("") : '<div class="shop-empty"><strong>Nothing here yet.</strong></div>'}
      </div>
    </section>`;
}

function loadStripeJs() {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (window.__bbStripeJsPromise) return window.__bbStripeJsPromise;
  window.__bbStripeJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/clover/stripe.js";
    script.async = true;
    script.onload = () =>
      window.Stripe
        ? resolve(window.Stripe)
        : reject(new Error("Stripe.js did not initialize."));
    script.onerror = () => reject(new Error("Unable to load Stripe.js."));
    document.head.appendChild(script);
  });
  return window.__bbStripeJsPromise;
}

export function initializeShop({
  userData,
  guest,
  onWalletChange,
  onProfileInvalidate,
} = {}) {
  const state = {
    data: null,
    overlay: null,
    scroll: null,
    open: false,
    loading: false,
    timer: null,
    refreshingAtBoundary: false,
    checkout: null,
    checkoutSessionId: null,
    checkoutOfferId: null,
    completingSessionId: null,
    reveal: null,
    activeSection: null,
    scrollSpyFrame: null,
  };

  function shopToast(tone, title, message, duration = 4800) {
    return sonner(title, message, "Got it", undefined, {
      duration,
      tone,
      sound:
        tone === "error"
          ? "shopError"
          : tone === "success"
            ? "shopConfirm"
            : null,
      soundVolume: 0.35,
    });
  }

  function friendlyError(error, context = "action") {
    if (FRIENDLY_ERRORS[error?.code]) return FRIENDLY_ERRORS[error.code];
    if (context === "load") {
      return {
        title: "Shop unavailable",
        message: "Try again in a moment.",
      };
    }
    if (context === "checkout") {
      return {
        title: "Checkout unavailable",
        message: "Nothing was charged. Try again.",
      };
    }
    return {
      title: "Try again",
      message: "Nothing was lost.",
    };
  }

  function reportError(error, context) {
    console.error(`[shop] ${context}`, error);
    const copy = friendlyError(error, context);
    shopToast("error", copy.title, copy.message);
  }

  function ensureShell() {
    if (state.overlay) return;
    const overlay = document.createElement("div");
    overlay.className = "shop-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="shop-backdrop"><span></span><span></span></div>
      <section class="shop-window" role="dialog" aria-modal="true" aria-labelledby="shop-title">
        <header class="shop-header">
          <div class="shop-brand">
            <img class="shop-title-icon" src="/assets/shop/icons/shop-v2.png" alt="" /><h1 id="shop-title">Bro Shop</h1>
          </div>
          <div class="shop-header-wallet" aria-label="Your wallet">
            <span data-shop-wallet-shell="coins"><small>COINS</small><img src="/assets/coin.webp" alt="" /><strong data-shop-wallet="coins">0</strong></span>
            <span data-shop-wallet-shell="gems"><small>GEMS</small><img src="/assets/gem.webp" alt="" /><strong data-shop-wallet="gems">0</strong></span>
          </div>
          <button class="shop-close bb-close pixel-menu-button" type="button" aria-label="Close shop">×</button>
        </header>
        <nav class="shop-tabs" aria-label="Jump to a shop section">
          ${SECTION_META.map((meta) => `<button type="button" data-shop-jump="${meta.id}" data-sound="cursor4" data-volume="0.22"><img class="shop-tab-icon" src="${escapeHtml(meta.icon)}" alt="" /><span>${escapeHtml(meta.title)}</span></button>`).join("")}
        </nav>
        <div class="shop-scroll"><div class="shop-loading"><span class="shop-loading-rune"></span><strong>Opening shop...</strong></div></div>
      </section>
      <div class="shop-checkout" aria-hidden="true">
        <div class="shop-checkout-backdrop"></div>
        <section class="shop-checkout-panel" role="dialog" aria-modal="true" aria-labelledby="shop-checkout-title">
          <header><h2 id="shop-checkout-title">Secure Checkout</h2><button type="button" class="shop-checkout-close bb-close pixel-menu-button" aria-label="Close checkout">×</button></header>
          <div class="shop-checkout-host"></div>
        </section>
      </div>`;
    document.body.appendChild(overlay);
    state.overlay = overlay;
    state.scroll = overlay.querySelector(".shop-scroll");

    overlay.querySelector(".shop-close")?.addEventListener("click", close);
    overlay.querySelector(".shop-backdrop")?.addEventListener("click", close);
    overlay
      .querySelector(".shop-checkout-close")
      ?.addEventListener("click", () => {
        playSound("cancel", 0.3);
        closeCheckout();
      });
    overlay
      .querySelector(".shop-checkout-backdrop")
      ?.addEventListener("click", closeCheckout);
    overlay.querySelectorAll("[data-shop-jump]").forEach((button) => {
      button.addEventListener("click", () => jumpTo(button.dataset.shopJump));
    });
    state.scroll.addEventListener(
      "scroll",
      () => {
        if (state.scrollSpyFrame) return;
        state.scrollSpyFrame = window.requestAnimationFrame(() => {
          state.scrollSpyFrame = null;
          updateActiveSection();
        });
      },
      { passive: true },
    );
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !state.open) return;
      const checkout = state.overlay.querySelector(".shop-checkout");
      if (state.reveal?.dataset.ready === "1") closeReveal();
      else if (checkout?.getAttribute("aria-hidden") === "false")
        closeCheckout();
      else close();
    });
  }

  function updateWallet(wallet, notify = true, pulse = false) {
    if (!wallet) return;
    const normalized = {
      coins: Number(wallet.coins) || 0,
      gems: Number(wallet.gems) || 0,
    };
    if (state.data) state.data.wallet = normalized;
    state.overlay?.querySelectorAll("[data-shop-wallet]").forEach((node) => {
      const currency = node.dataset.shopWallet;
      node.textContent = normalized[currency].toLocaleString();
      if (pulse) {
        const shell = node.closest("[data-shop-wallet-shell]");
        shell?.animate(
          [
            { transform: "scale(1)", filter: "brightness(1)" },
            {
              transform: "scale(1.12)",
              filter: "brightness(1.5)",
              offset: 0.42,
            },
            { transform: "scale(1)", filter: "brightness(1)" },
          ],
          { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" },
        );
      }
    });
    if (notify) onWalletChange?.(normalized);
  }

  function render({ preserveScroll = true, animateOffers = false } = {}) {
    if (!state.data || !state.scroll) return;
    const previousTop = preserveScroll ? state.scroll.scrollTop : 0;
    updateWallet(state.data.wallet, false);
    state.scroll.innerHTML = SECTION_META.map((meta) =>
      sectionMarkup(meta, state.data.sections?.[meta.id] || []),
    ).join("");
    state.scroll.scrollTop = previousTop;
    wireOfferActions();
    wireOfferMotion();
    if (animateOffers) {
      stageOffers();
    } else {
      state.scroll.querySelectorAll(".shop-offer").forEach((offer) => {
        offer.dataset.staged = "1";
        offer.style.opacity = "1";
      });
    }
    updateCountdowns();
    updateActiveSection();
  }

  function wireOfferMotion() {
    if (!window.matchMedia?.("(pointer: fine)").matches) return;
    state.scroll?.querySelectorAll(".shop-offer").forEach((offer) => {
      offer.addEventListener("pointermove", (event) => {
        const rect = offer.getBoundingClientRect();
        const x = Math.max(
          0,
          Math.min(1, (event.clientX - rect.left) / rect.width),
        );
        const y = Math.max(
          0,
          Math.min(1, (event.clientY - rect.top) / rect.height),
        );
        offer.style.setProperty("--light-x", `${x * 100}%`);
        offer.style.setProperty("--light-y", `${y * 100}%`);
        offer.style.setProperty("--tilt-x", `${(0.5 - y) * 2.6}deg`);
        offer.style.setProperty("--tilt-y", `${(x - 0.5) * 3.2}deg`);
      });
      offer.addEventListener("pointerleave", () => {
        offer.style.setProperty("--tilt-x", "0deg");
        offer.style.setProperty("--tilt-y", "0deg");
      });
    });
  }

  function stageOffers() {
    const offers = state.scroll?.querySelectorAll(".shop-offer") || [];
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || entry.target.dataset.staged === "1")
            return;
          entry.target.dataset.staged = "1";
          const index =
            Number(entry.target.style.getPropertyValue("--offer-index")) || 0;
          const offerEntrance = entry.target.animate(
            [
              { opacity: 0, transform: "translateY(28px) scale(.975)" },
              { opacity: 1, transform: "translateY(0) scale(1)" },
            ],
            {
              duration: 520,
              delay: Math.min(index, 3) * 65,
              easing: "cubic-bezier(.16,.8,.24,1)",
              fill: "both",
            },
          );
          offerEntrance.finished.then(() => {
            entry.target.style.opacity = "1";
            offerEntrance.cancel();
          });
          entry.target
            .querySelectorAll(".shop-bundle-item")
            .forEach((item, grantIndex) => {
              item.animate(
                [
                  { opacity: 0, transform: "translateY(18px) scale(.82)" },
                  { opacity: 1, transform: "translateY(0) scale(1)" },
                ],
                {
                  duration: 460,
                  delay: 210 + grantIndex * 110,
                  easing: "cubic-bezier(.2,.9,.2,1)",
                  fill: "both",
                },
              );
            });
          observer.unobserve(entry.target);
        });
      },
      { root: state.scroll, threshold: 0.13 },
    );
    offers.forEach((offer) => observer.observe(offer));
  }

  async function refresh(options = {}) {
    if (state.loading) return state.data;
    state.loading = true;
    try {
      state.data = await fetchShopJson("/api/shop/bootstrap");
      render(options);
      return state.data;
    } finally {
      state.loading = false;
    }
  }

  function jumpTo(section) {
    setActiveSection(section);
    state.overlay
      ?.querySelector(`#shop-section-${CSS.escape(String(section || "sales"))}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setActiveSection(section) {
    const nextSection = SECTION_META.some((meta) => meta.id === section)
      ? section
      : "sales";
    if (state.activeSection === nextSection) return;
    state.activeSection = nextSection;
    let activeButton = null;
    state.overlay?.querySelectorAll("[data-shop-jump]").forEach((button) => {
      const active = button.dataset.shopJump === nextSection;
      button.classList.toggle("is-active", active);
      if (active) {
        activeButton = button;
        button.setAttribute("aria-current", "location");
      } else button.removeAttribute("aria-current");
    });
    const tabs = activeButton?.closest(".shop-tabs");
    if (tabs && tabs.scrollWidth > tabs.clientWidth) {
      tabs.scrollTo({
        left:
          activeButton.offsetLeft -
          (tabs.clientWidth - activeButton.offsetWidth) / 2,
        behavior: "smooth",
      });
    }
  }

  function updateActiveSection() {
    if (!state.scroll) return;
    let active = SECTION_META[0].id;
    const threshold =
      state.scroll.getBoundingClientRect().top +
      Math.min(160, state.scroll.clientHeight * 0.24);
    for (const meta of SECTION_META) {
      const section = state.scroll.querySelector(
        `#shop-section-${CSS.escape(meta.id)}`,
      );
      if (section && section.getBoundingClientRect().top <= threshold)
        active = meta.id;
    }
    if (
      state.scroll.scrollTop + state.scroll.clientHeight >=
      state.scroll.scrollHeight - 4
    ) {
      active = SECTION_META.at(-1).id;
    }
    setActiveSection(active);
  }

  function open(section = "sales") {
    ensureShell();
    state.open = true;
    void state.overlay.offsetWidth;
    state.overlay.classList.add("is-open");
    state.overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("shop-is-open");
    playSound("shopOpen", 0.38);
    if (!state.timer) state.timer = window.setInterval(updateCountdowns, 1000);
    return refresh({ preserveScroll: false })
      .then(() => requestAnimationFrame(() => jumpTo(section)))
      .catch((error) => {
        state.scroll.innerHTML =
          '<div class="shop-load-error"><strong>Shop unavailable.</strong><button type="button" data-sound="cursor4">Try Again</button></div>';
        state.scroll
          .querySelector("button")
          ?.addEventListener("click", () => void refresh());
        reportError(error, "load");
      });
  }

  function close() {
    if (!state.overlay) return;
    closeReveal();
    closeCheckout();
    state.open = false;
    state.overlay.classList.remove("is-open");
    state.overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("shop-is-open");
    playSound("cancel", 0.34);
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
  }

  function updateCountdowns() {
    if (!state.open || !state.data) return;
    let expired = false;
    for (const kind of ["dailies", "sales"]) {
      const target = state.data.rotations?.[kind]?.nextRefreshAt;
      state.overlay
        .querySelectorAll(`[data-shop-countdown="${kind}"]`)
        .forEach((node) => {
          node.textContent = target ? formatCountdown(target) : "--:--:--";
        });
      if (target && new Date(target).getTime() <= Date.now()) expired = true;
    }
    if (expired && !state.refreshingAtBoundary) {
      state.refreshingAtBoundary = true;
      void refresh().finally(() => {
        state.refreshingAtBoundary = false;
      });
    }
  }

  function closeReveal() {
    if (!state.reveal) return;
    const reveal = state.reveal;
    state.reveal = null;
    reveal.classList.add("is-leaving");
    window.setTimeout(() => reveal.remove(), 260);
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
    for (let sparkIndex = 0; sparkIndex < 5; sparkIndex += 1) {
      const angle = (Math.PI * 2 * sparkIndex) / 5 + impactIndex * 0.37;
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
    playSound("shopCurrencyImpact", 0.14, {
      overlap: true,
      playbackRate: 0.88 + pitchRange * 0.3 + (currency === "gems" ? 0.08 : 0),
    });
  }

  function flyWalletParticle({
    sourceRect,
    target,
    currency,
    index,
    count,
    onImpact,
  }) {
    return new Promise((resolve) => {
      window.setTimeout(() => {
        const icon = document.createElement("img");
        icon.className = `shop-flying-currency shop-flying-${currency}`;
        icon.src =
          currency === "gems" ? "/assets/gem.webp" : "/assets/coin.webp";
        icon.alt = "";
        document.body.appendChild(icon);

        const spread = index - (count - 1) / 2;
        let x = sourceRect.left + sourceRect.width / 2 + spread * 4;
        let y = sourceRect.top + sourceRect.height / 2;
        let vx = spread * 48 + (Math.random() - 0.5) * 85;
        let vy = -360 - Math.random() * 120;
        let rotation = spread * 9;
        let startedAt = null;
        let previousAt = null;

        const finish = () => {
          icon.remove();
          onImpact();
          resolve();
        };

        const frame = (now) => {
          if (!startedAt) {
            startedAt = now;
            previousAt = now;
          }
          const elapsed = (now - startedAt) / 1000;
          const dt = Math.min(
            0.032,
            Math.max(0.001, (now - previousAt) / 1000),
          );
          previousAt = now;
          const targetRect = target.getBoundingClientRect();
          const targetX = targetRect.left + targetRect.width / 2;
          const targetY = targetRect.top + targetRect.height / 2;

          if (elapsed < 0.24) {
            vy += 1180 * dt;
          } else {
            const pull = Math.min(48, 18 + (elapsed - 0.24) * 34);
            vx += (targetX - x) * pull * dt;
            vy += (targetY - y) * pull * dt;
            const drag = Math.exp(-5.2 * dt);
            vx *= drag;
            vy *= drag;
          }

          x += vx * dt;
          y += vy * dt;
          rotation += (160 + index * 12) * dt * (index % 2 ? -1 : 1);
          const distance = Math.hypot(targetX - x, targetY - y);
          const scale =
            elapsed < 0.16
              ? Math.min(1, elapsed / 0.16)
              : Math.max(0.32, Math.min(1, distance / 85));
          icon.style.opacity = String(Math.min(1, elapsed / 0.08));
          icon.style.transform = `translate3d(${x - 16}px, ${y - 16}px, 0) rotate(${rotation}deg) scale(${scale})`;

          if ((elapsed > 0.34 && distance < 17) || elapsed > 1.55) finish();
          else window.requestAnimationFrame(frame);
        };
        window.requestAnimationFrame(frame);
      }, index * 72);
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

  async function flyRewardCurrency(grants, reveal, wallet) {
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
      const sourceRect = source.getBoundingClientRect();
      const startValue = readWalletCount(counter);
      const endValue = Number(wallet?.[currency]) || startValue + amount;
      const count = Math.min(
        9,
        Math.max(5, Math.ceil(Math.log10(amount + 1) * 2)),
      );
      let impacts = 0;
      const onImpact = () => {
        impacts += 1;
        const progress = impacts / count;
        const eased = 1 - Math.pow(1 - progress, 2);
        writeWalletCount(counter, startValue + (endValue - startValue) * eased);
        burstWalletTarget(target, counter, currency, impacts - 1, count);
      };
      for (let index = 0; index < count; index += 1) {
        flights.push(
          flyWalletParticle({
            sourceRect,
            target,
            currency,
            index,
            count,
            onImpact,
          }),
        );
      }
    }
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

  function revealGrantMarkup(grant, index) {
    const quantity = grant.kind === "currency" ? Number(grant.amount) || 0 : 0;
    const currency =
      grant.kind === "currency"
        ? grant.currency === "gems"
          ? "gems"
          : "coins"
        : null;
    return `<div class="shop-reveal-grant shop-reveal-${safeCssToken(grant.kind)}" style="--reveal-index:${index}"${currency ? ` data-reveal-currency="${currency}"` : ""}><span><i></i><img src="${escapeHtml(grant.image)}" alt="${escapeHtml(grant.name)}" /></span><strong>${quantity ? `${quantity.toLocaleString()} ` : ""}${escapeHtml(grant.name)}</strong>${grant.character ? `<small>${escapeHtml(grant.character)}</small>` : ""}</div>`;
  }

  function getRevealTitle(item, grants, kind) {
    if (kind === "daily") return "Daily Reward";
    if (grants.length && grants.every((grant) => grant.kind === "currency"))
      return "Wallet Updated";
    if (item?.kind === "bundle") return "Bundle Unlocked";
    const primaryKind = grants[0]?.kind;
    if (primaryKind === "skin") return "New Skin";
    if (primaryKind === "card") return "New Player Card";
    if (primaryKind === "profileIcon") return "New Profile Icon";
    return "Purchase Complete";
  }

  async function showRewardReveal({ result, item, kind, sourceRect }) {
    closeReveal();
    const grants = item?.grants || [];
    const rarity = safeCssToken(item?.rarity || "rare");
    const heading =
      kind === "daily"
        ? "CLAIMED"
        : item?.price?.type === "money"
          ? "PURCHASED"
          : "UNLOCKED";
    const title = getRevealTitle(item, grants, kind);
    const startingWallet = {
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
    reveal.className = `shop-reward-reveal shop-rarity-${rarity}`;
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
        <span data-reveal-wallet-shell="coins"><img src="/assets/coin.webp" alt="" /><small>COINS</small><strong data-reveal-wallet="coins">${startingWallet.coins.toLocaleString()}</strong></span>
        <span data-reveal-wallet-shell="gems"><img src="/assets/gem.webp" alt="" /><small>GEMS</small><strong data-reveal-wallet="gems">${startingWallet.gems.toLocaleString()}</strong></span>
      </div>
      <section class="shop-reveal-panel" role="dialog" aria-modal="true" aria-label="Purchase complete">
        <header class="shop-reveal-heading"><span class="shop-reveal-kicker">${escapeHtml(heading)}</span><h2>${escapeHtml(title)}</h2></header>
        <div class="shop-reveal-grants">${grants.map(revealGrantMarkup).join("")}</div>
        <button type="button" data-sound="cursor4" data-volume="0.28">Done</button>
      </section>
      ${Array.from({ length: 8 }, (_, index) => `<i class="shop-reveal-shard" style="--shard:${index}"></i>`).join("")}`;
    state.overlay.appendChild(reveal);
    state.reveal = reveal;
    const continueButton = reveal.querySelector("button");
    continueButton.disabled = true;
    let resolveDismissed;
    const dismissed = new Promise((resolve) => {
      resolveDismissed = resolve;
    });
    const dismiss = () => {
      if (reveal.dataset.ready !== "1") return;
      closeReveal();
      resolveDismissed();
    };
    continueButton.addEventListener("click", dismiss);
    reveal
      .querySelector(".shop-reveal-backdrop")
      ?.addEventListener("click", dismiss);
    playSound("shopReveal", 0.46);
    const debitAnimation = animateWalletDebits(
      result?.wallet,
      grantedCurrencies,
    );
    await delay(440);
    await Promise.all([
      debitAnimation,
      flyRewardCurrency(result?.grants || [], reveal, result?.wallet),
    ]);
    updateWallet(result?.wallet, true, false);
    onProfileInvalidate?.();
    reveal.dataset.ready = "1";
    continueButton.disabled = false;
    await Promise.race([delay(1150), dismissed]);
    closeReveal();
    await delay(260);
  }

  async function handleSuccess({ result, button, item, kind = "purchase" }) {
    const card = button?.closest?.(".shop-offer");
    const sourceRect = card
      ?.querySelector(".shop-offer-visual")
      ?.getBoundingClientRect();
    card?.classList.add("is-completing");
    playSound(
      isBigPurchase(item) ? "shopBigSuccess" : "shopConfirm",
      isBigPurchase(item) ? 0.52 : 0.42,
    );
    await showRewardReveal({ result, item, kind, sourceRect });
    await refresh({ preserveScroll: true, animateOffers: false });
  }

  function wireOfferActions() {
    state.scroll?.querySelectorAll("[data-shop-action]").forEach((button) => {
      const action = button.dataset.shopAction;
      if (!action) return;
      button.addEventListener("click", async () => {
        if (button.disabled) return;
        const offerId = String(button.dataset.offerId || "");
        const itemId = String(button.dataset.itemId || "");
        const item = findItem(itemId) || findItem(offerId);
        button.disabled = true;
        const original = button.innerHTML;
        try {
          if (action === "daily") {
            button.innerHTML = "<span>Opening...</span>";
            const result = await fetchShopJson("/api/shop/claim-daily", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ idempotencyKey: idempotencyKey("daily") }),
            });
            await handleSuccess({ result, button, item, kind: "daily" });
            return;
          }
          if (action === "purchase") {
            const currency =
              item?.price?.currency === "coins" ? "coins" : "gems";
            const amount = Number(item?.price?.amount) || 0;
            const balance = Number(state.data?.wallet?.[currency]) || 0;
            if (balance < amount) {
              shopToast(
                "error",
                `Not enough ${currency}`,
                `You need ${(amount - balance).toLocaleString()} more ${currency}.`,
              );
              return;
            }
            const ok = await showUiConfirm({
              title: `Unlock ${item?.name || "this item"}?`,
              message: "Add it to your collection?",
              confirmLabel: amount.toLocaleString(),
              cancelLabel: "Back",
              confirmIcon:
                currency === "coins" ? "/assets/coin.webp" : "/assets/gem.webp",
              confirmSound: "shopBuy",
              cancelSound: "cancel",
            });
            if (!ok) return;
            button.innerHTML = "<span>Forging...</span>";
            const result = await fetchShopJson("/api/shop/purchase", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                offerId,
                idempotencyKey: idempotencyKey("purchase"),
              }),
            });
            await handleSuccess({ result, button, item });
            return;
          }
          if (action === "checkout") {
            if (state.data?.account?.guest || guest) {
              const next = `${window.location.pathname}?shop=currency`;
              window.location.href = `/signup?next=${encodeURIComponent(next)}`;
              return;
            }
            button.innerHTML = "<span>Opening...</span>";
            try {
              await openCheckout(offerId);
            } catch (error) {
              closeCheckout();
              reportError(error, "checkout");
            }
          }
        } catch (error) {
          if (error.wallet) updateWallet(error.wallet);
          reportError(error, action === "checkout" ? "checkout" : "action");
        } finally {
          if (button.isConnected) {
            button.disabled = false;
            button.innerHTML = original;
          }
        }
      });
    });
  }

  function findItem(id) {
    const wanted = String(id || "");
    for (const items of Object.values(state.data?.sections || {})) {
      const item = (items || []).find(
        (candidate) =>
          String(candidate?.id || "") === wanted ||
          String(candidate?.offerId || "") === wanted,
      );
      if (item) return item;
    }
    return null;
  }

  async function openCheckout(offerId) {
    const panel = state.overlay.querySelector(".shop-checkout");
    const host = panel.querySelector(".shop-checkout-host");
    panel.setAttribute("aria-hidden", "false");
    panel.classList.add("is-open");
    playSound("shopOpen", 0.28);
    host.innerHTML =
      '<div class="shop-checkout-loading"><span class="shop-loading-rune"></span><strong>Opening checkout...</strong></div>';
    const result = await fetchShopJson("/api/shop/checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offerId,
        idempotencyKey: idempotencyKey("checkout"),
        returnPath: window.location.pathname,
      }),
    });
    state.checkoutSessionId = result.sessionId;
    state.checkoutOfferId = offerId;
    const Stripe = await loadStripeJs();
    const stripe = Stripe(state.data.payment.publishableKey);
    state.checkout = await stripe.initEmbeddedCheckout({
      clientSecret: result.clientSecret,
      onComplete: () => void completeCheckout(result.sessionId),
    });
    host.innerHTML = "";
    state.checkout.mount(host);
  }

  async function completeCheckout(sessionId) {
    if (state.completingSessionId === sessionId) return;
    state.completingSessionId = sessionId;
    try {
      let result = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        result = await fetchShopJson(
          `/api/shop/checkout-status?sessionId=${encodeURIComponent(sessionId)}`,
        );
        if (
          result?.order?.status === "fulfilled" ||
          ["failed", "expired", "refunded", "disputed"].includes(
            result?.order?.status,
          )
        ) {
          break;
        }
        await delay(750);
      }
      if (result?.order?.status === "fulfilled") {
        const item = findItem(state.checkoutOfferId || result?.order?.offer_id);
        const panel = state.overlay.querySelector(".shop-checkout-panel");
        closeCheckout();
        await handleSuccess({ result, button: panel, item, kind: "checkout" });
      } else {
        closeCheckout();
        await refresh();
        shopToast(
          "info",
          "Almost there",
          "Your balance will update automatically.",
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
    if (!state.overlay) return;
    try {
      state.checkout?.destroy?.();
    } catch (_) {}
    state.checkout = null;
    state.checkoutSessionId = null;
    state.checkoutOfferId = null;
    const panel = state.overlay.querySelector(".shop-checkout");
    panel?.classList.remove("is-open");
    panel?.setAttribute("aria-hidden", "true");
    const host = panel?.querySelector(".shop-checkout-host");
    if (host) host.innerHTML = "";
  }

  ensureShell();
  const url = new URL(window.location.href);
  const returnedSession = url.searchParams.get("shop_checkout");
  const requestedSection = url.searchParams.get("shop");
  if (returnedSession || requestedSection) {
    url.searchParams.delete("shop_checkout");
    url.searchParams.delete("shop");
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    window.setTimeout(async () => {
      await open(returnedSession ? "currency" : requestedSection || "sales");
      if (returnedSession) await completeCheckout(returnedSession);
    }, 0);
  }

  return { open, close, refresh, jumpTo };
}
