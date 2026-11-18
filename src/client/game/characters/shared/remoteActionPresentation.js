import { attackDescriptors } from "../../../../shared/characters/index.js";
import { deliveryOf } from "../../../../shared/combat/attackDelivery.js";

function point(value) {
  return Number.isFinite(value?.x) && Number.isFinite(value?.y) ? { x: value.x, y: value.y } : null;
}

// Windups and attached attacks follow the visible fighter. Released flights use
// their authoritative muzzle. Impacts keep their own world position.
export function remoteActionPresentation(action, sprite) {
  if (!sprite) return action;
  const descriptor = attackDescriptors[action.type];
  const delivery = deliveryOf(descriptor?.runtime?.kind);
  const owner = { x: sprite.x, y: sprite.y };
  const start = delivery === "released"
    ? point(action.start) || point(action) || point(action.origin) || owner
    : descriptor ? owner : point(action) || point(action.origin) || owner;
  return { ...action, ...start, start: delivery === "released" ? start : point(action.start) || start,
    direction: typeof action.direction === "number" ? action.direction : (action.flip ?? sprite.flipX) ? -1 : 1 };
}
