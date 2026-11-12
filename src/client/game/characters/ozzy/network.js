import { burstOzzyFireball } from "./attack";

// The server ends a fireball where it first touches something (or a wall, or
// the end of its range) and splashes everyone nearby. Every viewer's drawn
// flight, the caster's included, stops and explodes at that same point.
function handleOzzyPacket(scene, packet) {
  if (String(packet?.action?.type || "").toLowerCase() !== "ozzy-fireball-impact") return false;
  burstOzzyFireball(scene, packet.action);
  return true;
}

const noop = () => {};
export const networkAdapter = {
  key: "ozzy",
  joinFields: {},
  bootstrapKey: "ozzyCombat",
  configure: noop,
  reset: noop,
  discard: noop,
  attach: noop,
  observe: noop,
  handlePacket: handleOzzyPacket,
};
