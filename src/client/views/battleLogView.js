import { escapeHtml } from "../../shared/site/html.cjs";

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

export function renderBattleLog(container, battles = []) {
  if (!container) return;

  // Legacy matches without a recorded result have nothing useful to display.
  battles = (Array.isArray(battles) ? battles : []).filter(
    (battle) => battle && ["victory", "defeat", "draw"].includes(battle.outcome),
  ).slice(0, 10);

  if (!battles.length) {
    container.innerHTML = `
      <div class="battle-log-empty">
        <div class="battle-log-empty-icon" aria-hidden="true">
          <img src="/assets/logos/logo-large.webp" alt="" width="64" />
        </div>
        <h4>No Battle Results Yet</h4>
        <p>Completed battle results will appear here. Jump into the arena to start your battle log.</p>
      </div>
    `;
    return;
  }

  const wins = battles.filter((b) => b.outcome === "victory").length;
  const losses = battles.filter((b) => b.outcome === "defeat").length;
  const draws = battles.filter((b) => b.outcome === "draw").length;
  const recordedTrophies = battles.filter((b) => b.trophiesDelta != null);
  const netTrophies = battles.reduce(
    (acc, b) => acc + (Number(b.trophiesDelta) || 0),
    0,
  );
  const trophySign = !recordedTrophies.length ? "—" : netTrophies > 0 ? `+${netTrophies}` : `${netTrophies}`;

  const cardsHtml = battles
    .map((battle) => {
      const outcome = battle.outcome;
      const outcomeLabel =
        outcome === "victory"
          ? "VICTORY"
          : outcome === "defeat"
            ? "DEFEAT"
            : "DRAW";
      const delta = Number(battle.trophiesDelta) || 0;
      const deltaClass =
        delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral";
      const deltaFormatted = battle.trophiesDelta == null ? "—" : delta > 0 ? `+${delta}` : `${delta}`;
      const timeAgo = formatTimeAgo(battle.createdAt);

      const mapLabel = battle.mapLabel || "Arena";
      const modeLabel = battle.modeLabel || "Duel";

      return `
        <article class="battle-card ${outcome}" data-match-id="${escapeHtml(battle.matchId)}">
          <div class="battle-card-main">
            <div class="battle-result-row">
              <span class="battle-outcome-badge ${outcome}">${outcomeLabel}</span>
              <div class="battle-match-meta">
                <h4>${escapeHtml(modeLabel)}</h4>
                <span>${escapeHtml(mapLabel)}</span>
              </div>
              ${timeAgo ? `<time class="battle-time" datetime="${escapeHtml(battle.createdAt)}">${timeAgo}</time>` : ""}
              ${battle.trophiesDelta != null && Number.isFinite(Number(battle.trophiesDelta)) ? `<span class="battle-trophy-pill ${deltaClass}">
                <img src="/assets/icons/trophy.webp" alt="Trophies" class="trophy-mini-icon" />
                <span>${deltaFormatted}</span>
              </span>` : ""}
            </div>

          </div>
        </article>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="battle-log-summary-bar">
      <span class="battle-summary-title">Past 10 battles</span>
      <div class="battle-summary-metrics">
        ${recordedTrophies.length ? `<div class="battle-log-metric trophies ${netTrophies >= 0 ? "positive" : "negative"}">
          <span class="battle-metric-label">Net trophies</span>
          <strong><img src="/assets/icons/trophy.webp" alt="" class="trophy-mini-icon" width="14" height="14" />${trophySign}</strong>
        </div>` : ""}
        <div class="battle-log-metric wins"><span class="battle-metric-label">Wins</span><strong>${wins}</strong></div>
        <div class="battle-log-metric losses"><span class="battle-metric-label">Losses</span><strong>${losses}</strong></div>
        ${draws ? `<div class="battle-log-metric draws"><span class="battle-metric-label">Draws</span><strong>${draws}</strong></div>` : ""}
      </div>
    </div>
    <div class="battle-cards-stream">
      ${cardsHtml}
    </div>
  `;
}
