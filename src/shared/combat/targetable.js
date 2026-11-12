// A fighter still loading stands at its spawn as a ghost. It can still be hit,
// so targeting asks whether it is placed in the world rather than loaded.
function isPlaced(p) {
  return !!p && (p.loaded === true || (Number.isFinite(p.x) && Number.isFinite(p.y)));
}

// A human ghost: placed, but no client has loaded or reported a position for
// it yet (still loading, or never joined), so the server has to move it.
function isGhost(p) {
  return !!p && !p.isBot && p.loaded !== true && !(p._lastPositionPacketAt > 0) &&
    Number.isFinite(p.x) && Number.isFinite(p.y);
}

module.exports = { isPlaced, isGhost };
