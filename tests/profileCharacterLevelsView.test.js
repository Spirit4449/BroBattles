const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { transformFileSync } = require("@babel/core");

test("Bros renderer uses profile portraits, level crests, and reports unlocked count", () => {
  const compiled = transformFileSync(
    require.resolve("../src/lib/profileCharacterLevelsView.js"),
    { presets: [["@babel/preset-env", { targets: { node: "current" } }]] },
  );
  const heading = { innerHTML: "" };
  const children = [];
  const grid = {
    innerHTML: "",
    closest: () => ({ querySelector: () => heading }),
    appendChild: (child) => children.push(child),
  };
  const document = {
    createElement: () => ({
      className: "",
      innerHTML: "",
      setAttribute(name, value) {
        this[name] = value;
      },
    }),
  };
  const context = {
    exports: {},
    document,
    require: (request) =>
      request.includes("characterStats")
        ? {
            LEVEL_CAP: 10,
            getAllCharacters: () => [
              "ninja",
              "wizard",
              "thorg",
              "draven",
              "huntress",
              "gloop",
            ],
          }
        : {
            buildProfileIconUrl: (id) => `/assets/profile-icons/${id}.webp`,
          },
  };

  vm.runInNewContext(compiled.code, context);
  context.exports.renderCharacterLevelGrid(grid, { ninja: 3, wizard: 8 });

  assert.match(heading.innerHTML, /<span>Bros<\/span>/);
  assert.match(
    heading.innerHTML,
    /profile-bros-unlocked-count"><strong>2\/6<\/strong> unlocked/,
  );
  assert.equal(children.length, 2);
  assert.match(children[0].innerHTML, /profile-icons\/wizard\.webp/);
  assert.match(children[0].innerHTML, /assets\/levels\/8\.webp/);
  assert.doesNotMatch(children[0].innerHTML, /body\.webp/);
});
