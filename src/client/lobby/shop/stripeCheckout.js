import { API_PATHS } from "../../../shared/net/apiPaths.js";
import { playSound } from "../../ui/uiSounds.js";
import { createModalFocus } from "../../ui/modalFocus.js";
import { fetchShopJson, postShopJson, idempotencyKey } from "./shopRequests.js";

function delay(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

let stripeJsPromise;

function loadStripeJs() {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (stripeJsPromise) return stripeJsPromise;
  stripeJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/clover/stripe.js";
    script.async = true;
    script.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error("Stripe.js did not initialize.")));
    script.onerror = () => reject(new Error("Unable to load Stripe.js."));
    document.head.appendChild(script);
  });
  return stripeJsPromise;
}

export function createStripeCheckout({ state, ensureShell, findItem, handleSuccess, refresh, shopToast, reportError }) {
  let checkout = null;
  let checkoutAttempt = 0;
  let checkoutOfferId = null;
  let completingSessionId = null;
  let floatingCheckout = null;
  let checkoutFocus = null;
  let checkoutDismissed = null;

  async function openCheckout(offerId, floating) {
    ensureShell();
    closeCheckout();
    const attempt = checkoutAttempt;
    const panel = state.overlay.querySelector(".shop-checkout");
    let dismissed;
    if (floating) {
      floatingCheckout = panel;
      document.body.appendChild(panel);
      panel.classList.add("shop-floating-layer");
      checkoutFocus = createModalFocus(panel, { onEscape: closeCheckout });
      dismissed = new Promise(resolve => { checkoutDismissed = resolve; });
    }
    const host = panel.querySelector(".shop-checkout-host");
    panel.setAttribute("aria-hidden", "false");
    panel.classList.add("is-open");
    checkoutFocus?.activate();
    playSound("shopOpen", 0.28);
    host.innerHTML = '<div class="shop-checkout-loading"><span class="shop-loading-rune bb-battle-loader" aria-hidden="true"></span><strong>Opening checkout...</strong></div>';
    const result = await postShopJson(API_PATHS.API_SHOP_CHECKOUT_SESSION, {
      offerId,
      idempotencyKey: idempotencyKey("checkout"),
      returnPath: window.location.pathname,
    });
    if (attempt !== checkoutAttempt) return;
    checkoutOfferId = offerId;
    const Stripe = await loadStripeJs();
    if (attempt !== checkoutAttempt) return;
    const stripe = Stripe(state.data.payment.publishableKey);
    const embeddedCheckout = await stripe.initEmbeddedCheckout({
      clientSecret: result.clientSecret,
      onComplete: () => void completeCheckout(result.sessionId),
    });
    if (attempt !== checkoutAttempt) { embeddedCheckout.destroy(); return; }
    checkout = embeddedCheckout;
    host.innerHTML = "";
    checkout.mount(host);
    await dismissed;
  }

  async function completeCheckout(sessionId) {
    if (completingSessionId === sessionId) return;
    completingSessionId = sessionId;
    const terminalStatuses = ["failed", "expired", "refunded", "disputed"];
    try {
      let result = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        result = await fetchShopJson(`${API_PATHS.API_SHOP_CHECKOUT_STATUS}?sessionId=${encodeURIComponent(sessionId)}`);
        const status = result?.order?.status;
        if (status === "fulfilled" || terminalStatuses.includes(status)) break;
        await delay(750);
      }
      if (result?.order?.status === "fulfilled") {
        const item = findItem(checkoutOfferId || result?.order?.offer_id);
        const floating = !!floatingCheckout;
        const dismissed = checkoutDismissed;
        checkoutDismissed = null;
        const panel = floatingCheckout || state.overlay.querySelector(".shop-checkout-panel");
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
      completingSessionId = null;
    }
  }

  function closeCheckout() {
    checkoutAttempt += 1;
    if (!state.overlay) return;
    try {
      checkout?.destroy?.();
    } catch (_) {}
    checkout = null;
    checkoutOfferId = null;
    const panel = floatingCheckout || state.overlay.querySelector(".shop-checkout");
    if (floatingCheckout) {
      checkoutFocus.deactivate();
      checkoutFocus = null;
      panel.classList.remove("shop-floating-layer");
      state.overlay.appendChild(panel);
      floatingCheckout = null;
      checkoutDismissed?.();
      checkoutDismissed = null;
    }
    panel?.classList.remove("is-open");
    panel?.setAttribute("aria-hidden", "true");
    const host = panel?.querySelector(".shop-checkout-host");
    if (host) host.innerHTML = "";
  }

  return { openCheckout, completeCheckout, closeCheckout, hasCheckout: () => Boolean(checkout) };
}
