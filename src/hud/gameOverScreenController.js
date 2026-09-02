// hud/gameOverScreenController.js

import { playSound } from "../lib/uiSounds.js";

const REWARD_TYPES = {
  coins: {
    image: "/assets/coin.webp",
    label: "Coins",
    rewardKey: "coinsAwarded",
  },
  gems: {
    image: "/assets/gem.webp",
    label: "Gems",
    rewardKey: "gemsAwarded",
  },
  trophies: {
    image: "/assets/trophy.webp",
    label: "Trophies",
    rewardKey: "trophiesDelta",
  },
};

const delay = (duration) =>
  new Promise((resolve) => window.setTimeout(resolve, duration));

function prefersReducedMotion() {
  return !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

function formatCount(value) {
  return Math.max(0, Math.round(Number(value) || 0)).toLocaleString();
}

function readRewardAmount(reward, type) {
  const amount = Number(reward?.[REWARD_TYPES[type].rewardKey]) || 0;
  return type === "trophies" ? amount : Math.max(0, amount);
}

function writeWalletCount(counter, value) {
  if (counter) counter.textContent = formatCount(value);
}

function burstWalletTarget(target, counter, type, impactIndex, totalImpacts) {
  const color =
    type === "gems"
      ? "86,216,255"
      : type === "trophies"
        ? "247,213,103"
        : "255,193,53";
  const rect = target.getBoundingClientRect();

  target.animate(
    [
      { filter: "brightness(1)", transform: "translateY(0) scale(1)" },
      {
        filter: "brightness(1.65)",
        transform: "translateY(-2px) scale(1.08)",
        boxShadow: `0 5px 0 #03050a, 0 0 22px rgba(${color},.82), inset 0 3px rgba(255,255,255,.2)`,
        offset: 0.42,
      },
      { filter: "brightness(1)", transform: "translateY(0) scale(1)" },
    ],
    { duration: 260, easing: "ease-out" },
  );
  counter?.animate(
    [
      { filter: "brightness(1)", transform: "scale(1)" },
      {
        filter: "brightness(1.9)",
        transform: "scale(1.18)",
        offset: 0.48,
      },
      { filter: "brightness(1)", transform: "scale(1)" },
    ],
    { duration: 210, easing: "ease-out" },
  );

  for (let sparkIndex = 0; sparkIndex < 5; sparkIndex += 1) {
    const angle = (Math.PI * 2 * sparkIndex) / 5 + impactIndex * 0.37;
    const distance = 22 + (sparkIndex % 2) * 11;
    const spark = document.createElement("i");
    spark.className = `bb-game-over-wallet-spark is-${type}`;
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
        { duration: 340, easing: "cubic-bezier(.12,.72,.25,1)" },
      )
      .finished.finally(() => spark.remove());
  }

  const pitchRange = totalImpacts > 1 ? impactIndex / (totalImpacts - 1) : 0.5;
  playSound("shopCurrencyImpact", 0.12, {
    overlap: true,
    playbackRate:
      0.88 + pitchRange * 0.28 + (type === "gems" ? 0.08 : 0),
  });
}

function flyRewardParticle({
  sourceRect,
  target,
  type,
  index,
  count,
  launchDelay,
  onImpact,
}) {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      const icon = document.createElement("img");
      icon.className = `bb-game-over-flying-reward is-${type}`;
      icon.src = REWARD_TYPES[type].image;
      icon.alt = "";
      document.body.appendChild(icon);

      const spread = index - (count - 1) / 2;
      let x = sourceRect.left + sourceRect.width / 2 + spread * 3;
      let y = sourceRect.top + sourceRect.height / 2;
      let vx = spread * 46 + (Math.random() - 0.5) * 80;
      let vy = -340 - Math.random() * 125;
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
          vy += 1160 * dt;
        } else {
          const pull = Math.min(50, 18 + (elapsed - 0.24) * 36);
          vx += (targetX - x) * pull * dt;
          vy += (targetY - y) * pull * dt;
          const drag = Math.exp(-5.2 * dt);
          vx *= drag;
          vy *= drag;
        }

        x += vx * dt;
        y += vy * dt;
        rotation += (165 + index * 12) * dt * (index % 2 ? -1 : 1);
        const distance = Math.hypot(targetX - x, targetY - y);
        const scale =
          elapsed < 0.14
            ? Math.min(1, elapsed / 0.14)
            : Math.max(0.32, Math.min(1, distance / 90));
        icon.style.opacity = String(Math.min(1, elapsed / 0.07));
        icon.style.transform = `translate3d(${x - 16}px, ${y - 16}px, 0) rotate(${rotation}deg) scale(${scale})`;

        if ((elapsed > 0.34 && distance < 17) || elapsed > 1.55) finish();
        else window.requestAnimationFrame(frame);
      };
      window.requestAnimationFrame(frame);
    }, launchDelay + index * 70);
  });
}

