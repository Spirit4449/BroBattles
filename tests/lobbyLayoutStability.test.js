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

test("lobby starts with a spinner and exposes text only when loading fails", () => {
  const html = read("public/index.html");
  const reveal = read("src/lobby/lobbyReveal.js");

  assert.match(html, /class="bb-loading-rune" aria-hidden="true"/);
  assert.doesNotMatch(html, /lobby-loading-panel|lobby-loading-title|lobby-loading-orbit/);
  assert.match(html, /class="lobby-loading-label" hidden>Loading lobby…<\/span>/);
  assert.doesNotMatch(html, /Preparing lobby/);
  assert.match(reveal, /\.bb-loading-rune"\)\?\.setAttribute\("hidden", ""\)/);
  assert.match(reveal, /Taking longer to load your lobby…/);
});

test("creating a party does not attach a duplicate UI sound", () => {
  const source = read("src/index.js");

  assert.match(source, /else createPartyButton\.removeAttribute\('data-sound'\)/);
  assert.doesNotMatch(source, /existingPartyId \? 'cancel2' : 'party'/);
});
