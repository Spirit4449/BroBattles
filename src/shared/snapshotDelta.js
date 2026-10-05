// Player snapshot delta codec shared by the room (encoder) and the browser
// (decoder). Snapshots are reliable and ordered on one socket, so each one is
// encoded against the previous snapshot the room emitted:
//
//   keyframe: { keyframe: true, players: { name: fullState } }
//   delta:    { baseSeq, players: { name: changedFields }, gone?: [name] }
//
// A changed player's entry lists only fields whose value differs; fields that
// disappeared are named in `_del`. Unchanged players are omitted. Top-level
// timing fields are always sent in full. A client that misses a snapshot
// (reconnect, late listener) drops deltas until the next keyframe, which the
// room sends at least once per second and immediately after any join.

const KEYFRAME_EVERY_SNAPSHOTS = 30;
const DELETED_FIELDS = "_del";

// JSON drops undefined values, so they are treated as absent fields.
function diffPlayer(prev, next) {
  let delta = null;
  for (const key in next) {
    if (next[key] !== undefined && prev[key] !== next[key]) (delta ||= {})[key] = next[key];
  }
  for (const key in prev) {
    if (prev[key] !== undefined && next[key] === undefined) {
      ((delta ||= {})[DELETED_FIELDS] ||= []).push(key);
    }
  }
  return delta;
}

/**
 * Room-side encoder. encode() returns the `players`/`keyframe`/`baseSeq`/`gone`
 * fields to merge into the outgoing snapshot and remembers `players` (full
 * states, not mutated afterwards) as the next base.
 */
function createSnapshotEncoder({ keyframeEvery = KEYFRAME_EVERY_SNAPSHOTS } = {}) {
  let base = null;
  let sinceKeyframe = 0;
  let keyframeDue = true;
  return {
    requestKeyframe() { keyframeDue = true; },
    encode(seq, players) {
      const previous = base;
      base = { seq, players };
      if (keyframeDue || !previous || ++sinceKeyframe >= keyframeEvery) {
        keyframeDue = false;
        sinceKeyframe = 0;
        return { keyframe: true, players };
      }
      const out = { baseSeq: previous.seq, players: {} };
      for (const name in players) {
        const prev = previous.players[name];
        const delta = prev ? diffPlayer(prev, players[name]) : players[name];
        if (delta) out.players[name] = delta;
      }
      for (const name in previous.players) {
        if (!(name in players)) (out.gone ||= []).push(name);
      }
      return out;
    },
  };
}

/**
 * Client-side decoder. decode() returns the snapshot with full per-player
 * states (fresh objects each time, so callers may keep or mutate them), or
 * null for a delta that cannot be applied yet.
 */
function createSnapshotDecoder() {
  let epoch = null;
  let lastSeq = null;
  let players = null;
  function output(snapshot) {
    const full = {};
    for (const name in players) full[name] = { ...players[name] };
    return { ...snapshot, players: full };
  }
  return {
    reset() { epoch = null; lastSeq = null; players = null; },
    decode(snapshot) {
      if (!snapshot || typeof snapshot !== "object") return null;
      const incoming = snapshot.players && typeof snapshot.players === "object"
        ? snapshot.players : {};
      if (snapshot.keyframe === true) {
        players = {};
        for (const name in incoming) players[name] = { ...incoming[name] };
      } else {
        if (!players || snapshot.snapshotEpoch !== epoch ||
            snapshot.baseSeq !== lastSeq) return null;
        for (const name in incoming) {
          const delta = incoming[name];
          const merged = { ...players[name], ...delta };
          delete merged[DELETED_FIELDS];
          for (const key of delta[DELETED_FIELDS] || []) delete merged[key];
          players[name] = merged;
        }
        for (const name of snapshot.gone || []) delete players[name];
      }
      epoch = snapshot.snapshotEpoch;
      lastSeq = snapshot.snapshotSeq;
      return output(snapshot);
    },
  };
}

module.exports = {
  KEYFRAME_EVERY_SNAPSHOTS,
  createSnapshotEncoder,
  createSnapshotDecoder,
};