export function createGameOverScreenController({
  getGameData,
  getUsername,
  rewardStorageKey,
}) {
  function isMobileDevice() {
    try {
      const coarsePointer =
        typeof window !== "undefined" &&
        window.matchMedia?.("(pointer: coarse)")?.matches;
      const touchPoints = Number(navigator?.maxTouchPoints || 0);
      const narrowViewport = Number(window?.innerWidth || 0) <= 980;
      return !!(coarsePointer || (touchPoints > 0 && narrowViewport));
    } catch (_) {
      return !!document?.body?.classList?.contains("mobile-game-ui");
    }
  }

  async function fetchUpdatedWallet(myReward) {
    const embeddedWallet = myReward?.wallet || myReward?.balanceAfter;
    if (embeddedWallet) {
      return {
        coins: Number(embeddedWallet.coins) || 0,
        gems: Number(embeddedWallet.gems) || 0,
        trophies: Number(embeddedWallet.trophies) || 0,
      };
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2800);
    try {
      const response = await fetch("/status", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const payload = await response.json();
      const user = payload?.userData;
      if (!user) return null;
      return {
        coins: Number(user.coins) || 0,
        gems: Number(user.gems) || 0,
        trophies: Number(user.trophies) || 0,
      };
    } catch (_) {
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function clearStoredReward() {
    try {
      sessionStorage.removeItem(rewardStorageKey);
    } catch (_) {}
  }

  async function animateRewardsIntoWallet(root, myReward) {
    if (!root?.isConnected || !myReward) return;
    const [wallet] = await Promise.all([
      fetchUpdatedWallet(myReward),
      delay(460),
    ]);
    if (!wallet || !root.isConnected) return;

    const walletPanel = root.querySelector(".bb-game-over-wallet");
    if (!walletPanel) return;
    const starts = {};
    for (const type of Object.keys(REWARD_TYPES)) {
      const amount = readRewardAmount(myReward, type);
      starts[type] = Math.max(0, wallet[type] - amount);
      writeWalletCount(
        walletPanel.querySelector(`[data-game-over-wallet="${type}"]`),
        starts[type],
      );
    }

    walletPanel.classList.add("is-active");
    walletPanel.setAttribute("aria-hidden", "false");
    playSound("shopReveal", 0.3);
    await delay(prefersReducedMotion() ? 1 : 280);

    if (prefersReducedMotion()) {
      for (const type of Object.keys(REWARD_TYPES)) {
        writeWalletCount(
          walletPanel.querySelector(`[data-game-over-wallet="${type}"]`),
          wallet[type],
        );
      }
    } else {
      const flights = [];
      Object.keys(REWARD_TYPES).forEach((type, typeIndex) => {
        const amount = readRewardAmount(myReward, type);
        const source = root.querySelector(`[data-game-over-reward="${type}"]`);
        const target = walletPanel.querySelector(
          `[data-game-over-wallet-shell="${type}"]`,
        );
        const counter = target?.querySelector(
          `[data-game-over-wallet="${type}"]`,
        );
        if (!source || !target || !counter || amount === 0) return;

        source.classList.add("is-collecting");
        const sourceRect = source.getBoundingClientRect();
        const magnitude = Math.abs(amount);
        const count = Math.min(
          9,
          Math.max(4, Math.ceil(Math.log10(magnitude + 1) * 2.5)),
        );
        let impacts = 0;
        const onImpact = () => {
          impacts += 1;
          const progress = impacts / count;
          const eased = 1 - Math.pow(1 - progress, 2);
          writeWalletCount(
            counter,
            starts[type] + (wallet[type] - starts[type]) * eased,
          );
          burstWalletTarget(target, counter, type, impacts - 1, count);
          if (impacts === count) source.classList.remove("is-collecting");
        };
        for (let index = 0; index < count; index += 1) {
          flights.push(
            flyRewardParticle({
              sourceRect,
              target,
              type,
              index,
              count,
              launchDelay: typeIndex * 160,
              onImpact,
            }),
          );
        }
      });
      await Promise.all(flights);
      for (const type of Object.keys(REWARD_TYPES)) {
        writeWalletCount(
          walletPanel.querySelector(`[data-game-over-wallet="${type}"]`),
          wallet[type],
        );
      }
    }

    clearStoredReward();
    walletPanel.classList.add("is-complete");
    await delay(prefersReducedMotion() ? 700 : 1250);
    walletPanel.classList.add("is-leaving");
    walletPanel.setAttribute("aria-hidden", "true");
  }

  function showGameOverScreen(payload) {
    const gameData = getGameData();
    const username = getUsername();
    const isMobile = isMobileDevice();

    const existing = document.getElementById("game-over-overlay");
    if (existing) existing.remove();

    const div = document.createElement("div");
    div.id = "game-over-overlay";

    const winner = payload?.winnerTeam;
    let heading = "Game Over";
    if (winner === null) heading = "Draw";
    else if (winner === gameData?.yourTeam) heading = "Victory";
    else heading = "Defeat";

    const rewards = Array.isArray(payload?.meta?.rewards)
      ? payload.meta.rewards
      : [];
    const myReward = rewards.find((reward) => reward.username === username);
    const yourTeam = myReward?.team || gameData?.yourTeam;
    const squadRewards = (yourTeam
      ? rewards.filter((reward) => reward.team === yourTeam)
      : rewards.filter((reward) => reward.username === username)
    ).sort((left, right) => {
      if (left.username === username) return -1;
      if (right.username === username) return 1;
      return (Number(right.damage) || 0) - (Number(left.damage) || 0);
    });

    try {
      if (myReward) {
        sessionStorage.setItem(
          rewardStorageKey,
          JSON.stringify({
            at: Date.now(),
            coinsAwarded: Number(myReward.coinsAwarded) || 0,
            gemsAwarded: Number(myReward.gemsAwarded) || 0,
            trophiesDelta: Number(myReward.trophiesDelta) || 0,
          }),
        );
      }
    } catch (_) {}

    const escapeHtml = (val) =>
      String(val ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const headerRow = `
      <div class="bb-game-over-result-row is-header" role="row">
        <div role="columnheader">Player</div>
        <div role="columnheader">Damage</div>
        <div role="columnheader">Kills</div>
      </div>`;

    const rewardRowsHtml = squadRewards
      .map((reward) => {
        const isYou = reward.username === username;
        const label = `${escapeHtml(reward.username)}${
          isYou ? ' <span class="bb-game-over-you">You</span>' : ""
        }`;
        return `
          <div class="bb-game-over-result-row${isYou ? " is-you" : ""}" role="row">
            <div role="cell">${label}</div>
            <div role="cell">${Math.max(0, Number(reward.damage) || 0).toLocaleString()}</div>
            <div role="cell">${Math.max(0, Number(reward.kills) || 0).toLocaleString()}</div>
          </div>`;
      })
      .join("");

    const rewardSectionHtml = squadRewards.length
      ? `
        <section class="bb-game-over-results">
          <h2>Your Squad</h2>
          <div class="bb-game-over-results-table" role="table" aria-label="Your squad results">
            ${headerRow}
            ${rewardRowsHtml}
          </div>
        </section>`
      : "";

    const rewardCardMarkup = (type) => {
      const config = REWARD_TYPES[type];
      const amount = readRewardAmount(myReward, type);
      const prefix = amount > 0 ? "+" : "";
      const stateClass =
        amount < 0 ? " is-negative" : amount === 0 ? " is-zero" : "";
      return `
        <div class="bb-game-over-reward is-${type}${stateClass}" data-game-over-reward="${type}">
          <span class="bb-game-over-reward-icon"><i></i><img src="${config.image}" width="34" height="34" alt="" /></span>
          <span><small>${config.label}</small><strong>${prefix}${amount.toLocaleString()}</strong></span>
        </div>`;
    };

    const personalSummaryHtml = myReward
      ? `
        <section class="bb-game-over-summary">
          <h2>Battle Rewards</h2>
          <div class="bb-game-over-rewards">
            ${Object.keys(REWARD_TYPES).map(rewardCardMarkup).join("")}
          </div>
        </section>`
      : "";

    const resultTone =
      winner === null
        ? "is-draw"
        : winner === gameData?.yourTeam
          ? "is-victory"
          : "is-defeat";
    const resultMessage =
      resultTone === "is-victory"
        ? "Your squad owned the arena"
        : resultTone === "is-defeat"
          ? "Gear up for the rematch"
          : "Nobody backed down";

    const walletMarkup = Object.entries(REWARD_TYPES)
      .map(
        ([type, config]) => `
          <span class="is-${type}" data-game-over-wallet-shell="${type}">
            <img src="${config.image}" width="25" height="25" alt="" />
            <span><small>${config.label}</small><strong data-game-over-wallet="${type}">0</strong></span>
          </span>`,
      )
      .join("");

    div.innerHTML = `
      <div class="bb-game-over-backdrop">
        <aside class="bb-game-over-wallet" aria-label="Updated balances" aria-hidden="true">
          ${walletMarkup}
        </aside>
        <section class="bb-game-over-card ${resultTone}${isMobile ? " is-mobile" : ""}" role="dialog" aria-modal="true" aria-label="Match complete">
          <div class="bb-game-over-celebration" aria-hidden="true">
            ${Array.from({ length: 14 }, (_, index) => `<i style="--spark-index:${index}"></i>`).join("")}
          </div>
          <header class="bb-game-over-hero">
            <span class="bb-game-over-kicker">Battle Complete</span>
            <h1 class="bb-game-over-title ${resultTone}">${heading}</h1>
            <p>${resultMessage}</p>
          </header>
          <div class="bb-game-over-content">
            ${personalSummaryHtml}
            ${rewardSectionHtml}
          </div>
          <button id="go-lobby" class="bb-game-over-action pixel-menu-button" type="button" data-sound="cursor4" data-volume="0.28">Back to Lobby (10)</button>
        </section>
      </div>`;

    document.body.appendChild(div);
    void animateRewardsIntoWallet(div, myReward);

    let leaving = false;
    let countdown = 10;
    const button = document.getElementById("go-lobby");

    const goToLobby = async () => {
      if (leaving) return;
      leaving = true;
      try {
        const res = await fetch("/status", { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          const pid = Number(data?.party_id);
          if (Number.isFinite(pid) && pid > 0) {
            window.location.href = `/party/${pid}`;
            return;
          }
        }
      } catch (_) {}

      try {
        const myPartyId = Number(
          (gameData?.players || []).find((p) => p.name === username)?.party_id,
        );
        if (Number.isFinite(myPartyId) && myPartyId > 0) {
          window.location.href = `/party/${myPartyId}`;
          return;
        }
      } catch (_) {}

      window.location.href = "/";
    };

    const timer = setInterval(() => {
      countdown -= 1;
      if (button)
        button.textContent = `Back to Lobby (${Math.max(0, countdown)})`;
      if (countdown <= 0) {
        clearInterval(timer);
        goToLobby();
      }
    }, 1000);

    button?.addEventListener("click", async () => {
      clearInterval(timer);
      await goToLobby();
    });
  }

  return {
    showGameOverScreen,
  };
}
