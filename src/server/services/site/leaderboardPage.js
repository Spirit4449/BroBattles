const { escapeHtml } = require("../../../shared/site/html.cjs");
const { icons } = require("../../../shared/catalogs/profileIconsCatalog.cjs");
const iconPaths = new Map(icons.map(icon => [icon.id, icon.assetUrl]));

function playerRow({ rank, username, profileIconId, charClass, wins, trophies }) {
  const id = "player-" + username;
  const icon = iconPaths.get(profileIconId) || iconPaths.get(charClass) || iconPaths.get("ninja");
  return `<tr data-rank="${rank}" id="${escapeHtml(id)}"><td><span class="standings-rank">${rank}</span></td>
    <th scope="row"><a class="standings-player" href="?username=${escapeHtml(encodeURIComponent(username))}#${escapeHtml(encodeURIComponent(id))}" title="Link to this standing"><img src="${escapeHtml(icon)}" width="36" height="36" alt="" loading="lazy"><span data-private-name>${escapeHtml(username)}</span></a></th>
    <td>${wins.toLocaleString("en-US")}</td><td>${trophies.toLocaleString("en-US")}</td></tr>`;
}

function renderLeaderboardPage(rows, username = "") {
  const heading = `<header class="release-heading standings-heading"><img src="/assets/icons/trophy.webp" alt="" width="42" height="42"><h1>Leaderboard</h1></header>`;
  const search = `<form action="/leaderboard" method="get" role="search" class="standings-filter">
    <label for="standings-name">Find a player</label><div><input id="standings-name" name="username" type="search" maxlength="50" placeholder="Username" autocomplete="off" value="${escapeHtml(username)}">
    <button class="pixel-menu-button site-btn" type="submit">Search</button></div></form>`;
  const table = `<table aria-label="Player standings"><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Wins</th><th scope="col">Trophies</th></tr></thead><tbody>${(rows || []).map(playerRow).join("")}</tbody></table>`;
  let content = table;
  if (!rows) content = '<p class="standings-state">Standings are temporarily unavailable. Please try again.</p>';
  else if (!rows.length) content = `<p class="standings-state">${username ? "No player found with that username." : "No ranked players yet."}</p>`;
  const reset = username ? '<a class="site-link" href="/leaderboard">Clear search</a>' : "";
  return `${heading}<div class="site-frame standings-search">${search}${reset}</div>
    <div class="site-frame standings">${content}</div>`;
}
module.exports = { renderLeaderboardPage };
