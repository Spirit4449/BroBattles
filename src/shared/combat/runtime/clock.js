// Hosts may inject deterministic time/randomness; live rooms retain wall time.
function combatNow(room) { return room?.combatClock?.now?.() ?? Date.now(); }
function combatMono(room) { return room?.combatClock?.mono?.() ?? performance.now(); }
function combatRandom(room) { return room?.combatRandom?.() ?? Math.random(); }
function snapshotEpoch(room) {
  if (room._snapshotEpoch != null) return room._snapshotEpoch;
  // Epochs are equality tags, not credentials. getRandomValues also works on
  // local HTTP previews where randomUUID is unavailable.
  const bytes = new Uint8Array(6);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let tag = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = bytes[i] * 65536 + bytes[i + 1] * 256 + bytes[i + 2];
    for (const shift of [18, 12, 6, 0]) tag += alphabet[(n >>> shift) & 63];
  }
  return (room._snapshotEpoch = tag);
}
module.exports = { combatNow, combatMono, combatRandom, snapshotEpoch };
