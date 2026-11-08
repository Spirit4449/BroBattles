import { resolveShowcaseKit } from "./showcaseKit.js";
export { dummyCharacterFor } from "./showcaseKit.js";

// Webpack discovers optional character art framing only in the lazy
// showcase chunk. Adding a character needs no import or entry in this module.
const modules = require.context("../../game/characters", true, /^\.\/[^/]+\/showcase\.js$/);
const kits = new Map();

export function getShowcaseKit(character) {
  if (!kits.has(character)) {
    const path = `./${character}/showcase.js`;
    const overrides = modules.keys().includes(path) ? modules(path).default : {};
    kits.set(character, resolveShowcaseKit(character, overrides));
  }
  return kits.get(character);
}
