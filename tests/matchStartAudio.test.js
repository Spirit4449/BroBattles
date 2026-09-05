const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("match countdown sounds point at bundled audio assets", () => {
  const sounds = read("src/lib/uiSounds.js");
  const hud = read("src/hud/gameHudController.js");

  for (const [name, asset] of [
    ["beep", "beep.mp3"],
    ["start", "start.mp3"],
  ]) {
    assert.ok(sounds.includes(`${name}: \"/assets/${asset}\"`));
    assert.ok(fs.existsSync(path.join(root, "public/assets", asset)));
    assert.ok(hud.includes(`playSound(\"${name}\"`));
  }
});
