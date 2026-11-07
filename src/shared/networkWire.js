// Versioned short keys only at the transport boundary. Decoded data and traces
// retain descriptive names. Never reorder this list within a protocol version.
const NETWORK_WIRE_VERSION = 1;
const fields = [
  'timestamp', 'sentMono', 'tMono', 'tickId', 'snapshotSeq', 'snapshotEpoch',
  'snapshotKind', 'baseSeq', 'keyframe', 'gone', 'players',
  'x', 'y', 'vx', 'vy', 'grounded', 'ducking', 'wallSliding', 'wallSide',
  'dashSeq', 'dashX', 'dashY', 'knockbackSeq', 'movementFxSeq',
  'movementFxType', 'movementFxDirection', 'movementFxWallSide',
  'movementFxFallDistance', 'movementFxImpactVelocity', 'flip', 'animation',
  'health', 'isAlive', 'connected', 'loaded', 'sequence', 'correctionAck', 'ammoState',
];
const short = Object.fromEntries(fields.map((name, i) => [name, i.toString(36)]));
const long = Object.fromEntries(Object.entries(short).map(([name, key]) => [key, name]));
function translate(value, dictionary) {
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(out, Object.hasOwn(dictionary, key) ? dictionary[key] : key, {
      value: item, enumerable: true, configurable: true, writable: true,
    });
  }
  return out;
}
function encodeWire(packet) {
  const out = translate(packet, short);
  if (packet.players) {
    out[short.players] = Object.fromEntries(Object.entries(packet.players)
      .map(([name, state]) => [name, translate(state, short)]));
  }
  return { v: NETWORK_WIRE_VERSION, d: out };
}
function decodeWire(packet) {
  if (!packet || !Object.hasOwn(packet, 'v')) return packet;
  if (packet.v !== NETWORK_WIRE_VERSION || !packet.d || typeof packet.d !== 'object' || Array.isArray(packet.d)) return null;
  const out = translate(packet.d, long);
  if (out.players && (typeof out.players !== 'object' || Array.isArray(out.players))) return null;
  if (out.players && Object.values(out.players).some(state => !state || typeof state !== 'object' || Array.isArray(state))) return null;
  if (out.players) out.players = Object.fromEntries(Object.entries(out.players)
    .map(([name, state]) => [name, translate(state, long)]));
  return out;
}
module.exports = { NETWORK_WIRE_VERSION, encodeWire, decodeWire };
