import { createVaultHud } from "./bankBust/vaultHud";

const factories = new Map([["bank-bust", createVaultHud]]);

// HUDs can receive a snapshot before the Phaser scene finishes loading.
export function createModeHud(type, isIntroBlocking) {
  return factories.get(type)?.(isIntroBlocking);
}
