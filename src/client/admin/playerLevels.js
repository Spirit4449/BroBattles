import { CHARACTERS, state } from "./adminState";
import { $, node, button, titleCase } from "./common";
import {
  LEVEL_CAP,
  STANDARD_LEVEL_CAP,
  parseCharacterLevels,
} from "../../shared/characters/characterStats";

export function normalizedLevels(user) {
  const levels = parseCharacterLevels(user?.char_levels) || {};
  return Object.fromEntries(CHARACTERS.map((c) => [c, Number(levels[c]) || 0]));
}

export function levelChanges() {
  const saved = normalizedLevels(state.selectedUser);
  return Object.fromEntries(
    CHARACTERS.filter((c) => state.levelDraft[c] !== saved[c]).map((c) => [c, state.levelDraft[c]]),
  );
}

function setLevel(character, level, onChange) {
  state.levelDraft[character] = Math.max(0, Math.min(LEVEL_CAP, level));
  renderLevelFields(onChange);
  onChange();
}

export function renderLevelFields(onChange) {
  const host = $("#levelFields");
  const saved = normalizedLevels(state.selectedUser);
  host.replaceChildren();
  for (const character of CHARACTERS) {
    const level = state.levelDraft[character] ?? 0;
    const card = node(
      "div",
      null,
      `level-card ${level ? "" : "is-locked"} ${level !== saved[character] ? "is-dirty" : ""}`,
    );
    const img = node("img");
    img.src = `/assets/profile-icons/${character}.webp`;
    img.alt = "";
    img.width = img.height = 52;
    const head = node("div", null, "level-head");
    const label = node("div", null, "level-label");
    label.append(
      node("strong", titleCase(character)),
      node(
        "span",
        level ? `Level ${level}${level > STANDARD_LEVEL_CAP ? " · Mastery" : ""}` : "Locked",
        "muted",
      ),
    );
    head.append(img, label, node("span", level ? String(level) : "—", "level-value"));
    const pips = node("div", null, "pips");
    const lock = button(null, `pip pip-lock ${level === 0 ? "is-on" : ""}`, () =>
      setLevel(character, 0, onChange),
    );
    lock.title = "Lock character";
    lock.setAttribute("aria-label", `Lock ${character}`);
    lock.append(Object.assign(node("img"), { src: "/assets/icons/lock.webp", alt: "" }));
    pips.append(lock);
    for (let n = 1; n <= LEVEL_CAP; n += 1) {
      const pip = button(
        String(n),
        `pip ${n <= level ? "is-on" : ""} ${n > STANDARD_LEVEL_CAP ? "is-mastery" : ""}`,
        () => setLevel(character, n, onChange),
      );
      pip.title = `Set ${titleCase(character)} to level ${n}`;
      pips.append(pip);
    }
    card.append(head, pips);
    host.append(card);
  }
}
