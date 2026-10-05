const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("huntress burn tick preload points at the shipped audio asset", () => {
  const constructorSource = fs.readFileSync(
    path.join(root, "src/client/game/characters/huntress/constructor.js"),
    "utf8",
  );

  assert.match(
    constructorSource,
    /\[`\$\{NAME\}-burn-tick`\]: "tick\.mp3"/,
  );
  assert.ok(fs.existsSync(path.join(root, "public/assets/huntress/tick.mp3")));
});
