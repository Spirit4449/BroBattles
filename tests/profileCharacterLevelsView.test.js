const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { transformFileSync } = require("@babel/core");

test("Bros renderer uses profile portraits, level crests, and reports unlocked count", () => {
  const compiled = transformFileSync(
    require.resolve("../src/client/views/profileCharacterLevelsView.js"),
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
            canonicalCharacterKey: require("../src/shared/characters/characterStats").canonicalCharacterKey,
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

function loadBadges() {
  const compiled = transformFileSync(require.resolve('../src/client/views/levelBadgeView.js'),
    { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] });
  function element(tag) {
    return { tag, children: [], dataset: {}, classList: { add() {}, remove() {} },
      setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; },
      replaceChildren() { this.children = []; },
      append(...children) { for (const child of children) child.parent = this; this.children.push(...children); },
      appendChild(child) { this.append(child); },
      remove() { this.parent.children = this.parent.children.filter(child => child !== this); },
    };
  }
  const context = { exports: {}, document: { createElement: element },
    require: request => request.includes('characterStats')
      ? require('../src/shared/characters/characterStats.js')
      : require('../public/assets/levels/animations.json') };
  vm.runInNewContext(compiled.code, context);
  return context.exports;
}

test('level badges select looping images with reduced-motion posters and an error fallback', () => {
  const { createLevelBadge } = loadBadges();
  for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const root = createLevelBadge(level);
    const picture = root.children[1];
    assert.equal(picture.tag, 'picture');
    const [source, art] = picture.children;
    assert.equal(source.media, '(prefers-reduced-motion: no-preference)');
    assert.match(source.srcset, new RegExp(`/levels/${level}-animated\\.webp\\?v=`));
    assert.match(art.src, new RegExp(`/levels/${level}-poster\\.webp\\?v=`));
    art.onerror();
    assert.equal(picture.children.length, 1);
    assert.equal(art.src, `/assets/levels/${level}.webp`);
    assert.equal(art.onerror, null);
  }
});
