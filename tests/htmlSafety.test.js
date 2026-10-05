const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml, assetUrl } = require("../src/shared/site/html.cjs");

test("HTML text and quoted attributes preserve text without creating markup", () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('x')">&`), "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(0), "0");
  assert.equal(escapeHtml("&lt;"), "&amp;lt;");
});

test("catalog artwork stays inside the local assets directory", () => {
  const fallback = "/assets/player-cards/default.webp";
  for (const value of ["javascript:alert(1)", "https://example.com/a.webp", "//example.com/a.webp", "/assets/../../account", "/assets/%2e%2e/account", "/assets/\\evil", "/assets/a\nb.webp", null]) {
    assert.equal(assetUrl(value), fallback, String(value));
  }
  assert.equal(assetUrl("/assets/player-cards/default.webp?v=2"), "/assets/player-cards/default.webp?v=2");
});
