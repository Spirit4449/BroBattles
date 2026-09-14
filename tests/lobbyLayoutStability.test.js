const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("lobby reserves late-loaded header and selector geometry", () => {
  const html = read("public/index.html");
  const siteCss = read("src/site/site.css");
  const lobbyCss = read("src/styles/index.css");

  assert.match(
    html,
    /<span class="site-menu-placeholder" aria-hidden="true"><\/span>\s*<h1 class="lobby-wordmark">/,
  );
  assert.match(
    siteCss,
    /\.site-menu-placeholder\{display:inline-block;flex:none;width:34px;height:36px;margin:0 16px 0 8px\}/,
  );
  assert.match(
    lobbyCss,
    /\.mode-picker,\s*\.map-picker\s*\{[^}]*box-sizing: border-box;[^}]*width: 270px;/,
  );

  for (const id of ["mode-preview-img", "map-preview-img"]) {
    assert.match(
      html,
      new RegExp(`id="${id}"[\\s\\S]*?width="72"[\\s\\S]*?height="40"`),
    );
  }
});
