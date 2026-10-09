const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const babel = require("@babel/core");

const compiled = babel.transformSync(
  fs.readFileSync(require.resolve("../src/client/game/match/gameErrorActions.js"), "utf8"),
  {
    babelrc: false,
    configFile: false,
    presets: [["@babel/preset-env", { targets: { node: "current" } }]],
  },
);
const api = {};
vm.runInNewContext(compiled.code, { exports: api });

test("game errors map to the action that resolves them", () => {
  const actionFor = (code) => api.resolveGameErrorAction({ code }).action;
  assert.equal(actionFor("UNAUTHORIZED"), "login");
  assert.equal(actionFor("BANNED"), "banned");
  assert.equal(actionFor("CLIENT_UPDATE_REQUIRED"), "reload");
  assert.equal(actionFor("MATCH_FINISHED"), "lobby");
  assert.equal(actionFor("ROOM_NOT_FOUND"), "lobby");
  assert.equal(actionFor("MM_SUSPENDED"), "lobby");
});

test("unknown game errors offer a retry", () => {
  assert.equal(api.resolveGameErrorAction({ message: "boom" }).action, "reload");
  assert.equal(api.resolveGameErrorAction(undefined).action, "reload");
});

test("editor playtests never navigate away from the editor", () => {
  const ctx = { editorPlaytest: true };
  assert.equal(api.resolveGameErrorAction({ code: "MATCH_FINISHED" }, ctx).action, "dismiss");
  assert.equal(api.resolveGameErrorAction({ code: "UNAUTHORIZED" }, ctx).action, "dismiss");
  assert.equal(api.resolveGameErrorAction({ code: "CLIENT_UPDATE_REQUIRED" }, ctx).action, "reload");
});
