const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const babel = require("@babel/core");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("countdown keeps its beeps and final fight cue", () => {
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
  assert.ok(hud.includes('preloadSound("start"'));
});

test("final countdown cue plays once alongside FIGHT and enabling input", () => {
  const exported = {}, calls = [], preloaded = [], timers = [];
  const countdown = { style: {}, textContent: '' };
  let now = 0, fights = 0, enabled = 0;
  const code = babel.transformSync(read("src/hud/gameHudController.js"), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  vm.runInNewContext(code, {
    exports: exported,
    require: name => name.includes('uiSounds') ? {
      playSound: key => calls.push({ key, time: now, display: countdown.textContent }),
      preloadSound: key => preloaded.push(key),
    } : {},
    window: { addEventListener() {} },
    document: { getElementById: id => id === 'countdown-display' ? countdown : null },
    setTimeout: (fn, ms) => timers.push({ fn, time: now + ms }),
    clearTimeout() {},
  });
  const hud = exported.createGameHudController({
    onCountdownFight: () => fights++, onEnableInput: () => enabled++,
  });
  hud.startCountdown(); hud.startCountdown();
  assert.deepEqual(preloaded, ['beep', 'start']);
  while (timers.length) {
    timers.sort((a, b) => a.time - b.time);
    const timer = timers.shift(); now = timer.time; timer.fn();
  }
  assert.deepEqual(calls.map(call => call.key), ['beep', 'beep', 'beep', 'beep', 'beep', 'start']);
  assert.equal(calls.at(-1).display, 'FIGHT!');
  assert.equal(fights, 1);
  assert.equal(enabled, 1);
});
