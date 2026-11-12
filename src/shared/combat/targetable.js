// A fighter still loading stands at its spawn as a ghost. It can still be hit,
// so targeting asks whether it is placed in the world rather than loaded.
function isPlaced(p) {
  return !!p && (p.loaded === true || (Number.isFinite(p.x) && Number.isFinite(p.y)));
}

module.exports = { isPlaced };
