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
  };

function syncPlaytestSummary() {
  $("playtest-summary").textContent = [
    mapArena(map())?.modeId === "duels" && playtestInputs.formation.selectedOptions[0]?.text,
    playtestInputs.kind.selectedOptions[0]?.text,
    playtestInputs.character.selectedOptions[0]?.text,
    playtestInputs.debugHitboxes.checked && "hitboxes",
    playtestInputs.infiniteSupers.checked && "infinite supers",
  ]
    .filter(Boolean)
    .join(" · ");
  $("preview").title = `Playtest this draft (Esc) · ${$("playtest-summary").textContent}`;
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
