import { mapArena } from "../../shared/maps/arenas";
import { $, map } from "./studioState";
import { syncToolbarSelect } from "./toolbarSelects";

// Playtest settings are a per-browser preference.
const PLAYTEST_KEY = "bb-map-studio-playtest",
  playtestInputs = {
    formation: $("playtest-formation"),
    kind: $("playtest-kind"),
    character: $("playtest-character"),
    skin: $("playtest-skin"),
    debugHitboxes: $("debug-hitboxes"),
    infiniteSupers: $("infinite-supers"),
    fullBattle: $("playtest-full-battle"),
  };

function syncPlaytestSummary() {
  const { fullBattle, kind, infiniteSupers } = playtestInputs;
  kind.hidden = fullBattle.checked;
  infiniteSupers.closest("label").hidden = fullBattle.checked;
  syncToolbarSelect("playtest-kind");
  $("playtest-label").textContent = fullBattle.checked ? "Full Battle" : "Playtest";
  $("playtest-quick-option").setAttribute("aria-pressed", String(!fullBattle.checked));
  $("playtest-full-option").setAttribute("aria-pressed", String(fullBattle.checked));
  $("playtest-summary").textContent = [
    fullBattle.checked ? "Full Battle" : "Quick Playtest",
    mapArena(map())?.modeId === "duels" && playtestInputs.formation.selectedOptions[0]?.text,
    fullBattle.checked ? "With bots" : kind.selectedOptions[0]?.text,
    playtestInputs.character.selectedOptions[0]?.text,
    playtestInputs.debugHitboxes.checked && "hitboxes",
    !fullBattle.checked && infiniteSupers.checked && "infinite supers",
  ]
    .filter(Boolean)
    .join(" · ");
  $("preview").title = $("playtest-summary").textContent;
}

// Bank Bust objects only exist on Bank Bust maps.
function syncAddKinds() {
  const bank = !!map()?.objectiveLayout?.bankBust,
    select = $("add-kind");
  $("playtest-formation").hidden = mapArena(map())?.modeId !== "duels";
  syncToolbarSelect("playtest-formation");
  syncPlaytestSummary();
  for (const option of select.querySelectorAll("[data-bank-bust]"))
    option.hidden = option.disabled = !bank;
  if (select.selectedOptions[0]?.disabled) select.value = "platform";
  syncToolbarSelect("add-kind", { rebuild: true });
}

export { PLAYTEST_KEY, playtestInputs, syncPlaytestSummary, syncAddKinds };
