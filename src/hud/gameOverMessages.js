// hud/gameOverMessages.js

export const END_BATTLE_MESSAGES = Object.freeze({
  victory: Object.freeze([
    "Your squad owned the arena",
    "Absolute domination!",
    "Flawless execution, GG!",
    "Too clean with it!",
    "They never stood a chance",
    "Crown secured — bow down!",
    "Pure skill, zero luck",
    "Arena legends in the making",
    "That was light work!",
    "Certified lobby wipe",
    "Unstoppable force, undeniable victory",
    "Total control from start to finish",
    "The arena belongs to you",
    "Masterclass in teamwork and power",
    "Claim the glory, champions!",
    "Undisputed rulers of the realm",
  ]),
  defeat: Object.freeze([
    "Gear up for the rematch",
    "Close battle — bounce back stronger!",
    "Shake it off, run it back!",
    "A tough loss, but the grind never stops",
    "They got the best of you this time",
    "Regroup, reload, and get revenge!",
    "Dust yourself off, warrior",
    "Every loss is a lesson — go again!",
    "Tough break! Time for a comeback",
    "Not your match, but the next one is yours",
    "Take the heat and forge a comeback",
    "Down, but never out",
    "Refuel, rethink, reload",
    "Almost had 'em — queue back up!",
    "Pain is temporary, victory is forever",
    "Sharpen your weapons and strike back",
  ]),
  draw: Object.freeze([
    "Nobody backed down",
    "Deadlock! Neither side gave an inch",
    "Stalemate of the titans",
    "Evenly matched — settle it next round!",
    "Neither squad gave up ground",
    "A legendary standoff",
  ]),
});

export function normalizeResultTone(tone) {
  if (!tone) return "draw";
  const normalized = String(tone).toLowerCase().replace(/^is-/, "");
  if (normalized === "victory" || normalized === "win") return "victory";
  if (normalized === "defeat" || normalized === "loss" || normalized === "lose")
    return "defeat";
  return "draw";
}

export function getEndBattleMessage(resultTone, rng = Math.random) {
  const category = normalizeResultTone(resultTone);
  const pool = END_BATTLE_MESSAGES[category] || END_BATTLE_MESSAGES.draw;
  if (!pool || pool.length === 0) return "";
  const randomFn = typeof rng === "function" ? rng : Math.random;
  const rawRand = randomFn();
  const clampedRand = Number.isFinite(rawRand)
    ? Math.max(0, Math.min(0.999999, rawRand))
    : 0;
  const index = Math.floor(clampedRand * pool.length);
  return pool[index] || pool[0];
}
