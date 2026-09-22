const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const controllerSource = fs.readFileSync(
  "src/chat/gameChatController.js",
  "utf8",
);
const chatStyles = fs.readFileSync("src/styles/chat.css", "utf8");

test("battle chat exposes direct Team and All tabs instead of a select", () => {
  assert.match(controllerSource, /class="bb-chat-audience-tab"/);
  assert.match(controllerSource, /setAttribute\("role", "tablist"\)/);
  assert.match(controllerSource, /data-chat-scope="team"/);
  assert.match(controllerSource, /data-chat-scope="all"/);
  assert.doesNotMatch(controllerSource, /createElement\("select"\)/);
  assert.match(chatStyles, /\.bb-chat-audience-tab\.is-active/);
});

test("battle chat cycles channels with Tab and preserves a draft per channel", () => {
  assert.match(controllerSource, /event\.key === "Tab"/);
  assert.match(controllerSource, /event\.shiftKey \? -1 : 1/);
  assert.match(controllerSource, /draftsByScope:\s*\{/);
  assert.match(
    controllerSource,
    /state\.draftsByScope\[previousScope\] = String\(ui\.textarea\.value/,
  );
  assert.match(
    controllerSource,
    /ui\.textarea\.value = String\(state\.draftsByScope\[nextScope\]/,
  );
});

test("battle chat tabs carry active and unread accessibility state", () => {
  assert.match(controllerSource, /aria-selected/);
  assert.match(controllerSource, /count} unread/);
  assert.match(controllerSource, /button\.tabIndex = isActive \? 0 : -1/);
  assert.match(chatStyles, /\.bb-chat-tab-count/);
});

test("battle chat placeholder keeps focus guidance without channel-switch copy", () => {
  assert.match(controllerSource, /Message your team…  \/ to focus/);
  assert.match(controllerSource, /Message everyone…  \/ to focus/);
  assert.doesNotMatch(controllerSource, /Tab to switch/);
});

test("unfocused battle chat darkens without fading before auto-hide", () => {
  assert.match(chatStyles, /\.bb-chat-game-panel\.is-unfocused\s*\{[^}]*opacity: 1;[^}]*filter: brightness\(0\.8\)/);
  assert.match(chatStyles, /\.bb-chat-game-panel\.is-auto-hidden\s*\{[^}]*opacity: 0;/);
  assert.match(controllerSource, /ui\.panel\.inert = phase === "hidden"/);
});
