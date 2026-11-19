import { API_PATHS } from "../../../shared/net/apiPaths.js";
import { formatCountdown } from "../../../shared/format.js";
import { applyWallet, subscribeWallet, walletRevision } from "../wallet.mjs";
import { mountWallet, releaseWallet, renderWalletBalances } from "../walletView.js";
import { escapeHtml } from "../../../shared/site/html.cjs";
import { showRewardPreview } from "../../views/playerCardPreview.js";
import { sonner } from "../../ui/sonner.js";
import { currencyRewardImage } from "../../views/rewardPresentation.js";
import { playSound } from "../../ui/uiSounds.js";
import { createModalFocus } from "../../ui/modalFocus.js";
import { warmPopupImages } from "../../ui/popupImages.js";
import { NEW_TAG, SHOP_ICON, currencyIcon, getActionState, grantArtSource, isBigPurchase, isFree, patchChildren, priceMarkup, sectionTree, shopSectionArt, tabMarkup } from "./shopMarkup.js";
import { purchaseDialog, purchaseReviewMarkup } from "./purchaseDialog.js";
import { createRewardPresentation } from "./rewardPresentation.js";
import { fetchShopJson, postShopJson, idempotencyKey } from "./shopRequests.js";
import { createStripeCheckout } from "./stripeCheckout.js";
import "../../styles/shop.css";

export { offerMarkup, sectionTree } from "./shopMarkup.js";
export { createRewardPresentation } from "./rewardPresentation.js";

const FRIENDLY_ERRORS = {
  insufficient_funds: { title: "Not enough currency", message: "Check your balance and choose another item or get more currency." },
  payments_unavailable: { title: "Checkout unavailable", message: "Try again in a moment." },
  account_required: { title: null, message: "Create an account to buy currency." },
  offer_ineligible: { title: "Offer unavailable", message: "You already own the featured cosmetic in this offer." },
  unknown_offer: { title: "Shop refreshed", message: "Pick from the latest offers." },
  price_changed: { title: "Price changed", message: "The sale refreshed. Open the shop again to see the current price." },
  order_not_found: { title: "Could not find this order", message: "Refresh the shop and check your balance before trying another purchase." },
};

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
          if (!state.open || document.visibilityState !== "visible" || hasCheckout() || state.reveal || state.data !== snapshot) return;
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
        await postShopJson(API_PATHS.API_SHOP_VIEWED, { rotations, offerIds });
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
    state.scroll.addEventListener("pointerover", warmOfferPreview);
    state.scroll.addEventListener("focusin", warmOfferPreview);
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

  function warmOfferPreview(event) {
    const button = event.target.closest("[data-shop-preview], [data-shop-action]");
    if (!button || button.contains(event.relatedTarget)) return;
    const item = findItem(button.dataset.shopPreview || button.dataset.itemId);
    warmPopupImages(item?.grants?.map(grant => grantArtSource(grant)) || []);
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
        state.data = await fetchShopJson(API_PATHS.API_SHOP_BOOTSTRAP);
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
    const firstOpen = !state.overlay;
    ensureShell();
    if (firstOpen && state.data) render();
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
    if (state.data) {
      position();
      if (firstOpen) trackViewedContent();
    }
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
        const result = await postShopJson(API_PATHS.API_SHOP_CLAIM_DAILY, { idempotencyKey: idempotencyKey("daily") });
        await handleSuccess({ result, button, item, kind: "daily" });
      } else if (action === "purchase") {
        showBusy(free ? "Claiming..." : "Buying...");
        const result = await postShopJson(API_PATHS.API_SHOP_PURCHASE, {
          offerId,
          expectedPrice: Number(price?.amount) || 0,
          expectedCurrency: price?.currency === "coins" ? "coins" : "gems",
          idempotencyKey: idempotencyKey("purchase"),
        });
        await handleSuccess({ result, button, item, floating, bridge });
      } else if (action === "checkout") {
        if (state.data?.account?.guest || guest) {
          window.location.href = `${API_PATHS.SIGNUP}?next=${encodeURIComponent(`${window.location.pathname}?shop=currency`)}`;
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

  const stripeCheckout = createStripeCheckout({ state, ensureShell, findItem, handleSuccess, refresh, shopToast, reportError });
  const { openCheckout, completeCheckout, closeCheckout, hasCheckout } = stripeCheckout;

  /* ---------- Background refresh and deep links. ---------- */

  // Refresh account state in the lobby too, including changes made on another device.
  function refreshNotifications() {
    if (state.open || document.visibilityState !== "visible") return;
    return refresh().then(() => {
      if (state.open) return;
      const sources = sectionMeta()
        .filter(meta => meta.id === "sales" || meta.id === "currency")
        .flatMap(meta => shopSectionArt(meta, state.data.sections?.[meta.id] || []));
      warmPopupImages(sources, { background: true });
    }).catch(error => console.warn("[shop] Notification refresh failed", error));
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (state.open) trackViewedContent();
      else void refreshNotifications();
    } else stopViewTracking();
  });
  window.setInterval(() => { if (!hasCheckout() && !state.reveal) void refreshNotifications(); }, 60000);
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
