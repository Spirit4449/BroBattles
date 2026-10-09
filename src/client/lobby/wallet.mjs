// All acknowledged wallet changes flow through here; views subscribe once.
const listeners = new Set();
let revision = 0;
export const walletRevision = () => revision;
export function subscribeWallet(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function applyWallet(user, wallet, expectedRevision = revision) {
  if (!user || !wallet || expectedRevision !== revision) return false;
  for (const currency of ["coins", "gems"]) {
    if (wallet[currency] == null) continue;
    const value = Number(wallet[currency]);
    if (Number.isFinite(value) && value >= 0) user[currency] = value;
  }
  revision += 1;
  const balance = { coins: Number(user.coins) || 0, gems: Number(user.gems) || 0 };
  for (const currency of ["coins", "gems"]) {
    const counter = globalThis.document?.getElementById(currency === "coins" ? "coin-count" : "gem-count");
    if (counter) counter.textContent = String(balance[currency]);
  }
  for (const listener of listeners) listener(balance, user);
  return true;
}
