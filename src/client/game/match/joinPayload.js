import { NETWORK_WIRE_VERSION } from "../../../shared/networkWire";
import { getCharacterNetworkVersions } from "../characters/networkRegistry";

export function buildJoinPayload(data) {
  if (!data) return null;
  return { ...data, ...getCharacterNetworkVersions(), networkWireVersion: NETWORK_WIRE_VERSION };
}
