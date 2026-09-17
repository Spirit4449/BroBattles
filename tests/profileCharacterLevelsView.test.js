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
  const renderedBadges = [];
  const grid = {
    innerHTML: "",
    closest: () => ({ querySelector: () => heading }),
    appendChild: (child) => children.push(child),
  };
  const document = {
    createElement: () => {
      const badge = {};
      return {
        className: "",
        innerHTML: "",
        badge,
        querySelector: () => badge,
        setAttribute(name, value) {
          this[name] = value;
        },
      };
    },
  };
  const context = {
    exports: {},
    document,
    require: (request) =>
      request.includes("characterStats")
        ? {
            getAllCharacters: () => [
              "ninja",
              "wizard",
              "thorg",
              "draven",
              "huntress",
              "gloop",
            ],
          }
        : request.includes("levelBadgeView")
          ? {
              normalizeCharacterLevel: (level) => Math.max(1, Math.min(10, Number(level) || 1)),
              renderLevelBadge: (root, level) => renderedBadges.push({ root, level }),
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
  assert.equal(renderedBadges[0].level, 8);
  assert.equal(renderedBadges[0].root, children[0].badge);
  assert.doesNotMatch(children[0].innerHTML, /body\.webp/);
});
