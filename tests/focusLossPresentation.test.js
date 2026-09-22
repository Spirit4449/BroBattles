const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const playerSource = fs.readFileSync("src/player.js", "utf8");

test("inactive controls keep the local HUD attached to the physics body", () => {
  const inactiveBranch = playerSource.slice(
    playerSource.indexOf("const desktopInputInactive"),
    playerSource.indexOf("// Movement tuning knobs"),
  );
  assert.match(inactiveBranch, /syncLocalUiPosition\(\)/);
  assert.match(inactiveBranch, /releaseMovementForFocus\(player/);
  assert.doesNotMatch(inactiveBranch, /setVelocity(?:X|Y)?\(0/);
  assert.match(inactiveBranch, /grounded: grounded|grounded,/);
});

test("inactive controls reconcile movement animation before returning", () => {
  const inactiveBranch = playerSource.slice(
    playerSource.indexOf("const desktopInputInactive"),
    playerSource.indexOf("// Movement tuning knobs"),
  );
  assert.match(inactiveBranch, /deriveMovementAnimation\(\{/);
  assert.match(inactiveBranch, /playCharacterAnimation\(\{/);
  assert.match(inactiveBranch, /logical: passiveAnimation/);
  assert.match(inactiveBranch, /animation: getPresentedAnimation/);
});

test("focus and chat release preserve velocity while death and respawn reset it", () => {
  assert.match(playerSource, /onRelease: \(\) => \{[^}]*resetMovementInputState\(\{ preserveVelocity: true \}\)/);
  assert.match(playerSource, /export function setChatInputActive\(active\)[\s\S]*?resetMovementInputState\(\{ preserveVelocity: true \}\)/);
  assert.match(playerSource, /onLocalDeath: \(\) => \{[^}]*resetMovementInputState\(\)/);
  assert.match(playerSource, /onLocalRespawn: \(\) => \{[^}]*resetMovementInputState\(\)/);
});
