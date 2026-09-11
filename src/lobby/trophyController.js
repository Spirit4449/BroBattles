import { playSound } from "../lib/uiSounds.js";
import { sonner } from "../lib/sonner.js";
import { escapeHtml, fetchLobbyJson, openOverlay, isOverlayOpen } from './ui';

export function createTrophyController({ getUserData }) {
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
    button.disabled = status !== "claimable";
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

  function summarizeTrophyCurrencyRewards(rewards) {
    const totals = { coins: 0, gems: 0 };
    for (const reward of Array.isArray(rewards) ? rewards : []) {
      if (String(reward?.kind || "") !== "currency") continue;
      const currency = String(reward?.currency || "");
      const amount = Math.max(0, Number(reward?.amount) || 0);
      if (currency === "coins" || currency === "gems") {
        totals[currency] += amount;
      }
    }
    return totals;
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
    playSound("shopReveal", 0.55);
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
      if (!trophyClaimsInFlight.has(tierId)) return tier;
      return {
        ...tier,
        ...(existingTiers.get(tierId) || {}),
        claimed: true,
        canClaim: false,
      };
    });
    const optimisticClaims = incomingTiers.filter(
      (tier) =>
        trophyClaimsInFlight.has(String(tier?.tierId || "")) && tier?.canClaim,
    ).length;
    const mergedState = {
      ...state,
      tiers: mergedTiers,
      availableClaimCount: Math.max(
        0,
        (Number(state?.availableClaimCount) || 0) - optimisticClaims,
      ),
    };
    trophyProgressionState = mergedState;
    setTrophyClaimBadge(mergedState.availableClaimCount);

    if (!container?.querySelector(".trophy-track-canvas")) return false;
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
        const reconciled = reconcileTrophyTrackState(progression);
        if (!reconciled && isOverlayOpen("trophy-track-overlay")) {
          const list = document.getElementById("trophy-track-list");
          progression.__preserveScroll = true;
          progression.__scrollLeft = Number(list?.scrollLeft) || 0;
          progression.__skipAnimation = true;
          renderTrophyTrack(progression);
        }
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
    const overallRatio = Math.max(0, Math.min(1, trophies / maxTierRequirement));
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
        Math.min(1, (Number(tier.trophiesRequired) || 0) / maxTierRequirement),
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
      const rewardPreviews = (rewards.length ? rewards : [primaryReward]).slice(
        0,
        2,
      );
      const card = document.createElement("article");
      card.className = `trophy-lane-card ${statusClass}${isMajorMilestone ? " major" : ""}`;
      card.style.left = `${Math.round(ratioToX(tierRatio))}px`;
      card.style.setProperty(
        "--trophy-tier-index",
        String(Math.min(tierIndex, 10)),
      );
      card.innerHTML = `
      <div class="trophy-lane-card-sheen"></div>
      <div class="trophy-lane-item-wrap${rewardPreviews.length > 1 ? " multi-reward" : ""}">
        ${rewardPreviews
            .map(
              (reward) =>
                `<img class="trophy-lane-item" src="${escapeHtml(reward?.image || "/assets/coin.webp")}" alt="${escapeHtml(reward?.name || "Reward")}" />`,
            )
            .join("")}
      </div>
      <div class="trophy-lane-meta">
        <strong>${primaryAmount.toLocaleString()} ${escapeHtml(primaryName)}</strong>
        <span>${escapeHtml(tier.title || "Trophy Milestone")}${rewards.length > 1 ? ` • ${rewards.length} Rewards` : ""}</span>
      </div>
      <button type="button" class="pixel-menu-button trophy-tier-claim" data-tier-id="${escapeHtml(tier.tierId)}" ${
          tier.canClaim ? "" : "disabled"
        }>${tier.claimed ? "Claimed" : tier.canClaim ? "Claim" : "Locked"}</button>
    `;

      const marker = document.createElement("div");
      marker.className = `trophy-lane-marker ${statusClass}${isMajorMilestone ? " major" : ""}`;
      marker.style.left = `${Math.round(ratioToX(tierRatio))}px`;
      marker.innerHTML = `
      <span class="trophy-lane-marker-chip">
        <img src="/assets/trophy.webp" alt="" />
        <span>${Math.max(0, Number(tier.trophiesRequired) || 0).toLocaleString()}</span>
      </span>
    `;

      const claimBtn = card.querySelector(".trophy-tier-claim");
      claimBtn?.addEventListener("click", async (event) => {
        event?.stopPropagation?.();
        const tierId = String(claimBtn.dataset.tierId || "");
        if (!tierId || claimBtn.disabled || trophyClaimsInFlight.has(tierId))
          return;

        trophyClaimsInFlight.add(tierId);

        // 1. Optimistically calculate and apply currency rewards
        const rewards = Array.isArray(tier.rewards) ? tier.rewards : [];
        const currencyRewards = summarizeTrophyCurrencyRewards(rewards);
        const prevCoins = getUserData() ? Number(getUserData().coins) || 0 : 0;
        const prevGems = getUserData() ? Number(getUserData().gems) || 0 : 0;

        if (getUserData()) {
          getUserData().coins = prevCoins + currencyRewards.coins;
          getUserData().gems = prevGems + currencyRewards.gems;
          updateLobbyResourceCounts();
        }

        // 2. Optimistically update local tier state and notification badge
        tier.claimed = true;
        tier.canClaim = false;
        if (trophyProgressionState?.tiers) {
          const localTier = trophyProgressionState.tiers.find(
            (t) => String(t?.tierId) === tierId,
          );
          if (localTier) {
            localTier.claimed = true;
            localTier.canClaim = false;
          }
          trophyProgressionState.availableClaimCount = Math.max(
            0,
            (Number(trophyProgressionState.availableClaimCount) || 1) - 1,
          );
          setTrophyClaimBadge(trophyProgressionState.availableClaimCount);
        }

        // 3. Immediately apply claimed visual state (no "Claiming..." text)
        applyTrophyTierVisualState({
          card,
          marker,
          button: claimBtn,
          tier,
          pending: false,
        });
        playTrophyClaimFeedback({ card, marker, canvas });
        sonner("Reward claimed", "Trophy reward collected!", "success");

        // 4. Send background claim request to backend
        try {
          const result = await fetchLobbyJson("/trophies/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tierId }),
          });

          trophyClaimsInFlight.delete(tierId);

          if (result?.player && getUserData()) {
            getUserData().coins = Number(result.player.coins ?? getUserData().coins) || 0;
            getUserData().gems = Number(result.player.gems ?? getUserData().gems) || 0;
            getUserData().trophies =
              Number(result.player.trophies ?? getUserData().trophies) || 0;
            updateLobbyResourceCounts();
          }

          if (result?.progression) {
            reconcileTrophyTrackState(result.progression);
          }
        } catch (error) {
          trophyClaimsInFlight.delete(tierId);

          // Rollback optimistic state on error
          tier.claimed = false;
          tier.canClaim = true;
          if (trophyProgressionState?.tiers) {
            const localTier = trophyProgressionState.tiers.find(
              (t) => String(t?.tierId) === tierId,
            );
            if (localTier) {
              localTier.claimed = false;
              localTier.canClaim = true;
            }
            trophyProgressionState.availableClaimCount = Math.max(
              0,
              (Number(trophyProgressionState.availableClaimCount) || 0) + 1,
            );
            setTrophyClaimBadge(trophyProgressionState.availableClaimCount);
          }
          if (getUserData()) {
            getUserData().coins = prevCoins;
            getUserData().gems = prevGems;
            updateLobbyResourceCounts();
          }
          applyTrophyTierVisualState({
            card,
            marker,
            button: claimBtn,
            tier,
            pending: false,
          });
          sonner(
            "Reward claim failed",
            error?.message || "Please try again.",
            "error",
          );
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
