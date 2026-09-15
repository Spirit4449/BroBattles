import { currencyRewardImage } from "../lib/rewardPresentation.js";
import { playSound } from "../lib/uiSounds.js";
import { createRewardPresentation } from "../shop.js";
import { buildProfileIconUrl } from "../lib/profileIconAssets.js";
import "../styles/trophyRewards.css";
import { escapeHtml, fetchLobbyJson, openOverlay, isOverlayOpen } from './ui';

export function createTrophyController({ getUserData, onRewardsClaimed }) {
  let claimBusy = false;
  const presentation = createRewardPresentation({
    state: { overlay: document.body, reveal: null },
    updateWallet: wallet => {
      if (getUserData() && wallet) Object.assign(getUserData(), wallet);
      updateLobbyResourceCounts();
    },
    onWalletTick: (currency, value) => {
      if (getUserData()) getUserData()[currency] = value;
      const count = document.getElementById(currency === "coins" ? "coin-count" : "gem-count");
      if (count) count.textContent = value.toLocaleString();
    },
  });
  let trophyRoadLastScrollLeft = 0;
  let trophyProgressionState = null;
  let trophyProgressionRefreshPromise = null;
  const trophyClaimsInFlight = new Set();

  function setTrophyClaimBadge(count) {
    const badge = document.getElementById("trophy-claim-badge");
    const button = document.getElementById("trophy-resource-button");
    const value = Math.max(0, Number(count) || 0);
    if (!badge || !button) return;
    if (value > 0) {
      badge.textContent = value > 99 ? "99+" : String(value);
      badge.classList.remove("hidden");
      button.classList.add("has-claimable");
    } else {
      badge.textContent = "0";
      badge.classList.add("hidden");
      button.classList.remove("has-claimable");
    }
  }

  function spawnTrophyClaimParticles(host, options = {}) {
    if (!host) return;
    const count = Math.max(6, Math.min(22, Number(options?.count) || 12));
    const tone = String(options?.tone || "gold");
    for (let i = 0; i < count; i += 1) {
      const spark = document.createElement("span");
      spark.className = `trophy-claim-spark tone-${tone}`;
      const dx = (Math.random() * 2 - 1) * 86;
      const dy = -18 - Math.random() * 88;
      const dur = 420 + Math.round(Math.random() * 280);
      const delay = Math.round(Math.random() * 110);
      spark.style.setProperty("--spark-dx", `${Math.round(dx)}px`);
      spark.style.setProperty("--spark-dy", `${Math.round(dy)}px`);
      spark.style.setProperty("--spark-dur", `${dur}ms`);
      spark.style.setProperty("--spark-delay", `${delay}ms`);
      host.appendChild(spark);
      setTimeout(() => spark.remove(), dur + delay + 80);
    }
  }

  function getTrophyTierStatus(tier) {
    if (tier?.claimed) return "claimed";
    if (tier?.canClaim) return "claimable";
    return "locked";
  }

  function applyTrophyTierVisualState({ card, marker, button, tier, pending }) {
    const status = getTrophyTierStatus(tier);
    for (const statusClass of ["claimed", "claimable", "locked"]) {
      card?.classList.toggle(statusClass, status === statusClass);
      marker?.classList.toggle(statusClass, status === statusClass);
    }

    if (!button) return;
    button.dataset.state = status;
    button.disabled = pending || status !== "claimable";
    button.textContent =
      status === "claimed"
        ? "Claimed"
        : status === "claimable"
          ? "Claim"
          : "Locked";
    button.classList.remove("is-busy");
    button.classList.toggle("is-pending", !!pending);
    if (pending) button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
  }

  function updateLobbyResourceCounts() {
    const coinCount = document.getElementById("coin-count");
    const gemCount = document.getElementById("gem-count");
    const trophyCount = document.getElementById("trophy-count");
    if (coinCount) coinCount.textContent = String(getUserData()?.coins || 0);
    if (gemCount) gemCount.textContent = String(getUserData()?.gems || 0);
    if (trophyCount) trophyCount.textContent = String(getUserData()?.trophies || 0);
  }

  function playTrophyClaimFeedback({ card, marker, canvas }) {
    playSound("shopBigSuccess", 0.65);
    spawnTrophyClaimParticles(card, { count: 12, tone: "gold" });
    spawnTrophyClaimParticles(marker, { count: 6, tone: "blue" });
    canvas?.classList.add("claim-flash");
    window.setTimeout(() => canvas?.classList.remove("claim-flash"), 520);
  }

  function updateTrophyTrackControls(container) {
    const track =
      container || document.getElementById("trophy-track-list") || null;
    const previousButton = document.getElementById("trophy-track-prev");
    const nextButton = document.getElementById("trophy-track-next");
    if (!track) return;
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const currentScroll = Math.max(0, Number(track.scrollLeft) || 0);
    if (previousButton) previousButton.disabled = currentScroll <= 2;
    if (nextButton) nextButton.disabled = currentScroll >= maxScroll - 2;
  }

  function scrollTrophyTrack(direction) {
    const container = document.getElementById("trophy-track-list");
    if (!container) return;
    const distance = Math.max(260, Math.round(container.clientWidth * 0.72));
    container.scrollBy({
      left: (Number(direction) < 0 ? -1 : 1) * distance,
      behavior: "smooth",
    });
  }

  function reconcileTrophyTrackState(state) {
    const trophiesChanged = Number(state?.player?.trophies) !== Number(trophyProgressionState?.player?.trophies);
    const container = document.getElementById("trophy-track-list");
    const incomingTiers = Array.isArray(state?.tiers) ? state.tiers : [];
    const existingTiers = new Map(
      (Array.isArray(trophyProgressionState?.tiers)
        ? trophyProgressionState.tiers
        : []
      ).map((tier) => [String(tier?.tierId || ""), tier]),
    );
    const mergedTiers = incomingTiers.map((tier) => {
      const tierId = String(tier?.tierId || "");
      if (!trophyClaimsInFlight.has(tierId) || !existingTiers.get(tierId)?.claimed) return tier;
      return {
        ...tier,
        ...(existingTiers.get(tierId) || {}),
        claimed: true,
        canClaim: false,
      };
    });
    const mergedState = {
      ...state,
      tiers: mergedTiers,
      availableClaimCount: mergedTiers.filter(tier => tier.canClaim).length,
    };
    trophyProgressionState = mergedState;
    setTrophyClaimBadge(mergedState.availableClaimCount);

    if (trophiesChanged || !container?.querySelector(".trophy-track-canvas")) return false;
    const cards = new Map(
      [...container.querySelectorAll(".trophy-lane-card[data-tier-id]")].map(
        (card) => [String(card.dataset.tierId || ""), card],
      ),
    );
    const markers = new Map(
      [...container.querySelectorAll(".trophy-lane-marker[data-tier-id]")].map(
        (marker) => [String(marker.dataset.tierId || ""), marker],
      ),
    );
    if (cards.size !== mergedTiers.length) return false;

    for (const tier of mergedTiers) {
      const tierId = String(tier?.tierId || "");
      const card = cards.get(tierId);
      const marker = markers.get(tierId);
      applyTrophyTierVisualState({
        card,
        marker,
        button: card?.querySelector(".trophy-tier-claim"),
        tier,
        pending: trophyClaimsInFlight.has(tierId),
      });
    }

    const trophies = Math.max(0, Number(mergedState?.player?.trophies) || 0);
    const pin = container.querySelector(".trophy-track-player-pin");
    const pinValue = pin?.querySelector("span");
    if (pinValue) pinValue.textContent = trophies.toLocaleString();
    if (pin) {
      pin.setAttribute(
        "aria-label",
        `Current position: ${trophies.toLocaleString()} trophies`,
      );
    }
    updateTrophyTrackControls(container);
    return true;
  }

  async function refreshTrophyProgressionInBackground() {
    if (trophyProgressionRefreshPromise) {
      return trophyProgressionRefreshPromise;
    }
    trophyProgressionRefreshPromise = fetchLobbyJson("/trophies/progression")
      .then((progression) => {
        const recoveredClaim = progression.tiers?.some(tier => tier.claimed && trophyProgressionState?.tiers?.find(previous => previous.tierId === tier.tierId)?.claimed === false);
        if (!claimBusy && progression?.player && getUserData()) {
          getUserData().coins = Number(progression.player.coins) || 0;
          getUserData().gems = Number(progression.player.gems) || 0;
          getUserData().char_levels = progression.player.char_levels || getUserData().char_levels;
          getUserData().trophy_peak = progression.player.trophyPeak;
          updateLobbyResourceCounts();
        }
        const reconciled = reconcileTrophyTrackState(progression);
        if (!reconciled && isOverlayOpen("trophy-track-overlay")) {
          const list = document.getElementById("trophy-track-list");
          progression.__preserveScroll = true;
          progression.__scrollLeft = Number(list?.scrollLeft) || 0;
          progression.__skipAnimation = true;
          renderTrophyTrack(progression);
        }
        if (recoveredClaim && !claimBusy) onRewardsClaimed?.();
        return progression;
      })
      .finally(() => {
        trophyProgressionRefreshPromise = null;
      });
    return trophyProgressionRefreshPromise;
  }

  function renderTrophyTrack(state) {
    const container = document.getElementById("trophy-track-list");
    const shouldPreserveScroll = !!state?.__preserveScroll;
    const previousScrollLeft = Number.isFinite(Number(state?.__scrollLeft))
      ? Number(state.__scrollLeft)
      : trophyRoadLastScrollLeft;
    if (!container) return;

    const player = state?.player || {};
    const tiers = Array.isArray(state?.tiers) ? state.tiers : [];
    const trophies = Number(player.trophies) || 0;
    const availableClaimCount = Math.max(
      0,
      Number(state?.availableClaimCount) || 0,
    );
    trophyProgressionState = state;
    setTrophyClaimBadge(availableClaimCount);
    container.innerHTML = "";

    if (!tiers.length) {
      container.innerHTML = `
      <div class="trophy-rewards-state">
        <span class="trophy-rewards-state-icon" aria-hidden="true">?</span>
        <strong>No reward milestones yet</strong>
        <span>New rewards will appear here when they are available.</span>
      </div>
    `;
      updateTrophyTrackControls(container);
      return;
    }

    const maxTierRequirement = Math.max(
      1,
      ...tiers.map((tier) => Number(tier?.trophiesRequired) || 0),
    );
    const positionRatio = (value) => {
      const next = tiers.findIndex(tier => tier.trophiesRequired > value);
      if (next < 0) return 1;
      if (next === 0) return 0;
      const previous = tiers[next - 1].trophiesRequired;
      return (next - 1 + (value - previous) / (tiers[next].trophiesRequired - previous)) / Math.max(1, tiers.length - 1);
    };
    const overallRatio = positionRatio(trophies);
    const compactTrack = window.matchMedia?.("(max-width: 700px)")?.matches;
    const laneInset = compactTrack ? 108 : 124;
    const tierSpacing = compactTrack ? 218 : 244;
    const trackWidth = Math.max(
      container.clientWidth || 900,
      laneInset * 2 + Math.max(0, tiers.length - 1) * tierSpacing,
    );
    const laneWidth = Math.max(1, trackWidth - laneInset * 2);
    const ratioToX = (ratio) => laneInset + ratio * laneWidth;
    const railInteriorWidth = Math.max(0, laneWidth - 8);
    const progressWidth = Math.round(railInteriorWidth * overallRatio);
    const progressX = 4 + progressWidth;
    const playerX = Math.round(ratioToX(overallRatio));

    const canvas = document.createElement("div");
    canvas.className = "trophy-track-canvas";
    canvas.classList.toggle("has-progress", overallRatio > 0);
    canvas.style.width = `${trackWidth}px`;
    canvas.style.setProperty("--trophy-lane-inset", `${laneInset}px`);
    canvas.style.setProperty("--trophy-progress-x", `${progressX}px`);
    canvas.innerHTML = `
    <div class="trophy-track-line-shell">
      <div class="trophy-track-line-bg"></div>
      <div class="trophy-track-line-fill" style="width:${progressWidth}px"></div>
      <div class="trophy-track-line-glint"></div>
    </div>
    <div class="trophy-track-card-row" id="trophy-track-card-row"></div>
    <div class="trophy-track-marker-row" id="trophy-track-marker-row"></div>
    <div class="trophy-track-player-pin" style="left:${playerX}px" aria-label="Current position: ${trophies.toLocaleString()} trophies">
      <small>You</small>
      <img src="/assets/trophy.webp" alt="" />
      <span>${trophies.toLocaleString()}</span>
    </div>
  `;
    container.appendChild(canvas);

    const cardRow = canvas.querySelector("#trophy-track-card-row");
    const markerRow = canvas.querySelector("#trophy-track-marker-row");

    let tierIndex = 0;
    for (const tier of tiers) {
      const tierRatio = Math.max(
        0,
        Math.min(1, tierIndex / Math.max(1, tiers.length - 1)),
      );
      const statusClass = tier.claimed
        ? "claimed"
        : tier.canClaim
          ? "claimable"
          : "locked";
      const isMajorMilestone =
        (Array.isArray(tier?.rewards) ? tier.rewards.length : 0) > 1 ||
        (Number(tier?.trophiesRequired) || 0) % 500 === 0;

      const rewards = Array.isArray(tier.rewards) ? tier.rewards : [];
      const primaryReward = rewards[0] || {
        image: "/assets/coin.webp",
        name: "Reward",
        amount: 0,
      };
      const primaryName = String(primaryReward?.name || "Reward");
      const primaryAmount = Math.max(0, Number(primaryReward?.amount) || 0);
      const bundle = rewards.length > 1;
      const art = bundle ? `/assets/reward-bundles/milestone-${tier.trophiesRequired}.webp`
        : primaryReward.kind === 'currency' ? currencyRewardImage(primaryReward.currency, primaryAmount)
        : primaryReward.kind === 'profileIcon' ? buildProfileIconUrl(primaryReward.itemId) : primaryReward.image;
      const contents = rewards.map(reward => reward.kind === 'currency' ? `${Number(reward.amount).toLocaleString()} ${reward.name}` : reward.name).join(', ');
      const rewardDetails = rewards.map(reward => {
        if (reward.kind === 'currency') return `${Number(reward.amount).toLocaleString()} ${reward.name}`;
        const type = { profileIcon: 'Player icon', skin: 'Skin', card: 'Player card', character: 'Bro', mode: 'Gamemode' }[reward.kind];
        return type || 'Reward';
      }).join(' · ');
      const card = document.createElement("article");
      card.className = `trophy-lane-card ${statusClass}${isMajorMilestone ? " major" : ""}${tier.trophiesRequired === 10000 ? " trophy-finale" : ""}`;
      card.dataset.tierId = tier.tierId;
      card.setAttribute("aria-label", `${Number(tier.trophiesRequired).toLocaleString()} trophies: ${tier.title}`);
      card.style.left = `${Math.round(ratioToX(tierRatio))}px`;
      card.style.setProperty(
        "--trophy-tier-index",
        String(Math.min(tierIndex, 10)),
      );
      card.innerHTML = `
      <div class="trophy-lane-card-sheen"></div>
      <div class="trophy-lane-item-wrap reward-${escapeHtml(bundle ? 'bundle' : primaryReward.kind)}" style="--reward-glow:${primaryReward.kind === 'card' && primaryReward.itemId === 'slime-circuit' ? '108,255,127' : primaryReward.currency === 'gems' ? '64,207,255' : isMajorMilestone ? '255,203,87' : '121,158,255'}">
        <img class="trophy-lane-item" loading="lazy" src="${escapeHtml(art || '/assets/coin.webp')}" alt="${escapeHtml(contents)}" />
      </div>
      <div class="trophy-lane-meta">
        <strong>${bundle ? escapeHtml(tier.title) : `${primaryAmount ? `${primaryAmount.toLocaleString()} ` : ''}${escapeHtml(primaryName)}`}</strong>
        ${bundle || primaryReward.kind !== 'currency' ? `<span class="trophy-pack-contents">${escapeHtml(rewardDetails)}</span>` : ''}
      </div>
      <button type="button" class="pixel-menu-button trophy-tier-claim" data-tier-id="${escapeHtml(tier.tierId)}" ${
          tier.canClaim ? "" : "disabled"
        }>${tier.claimed ? "Claimed" : tier.canClaim ? "Claim" : "Locked"}</button>
    `;

      const marker = document.createElement("div");
      marker.dataset.tierId = tier.tierId;
      marker.className = `trophy-lane-marker ${statusClass}${isMajorMilestone ? " major" : ""}`;
      marker.style.left = `${Math.round(ratioToX(tierRatio))}px`;
      marker.innerHTML = `
      <span class="trophy-lane-marker-chip">
        <img src="/assets/trophy.webp" alt="" />
        <span>${Math.max(0, Number(tier.trophiesRequired) || 0).toLocaleString()}</span>
      </span>
    `;

      const claimBtn = card.querySelector(".trophy-tier-claim");
      claimBtn?.setAttribute("aria-label", `Claim ${tier.title} at ${Number(tier.trophiesRequired).toLocaleString()} trophies`);
      claimBtn?.addEventListener("click", async (event) => {
        event?.stopPropagation?.();
        const tierId = String(claimBtn.dataset.tierId || "");
        if (!tierId || claimBtn.disabled || trophyClaimsInFlight.has(tierId))
          return;

        if (claimBusy) return;
        claimBusy = true;
        trophyClaimsInFlight.add(tierId);
        applyTrophyTierVisualState({ card, marker, button: claimBtn, tier, pending: true });
        card.querySelector(".trophy-claim-error")?.remove();
        const startingWallet = { coins: Number(getUserData()?.coins) || 0, gems: Number(getUserData()?.gems) || 0 };
        let committed = false;
        try {
          const result = await fetchLobbyJson("/trophies/claim", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tierId }),
          });
          committed = true;
          tier.claimed = true;
          tier.canClaim = false;
          if (getUserData() && result.player) {
            getUserData().char_levels = result.player.char_levels || getUserData().char_levels;
            getUserData().trophy_peak = result.player.trophyPeak;
          }
          trophyProgressionState.availableClaimCount = Math.max(0, trophyProgressionState.availableClaimCount - 1);
          setTrophyClaimBadge(trophyProgressionState.availableClaimCount);
          applyTrophyTierVisualState({ card, marker, button: claimBtn, tier });
          playTrophyClaimFeedback({ card, marker, canvas });
          // HTTP success is the only point at which a reward can be celebrated.
          await presentation.showRewardReveal({
            result: { grants: result.grants || rewards, wallet: { coins: result.player.coins, gems: result.player.gems } },
            item: { name: tier.title, grants: result.grants || rewards, rarity: tier.trophiesRequired === 10000 ? "legendary" : rewards.find(r => r.rarity)?.rarity || "rare" },
            kind: "trophy", startingWallet, sourceRect: card.getBoundingClientRect(), holdUntilDismissed: true,
          });
        } catch (error) {
          const message = document.createElement("p");
          message.className = "trophy-claim-error";
          message.setAttribute("role", "alert");
          message.textContent = committed ? "Reward saved. Reopen the road to refresh." : error?.message || "Could not claim. Please try again.";
          card.appendChild(message);
        } finally {
          trophyClaimsInFlight.delete(tierId);
          claimBusy = false;
          applyTrophyTierVisualState({ card, marker, button: claimBtn, tier });
          if (committed) onRewardsClaimed?.();
          void refreshTrophyProgressionInBackground().catch(() => {});
        }
      });

      cardRow?.appendChild(card);
      markerRow?.appendChild(marker);
      tierIndex += 1;
    }

    const ratioCenterTarget = Math.max(
      0,
      Math.min(
        Math.max(0, canvas.scrollWidth - container.clientWidth),
        ratioToX(overallRatio) - container.clientWidth / 2,
      ),
    );
    const nextScrollLeft = shouldPreserveScroll
      ? Math.max(
          0,
          Math.min(
            Math.max(0, canvas.scrollWidth - container.clientWidth),
            Number(previousScrollLeft) || 0,
          ),
        )
      : ratioCenterTarget;
    container.scrollLeft = nextScrollLeft;
    trophyRoadLastScrollLeft = nextScrollLeft;
    window.requestAnimationFrame(() => updateTrophyTrackControls(container));
  }

  async function openTrophyProgressionOverlay(options = {}) {
    openOverlay("trophy-track-overlay");
    const list = document.getElementById("trophy-track-list");
    const preserveScroll = !!options?.preserveScroll;
    const hasExistingCanvas = Boolean(
      list?.querySelector(".trophy-track-canvas"),
    );

    if (list && !hasExistingCanvas) {
      list.innerHTML = `<div class="trophy-rewards-state trophy-rewards-loading">
      <span class="trophy-rewards-loading-mark" aria-hidden="true"></span>
      <strong>Loading reward road</strong>
      <span>Checking your latest milestones...</span>
    </div>`;
      updateTrophyTrackControls(list);
    }

    try {
      const progression = await fetchLobbyJson("/trophies/progression");
      if (hasExistingCanvas && reconcileTrophyTrackState(progression)) {
        return;
      }
      progression.__preserveScroll = preserveScroll || hasExistingCanvas;
      progression.__scrollLeft =
        Number(list?.scrollLeft) || trophyRoadLastScrollLeft;
      renderTrophyTrack(progression);
    } catch (err) {
      if (!hasExistingCanvas && list) {
        list.innerHTML = `<div class="trophy-rewards-state">
        <span class="trophy-rewards-state-icon" aria-hidden="true">!</span>
        <strong>Failed to load rewards</strong>
        <span>${escapeHtml(err?.message || "Please check your connection.")}</span>
      </div>`;
      }
    }
  }

  async function refreshTrophyClaimAvailability() {
    try {
      const progression = await fetchLobbyJson("/trophies/progression");
      setTrophyClaimBadge(Number(progression?.availableClaimCount) || 0);
    } catch (_) {
      setTrophyClaimBadge(0);
    }
  }
  function rememberScroll(list) {
    trophyRoadLastScrollLeft = Number(list.scrollLeft) || 0;
    updateTrophyTrackControls(list);
  }

  return { openTrophyProgressionOverlay, refreshTrophyClaimAvailability, scrollTrophyTrack, updateTrophyTrackControls, rememberScroll };
}
