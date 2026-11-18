import { DEATH_DROP_PICKUP_RADIUS } from "../../../shared/combat/matchConfig.js";
import { SOCKET_EVENTS } from "../../../shared/net/socketEvents.js";
import { PICKUP_DELAY_MS } from "../../../shared/powerups";
export function createDeathDropPickupClient({ socket, getDead, getLocalPlayer }) {
  const pending = new Map();
  function propose(id, visual, ageMs) {
    const key = String(id);
    const now = Date.now();
    if (!visual.settled || visual.despawning || ageMs < PICKUP_DELAY_MS || getDead?.() ||
        now - (pending.get(key) ?? -Infinity) <= 120) return;
    const local = getLocalPlayer?.();
    const x = Number(local?.body?.center?.x ?? local?.x);
    const y = Number(local?.body?.center?.y ?? local?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x - visual.settledX, y - visual.settledY) > DEATH_DROP_PICKUP_RADIUS) return;
    pending.set(key, now);
    socket?.emit?.(SOCKET_EVENTS.DEATHDROP_PICKUP, { id, x: visual.settledX, y: visual.settledY });
  }
  return { propose, forget: key => pending.delete(key) };
}
