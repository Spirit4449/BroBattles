import { API_PATHS, mapPlaytestPath } from "../../shared/net/apiPaths.js";
import { getJson, postJson, HttpError } from "../lib/http.js";

// Navigation can prefetch a match before the page mounts. Keep the server's
// error payload with that handoff so the game chooses the same recovery action.
export async function requestMatchData(matchId, { signal, editorSession } = {}) {
  try {
    const body = editorSession
      ? await getJson(mapPlaytestPath(editorSession), { signal })
      : await postJson(API_PATHS.GAMEDATA, { matchId: Number(matchId) }, { signal });
    return { ok: true, body };
  } catch (error) {
    if (error instanceof HttpError && error.payload) return { ok: false, body: error.payload };
    throw error;
  }
}
