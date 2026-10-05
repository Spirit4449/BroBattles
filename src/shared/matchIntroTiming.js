// Pre-fight timeline shared by the server's start scheduler and the client's
// presentation. Each client's pregame begins when its own loading screen lifts:
//
//   loading -> pregame (map flythrough + pregame.mp3) -> [silent grace] ->
//   player cards + countdown -> FIGHT
//
// The pregame absorbs loading-speed differences between players. If someone is
// still loading when the first client's pregame ends, everyone holds silently
// for at most PREGAME_GRACE_MS before the countdown starts regardless.
const PREGAME_MS = 5000;
const PREGAME_GRACE_MS = 2000;
const COUNTDOWN_MS = 5000;
// Start even if no client ever reports loaded (stuck tabs, closed browsers).
const START_DEADLINE_MS = 45000;

/**
 * When the countdown should begin, given server receipt times of each human's
 * ready signal. Returns null until at least one human is ready.
 * @param {number[]} readyTimes
 * @param {number} requiredCount humans expected in the match
 */
function plannedCountdownStart(readyTimes, requiredCount) {
  if (!readyTimes.length) return null;
  const pregameEnd = Math.min(...readyTimes) + PREGAME_MS;
  if (readyTimes.length < requiredCount) return pregameEnd + PREGAME_GRACE_MS;
  return Math.max(pregameEnd, Math.max(...readyTimes));
}

module.exports = {
  PREGAME_MS,
  PREGAME_GRACE_MS,
  COUNTDOWN_MS,
  START_DEADLINE_MS,
  plannedCountdownStart,
};
