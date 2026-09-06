// Socket callbacks from different members must complete in party order.
const partyOperations = new WeakMap();
function inPartyOrder(db, partyId, operation) {
  let pending = partyOperations.get(db);
  if (!pending) partyOperations.set(db, (pending = new Map()));
  const key = String(partyId);
  const next = (pending.get(key) || Promise.resolve()).catch(() => {}).then(operation);
  pending.set(key, next);
  return next.finally(() => {
    if (pending.get(key) === next) pending.delete(key);
  });
}

module.exports = { inPartyOrder };
