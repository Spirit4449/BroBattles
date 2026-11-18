import { handleRemoteAttack } from "../characters";
import { presentRemoteAction } from "../characters/shared/animationState.js";
export function replayQueuedRemoteActions(scene, queue, { username, gameData, teamPlayers, opponentPlayers }) {
  // Replay any queued remote actions now that the scene is ready
  try {
    if (Array.isArray(queue) && queue.length) {
      const queued = queue.splice(0, queue.length);
      const retryActions = [];
      for (const pkt of queued) {
        try {
          const { playerName, character, action } = pkt || {};
          if (!playerName || !action) continue;
          if (playerName === username) continue;
          const pd = (gameData.players || []).find(
            (p) => p.name === playerName,
          );
          const isTeammate = pd && pd.team === gameData.yourTeam;
          const container = isTeammate ? teamPlayers : opponentPlayers;
          const wrapper = container[playerName];
          if (!wrapper?.opponent) {
            retryActions.push(pkt);
            continue;
          }
          const charKey = (
            character ||
            (pd && pd.char_class) ||
            ""
          ).toLowerCase();
          const act = { ...(action || {}) };
          if (wrapper && wrapper.opponent) {
            act.x = wrapper.opponent.x;
            act.y = wrapper.opponent.y;
            if (typeof act.direction !== "number") {
              act.direction = wrapper.opponent.flipX ? -1 : 1;
            }
          }
          presentRemoteAction({ scene: scene, wrapper, character: charKey, actionType: act.type },
            () => handleRemoteAttack(scene, charKey, act, wrapper));
        } catch (_) {}
      }
      if (retryActions.length) {
        queue.push(...retryActions);
      }
    }
  } catch (_) {}

}
