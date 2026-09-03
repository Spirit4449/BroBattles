import { buildProfileIconUrl } from "./profileIconAssets.js";

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
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
          <img src="/assets/sword.svg" alt="" width="48" height="48" />
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

      const mapBanner =
        battle.mapBanner || battle.mapPreview || "/assets/lushy/preview.webp";
      const modeArt = battle.modeArt || "/assets/duels.webp";
      const mapLabel = battle.mapLabel || "Arena";
      const modeLabel = battle.modeLabel || "Duel";

      const player = battle.player || {};
      const charClass = capitalize(player.charClass || "ninja");
      const avatarUrl = buildProfileIconUrl(
        player.profileIconId,
        player.charClass,
      );

      const stats = battle.playerStats || {};
      const kills = statValue(stats.kills);
      const damage = statValue(stats.damage);
      const hits = statValue(stats.hits);
      const coins = Number(stats.coinsAwarded) || 0;
      const gems = Number(stats.gemsAwarded) || 0;

      return `
        <article class="battle-card ${outcome}" data-match-id="${escapeHtml(battle.matchId)}">
          <!-- Banner Art Header (Mode and Map) -->
          <div class="battle-card-banner" style="background-image: url('${escapeHtml(mapBanner)}');">
            <div class="battle-card-banner-overlay"></div>
            <div class="battle-card-banner-content">
              <div class="battle-mode-art-wrap">
                <img src="${escapeHtml(modeArt)}" alt="${escapeHtml(modeLabel)}" class="battle-mode-art" />
              </div>
              <div class="battle-banner-meta">
                <h4 class="battle-banner-title">${escapeHtml(modeLabel)}</h4>
                <div class="battle-banner-map">
                  <span class="battle-map-dot" aria-hidden="true"></span>
                  <span>${escapeHtml(mapLabel)}</span>
                </div>
              </div>
              <time class="battle-time-badge" datetime="${escapeHtml(battle.createdAt)}">${timeAgo}</time>
            </div>
          </div>

          <!-- Outcome & Combat Performance -->
          <div class="battle-card-main">
            <div class="battle-result-strip">
              <span class="battle-outcome-badge ${outcome}">${outcomeLabel}</span>
              <span class="battle-trophy-pill ${deltaClass}">
                <img src="/assets/trophy.webp" alt="Trophies" class="trophy-mini-icon" />
                <span>${deltaFormatted}</span>
              </span>
              <span class="battle-match-code">Match #${escapeHtml(battle.matchId)}</span>
            </div>

            <div class="battle-hero-stats-row">
              <div class="battle-hero-tile">
                <div class="battle-hero-avatar-frame">
                  <img src="${avatarUrl}" alt="${escapeHtml(player.name || "Hero")}" class="battle-hero-avatar" />
                </div>
                <div class="battle-hero-label">
                  <span class="battle-hero-name">${escapeHtml(player.name || "You")}</span>
                  <span class="battle-hero-class">${escapeHtml(charClass)}</span>
                </div>
              </div>

              <div class="battle-combat-chips">
                <div class="battle-stat-chip">
                  <span class="chip-label">KILLS</span>
                  <strong class="chip-val kills">${kills}</strong>
                </div>
                <div class="battle-stat-chip">
                  <span class="chip-label">DAMAGE</span>
                  <strong class="chip-val damage">${damage}</strong>
                </div>
                <div class="battle-stat-chip">
                  <span class="chip-label">HITS</span>
                  <strong class="chip-val hits">${hits}</strong>
                </div>
                ${
                  coins > 0
                    ? `
                  <div class="battle-stat-chip reward">
                    <span class="chip-label">COINS</span>
                    <strong class="chip-val coins">+${coins}</strong>
                  </div>
                `
                    : ""
                }
                ${
                  gems > 0
                    ? `
                  <div class="battle-stat-chip reward">
                    <span class="chip-label">GEMS</span>
                    <strong class="chip-val gems">+${gems}</strong>
                  </div>
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
        <span>Last ${total}:</span> <strong>${wins}W · ${losses}L${draws > 0 ? ` · ${draws}D` : ""}</strong>
      </div>
      <div class="battle-log-metric trophies ${netTrophies >= 0 ? "positive" : "negative"}">
        <img src="/assets/trophy.webp" alt="" class="trophy-mini-icon" width="14" height="14" />
        <span>${recordedTrophies.length < total ? "Recorded trophies:" : "Net trophies:"}</span> <strong>${trophySign}</strong>
      </div>
      ${unknown ? `<span class="battle-summary-note">${unknown} result${unknown === 1 ? "" : "s"} unavailable</span>` : ""}
    </div>
    <div class="battle-cards-stream">
      ${cardsHtml}
    </div>
  `;
}
