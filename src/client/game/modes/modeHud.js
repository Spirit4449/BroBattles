import { createVaultHud } from "./bankBust/vaultHud";

import { createBroBallHud } from "./broBall/hud";

const factories = new Map([["bank-bust", createVaultHud], ["soccer", createBroBallHud]]);

// HUDs can receive a snapshot before the Phaser scene finishes loading.
export function createModeHud(type, isIntroBlocking) {
  return factories.get(type)?.(isIntroBlocking);
}
