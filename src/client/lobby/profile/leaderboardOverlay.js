// Trophy leaderboard overlay.
import { escapeHtml, fetchLobbyJson, openOverlay } from "../ui";
import { buildProfileIconAlt, buildProfileIconUrl } from "../../views/profileIconAssets.js";
import { resolveCharacterKey } from "../../../shared/characters/characterStats.js";

function renderLeaderboardRows(rows, profilePopup) {
  const container = document.getElementById("leaderboard-list");
  if (!container) return;
  container.innerHTML = "";

  if (!rows.length) {
    container.innerHTML = `
      <div class="leaderboard-state leaderboard-empty-state">
        <span class="leaderboard-state-icon" aria-hidden="true">?</span>
        <strong>No ranked players yet</strong>
        <span>Finish a battle to claim the first spot.</span>
      </div>
    `;
    return;
  }

  rows.forEach((row, index) => {
    const rank = Math.max(1, Number.parseInt(row.rank, 10) || index + 1);
    const wins = Math.max(0, Number(row.wins) || 0);
    const trophies = Math.max(0, Number(row.trophies) || 0);
    const username = String(row.username || "Unknown Player");
    const item = document.createElement("button");
    item.type = "button";
    item.className = "leaderboard-row";
    item.style.setProperty(
      "--leaderboard-row-index",
      String(Math.min(index, 10)),
    );
    item.setAttribute("aria-label", `View ${username}'s profile`);
    if (rank <= 3) {
      item.classList.add(`top-${rank}`);
    }
    const charClass = resolveCharacterKey(row.charClass);
    const profileIconId = String(row.profileIconId || "") || null;
    item.innerHTML = `
      <span class="leaderboard-rank">#${rank}</span>
      <span class="leaderboard-player">
        <span class="leaderboard-avatar-frame">
          <img class="leaderboard-avatar" src="${escapeHtml(buildProfileIconUrl(profileIconId, charClass))}" alt="${escapeHtml(buildProfileIconAlt(profileIconId, charClass))}" />
        </span>
        <span class="leaderboard-main">
          <span class="leaderboard-name">${escapeHtml(username)}</span>
          <span class="leaderboard-character">${escapeHtml(charClass)} fighter</span>
        </span>
      </span>
      <span class="leaderboard-wins" aria-label="${wins.toLocaleString()} wins">
        <strong>${wins.toLocaleString()}</strong>
        <small>Wins</small>
      </span>
      <span class="leaderboard-trophies">
        <img src="/assets/icons/trophy.webp" alt="" />
        <span><strong>${trophies.toLocaleString()}</strong><small>Trophies</small></span>
      </span>
    `;
    item.addEventListener("click", () => {
      profilePopup?.open?.({ username });
    });
    container.appendChild(item);
  });
}

export async function openLeaderboardOverlay(profilePopup) {
  openOverlay("leaderboard-overlay");
  const container = document.getElementById("leaderboard-list");
  if (container)
    container.innerHTML = `<div class="leaderboard-state leaderboard-loading-state">
        <span class="leaderboard-loading-mark bb-battle-loader" aria-hidden="true"></span>
        <strong>Loading standings</strong>
        <span>Checking the latest rankings...</span>
      </div>`;
  const data = await fetchLobbyJson("/leaderboard/trophies?limit=100");
  renderLeaderboardRows(
    Array.isArray(data?.leaderboard) ? data.leaderboard : [],
    profilePopup,
  );
}
