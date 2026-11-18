// A lobby page owns one account. Views can retain its identity while all
// acknowledged changes notify observers through updateUser.
export let userData = null;
let suspension = {};
const listeners = new Set();
export const getUser = () => userData;
export const getSuspension = () => suspension;
export function setSuspension(value) { suspension = { ...(value || {}) }; }
export function setUser(user) {
  userData = user;
  for (const listener of listeners) listener(userData);
}
export function updateUser(patch) {
  if (!userData || !patch) return;
  Object.assign(userData, patch);
  for (const listener of listeners) listener(userData);
}
export function subscribeUser(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
