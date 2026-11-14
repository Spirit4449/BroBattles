import catalog from "../../shared/catalogs/titlesCatalog.json";
import { escapeHtml } from "../../shared/site/html.cjs";
import "../styles/titles.css";

export function titleMarkup(id) {
  const title = catalog.titles.find(item => item.id === id);
  if (!title) return "";
  return `<span class="bb-player-title" style="--title-color:${title.color};--title-gleam:${title.gleamColor}">${escapeHtml(title.name)}</span>`;
}
export function renderTitle(element, id) {
  if (element) element.innerHTML = titleMarkup(id);
}

export function renderTitleCollection(container, profile, { fetchJson, onSelected, onError }) {
  if (!container) return;
  const owned = new Set(profile.ownedTitleIds || []);
  const selected = profile.selectedTitleId || null;
  container.innerHTML = `<div class="profile-icon-group-grid title-collection-grid">
    <button type="button" class="profile-icon-choice-tile title-choice${!selected ? " is-selected" : ""}" data-title-id="" aria-pressed="${!selected}">
      <span class="title-choice-art"><strong class="title-none">No title</strong>${!selected ? '<span class="profile-icon-selected-badge">Equipped</span>' : ""}</span>

    </button>
    ${catalog.titles.map(title => `<button type="button" class="profile-icon-choice-tile title-choice ${title.rarity}${selected === title.id ? " is-selected" : ""}${!owned.has(title.id) ? " is-unowned is-locked" : ""}" data-title-id="${title.id}" aria-pressed="${selected === title.id}" >
      <span class="title-choice-art">${titleMarkup(title.id)}${selected === title.id ? '<span class="profile-icon-selected-badge">Equipped</span>' : ""}</span>
      ${!owned.has(title.id) ? `<span class="profile-icon-details"><small class="title-price"><img src="/assets/icons/gem.webp" alt="gems" width="20" height="20" /><span>${title.cost.gems}</span></small></span>` : ""}
    </button>`).join("")}</div>`;
  const choices = [...container.querySelectorAll("button[data-title-id]")];
  container.innerHTML = "";
  for (const [key, label] of [["owned", "Owned"], ["locked", "Locked"]]) {
    const section = document.createElement("section");
    section.className = "profile-icon-group";
    section.innerHTML = `<div class="profile-icon-group-heading"><h3>${label}</h3></div><div class="profile-icon-group-grid title-collection-grid"></div>`;
    const grid = section.querySelector(".title-collection-grid");
    choices.filter(button => (button.dataset.titleId === "" || owned.has(button.dataset.titleId)) === (key === "owned")).forEach(button => grid.appendChild(button));
    if (grid.children.length) container.appendChild(section);
  }
  container.querySelectorAll("button[data-title-id]").forEach(button => {
    button.addEventListener("click", async () => {
      if (button.dataset.titleId && !owned.has(button.dataset.titleId)) {
        if (document.getElementById("profile-loadout-shop")) {
          document.dispatchEvent(new CustomEvent("bb:open-title-shop", { detail: { offerId: `title-${button.dataset.titleId}` } }));
        } else window.location.href = `/?titleOffer=${encodeURIComponent(`title-${button.dataset.titleId}`)}`;
        return;
      }
      container.querySelectorAll("button").forEach(item => { item.disabled = true; });
      try {
        const result = await fetchJson("/titles/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titleId: button.dataset.titleId || null }) });
        profile.selectedTitleId = result.selectedTitleId;
        onSelected?.(result.selectedTitleId);
      } catch (error) { onError?.(error); }
      finally { renderTitleCollection(container, profile, { fetchJson, onSelected, onError }); }
    });
  });
}
