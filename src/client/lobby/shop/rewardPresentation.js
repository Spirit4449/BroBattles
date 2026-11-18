const REWARD_DISMISSED_EVENT = "reward-dismiss";

import { escapeHtml } from "../../../shared/site/html.cjs";
import { hydratePlayerCardMedia, disposePlayerCardMediaWithin } from "../../views/playerCardAnimation.cjs";
import { rewardSound, currencyParticleCount, currencyFlightPlan, resolveRewardGrants } from "../../views/rewardPresentation.js";
import { playSound } from "../../ui/uiSounds.js";
import { createModalFocus } from "../../ui/modalFocus.js";
import { safeCssToken, grantLabel, grantArtMarkup, grantKind, currencyIcon } from "./shopMarkup.js";

function delay(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

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
      reveal.addEventListener(REWARD_DISMISSED_EVENT, cancel, { once: true });
      animation.finished.then(() => { if (reveal.dataset.dismissed !== "1") onImpact(); }, () => {}).finally(() => {
        reveal.removeEventListener(REWARD_DISMISSED_EVENT, cancel);
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
      reveal.dispatchEvent(new Event(REWARD_DISMISSED_EVENT));
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
