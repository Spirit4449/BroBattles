function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTimeAgo(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const now = Date.now();
  const diffSec = Math.floor((now - date.getTime()) / 1000);

  if (diffSec < 45) return "Just now";
  if (diffSec < 3600) return `${Math.max(1, Math.floor(diffSec / 60))}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statValue(value) {
  return value == null || !Number.isFinite(Number(value))
    ? "—"
    : Number(value).toLocaleString();
}

export function renderBattleLog(container, battles = [], options = {}) {
  if (!container) return;

  if (!battles || !battles.length) {
    container.innerHTML = `
      <div class="battle-log-empty">
        <div class="battle-log-empty-icon" aria-hidden="true">
          <img src="/assets/logos/logo-large.webp" alt="" width="64" />
        </div>
        <h4>No Battles Yet</h4>
        <p>Complete matches to record your combat history and track trophy progress.</p>
      </div>
    `;
    return;
  }

  // Calculate summary stats (without "Last 10 Battles" or "Recent Matches" headers)
  const total = battles.length;
  const wins = battles.filter((b) => b.outcome === "victory").length;
  const losses = battles.filter((b) => b.outcome === "defeat").length;
  const draws = battles.filter((b) => b.outcome === "draw").length;
  const unknown = total - wins - losses - draws;
  const recordedTrophies = battles.filter((b) => b.trophiesDelta != null);
  const netTrophies = battles.reduce(
    (acc, b) => acc + (Number(b.trophiesDelta) || 0),
    0,
  );
  const trophySign = !recordedTrophies.length ? "—" : netTrophies > 0 ? `+${netTrophies}` : `${netTrophies}`;

  const cardsHtml = battles
    .map((battle) => {
      const outcome = ["victory", "defeat", "draw"].includes(battle.outcome)
        ? battle.outcome : "unknown";
      const outcomeLabel =
        outcome === "victory"
          ? "VICTORY"
          : outcome === "defeat"
            ? "DEFEAT"
            : outcome === "draw" ? "DRAW" : "UNAVAILABLE";
      const delta = Number(battle.trophiesDelta) || 0;
      const deltaClass =
        delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral";
      const deltaFormatted = battle.trophiesDelta == null ? "—" : delta > 0 ? `+${delta}` : `${delta}`;
      const timeAgo = formatTimeAgo(battle.createdAt);

      const mapLabel = battle.mapLabel || "Arena";
      const modeLabel = battle.modeLabel || "Duel";

      const stats = battle.playerStats || {};
      const kills = statValue(stats.kills);
      const damage = statValue(stats.damage);
      const hits = statValue(stats.hits);
      const coins = Number(stats.coinsAwarded) || 0;
      const gems = Number(stats.gemsAwarded) || 0;

      return `
        <article class="battle-card ${outcome}" data-match-id="${escapeHtml(battle.matchId)}">
          <div class="battle-card-main">
            <div class="battle-result-row">
              <span class="battle-outcome-badge ${outcome}">${outcomeLabel}</span>
              <div class="battle-match-meta">
                <h4>${escapeHtml(modeLabel)}</h4>
                <span>${escapeHtml(mapLabel)}</span>
              </div>
              <time class="battle-time" datetime="${escapeHtml(battle.createdAt)}">${timeAgo}</time>
              <span class="battle-trophy-pill ${deltaClass}">
                <img src="/assets/trophy.webp" alt="Trophies" class="trophy-mini-icon" />
                <span>${deltaFormatted}</span>
              </span>
            </div>

            <div class="battle-details-row">
              <div class="battle-combat-stats" aria-label="Combat stats">
                <span><strong class="chip-val kills">${kills}</strong> kills</span>
                <span><strong class="chip-val damage">${damage}</strong> damage</span>
                <span><strong class="chip-val hits">${hits}</strong> hits</span>
              </div>
              ${coins > 0 || gems > 0 ? '<span class="battle-detail-divider" aria-hidden="true"></span>' : ""}
              <div class="battle-rewards" aria-label="Rewards">
                ${
                  coins > 0
                    ? `
                  <span><strong class="chip-val coins">+${coins}</strong> coins</span>
                `
                    : ""
                }
                ${
                  gems > 0
                    ? `
                  <span><strong class="chip-val gems">+${gems}</strong> gems</span>
                `
                    : ""
                }
              </div>
            </div>

            ${outcome === "unknown" || [kills, damage, hits].includes("—")
              ? '<p class="battle-data-note">Some results were not recorded for this match. — means unavailable.</p>' : ""}
          </div>
        </article>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="battle-log-summary-bar">
      <div class="battle-log-metric record">
        <strong>${wins}W</strong><span>${losses}L${draws > 0 ? ` · ${draws}D` : ""}</span>
      </div>
      <div class="battle-log-metric trophies ${netTrophies >= 0 ? "positive" : "negative"}">
        <img src="/assets/trophy.webp" alt="" class="trophy-mini-icon" width="14" height="14" />
        <strong>${trophySign}</strong>
      </div>
      <span class="battle-summary-count">${total} recent battle${total === 1 ? "" : "s"}</span>
      ${unknown ? `<span class="battle-summary-note">${unknown} result${unknown === 1 ? "" : "s"} unavailable</span>` : ""}
    </div>
    <div class="battle-cards-stream">
      ${cardsHtml}
    </div>
  `;
}
