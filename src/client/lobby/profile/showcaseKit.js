import { characterDefinitions } from "../../../shared/characters/index.js";
// Presentation overrides are optional; combat registration is owned by the match.
export function resolveShowcaseKit(character, overrides = {}) {
  return { visual: {}, ...overrides };
}

// Use the content registry rather than a separate showcase roster.
export function dummyCharacterFor(character) {
  if (character === "gloop") return "thorg";
  const candidates = Object.keys(characterDefinitions).filter(key => key !== character);
  const basicDamage = key => Number(characterDefinitions[key]?.stats?.baseDamage) || 0;
  const fragile = candidates.find(key => key === "ninja") || candidates[0];
  const tank = candidates.find(key => key === "thorg");
  // Keep high-damage showcases from repeatedly deleting a fragile partner.
  return tank && (!fragile || basicDamage(character) > basicDamage(fragile))
    ? tank : fragile || tank || character;
}

// Roster entries are data: adding participants never changes the stage/runtime.
export function showcaseRoster({ character, skinId = "", level = 1, mode, name = "You" }) {
  const entry = (id, key, team, x, self = false) => ({ id, character: key, skinId: self ? skinId : "", level, team, x, self, role: self ? 'featured' : 'sparring',
    name: self ? name : key.charAt(0).toUpperCase() + key.slice(1) });
  if (mode !== 'fight') return [entry('hero', character, 'team1', 0, true)];
  if (character === 'wizard') return [entry('hero', character, 'team1', -65, true),
    { ...entry('ally', 'ninja', 'team1', -195), role: 'bystander' }, entry('enemy', 'thorg', 'team2', 125)];
  if (character === 'thorg') return [entry('hero', character, 'team1', -190, true),
    entry('enemy', dummyCharacterFor(character), 'team2', 10)];
  return [entry('hero', character, 'team1', -100, true), entry('enemy', dummyCharacterFor(character), 'team2', 100)];
}
