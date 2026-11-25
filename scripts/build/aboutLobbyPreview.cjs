// Build the public demo from the same lobby template without booting a game session.
const { parseHTML } = require("linkedom");

module.exports = function aboutLobbyPreview(source) {
  const { document } = parseHTML(source.toString());
  const sections = ["#navbar", ".lobby-party-actions", ".lobby-quick-actions", "#lobby-area", "#bottom-bar", "#matchmaking-overlay"];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex"><title>Bro Battles lobby preview</title>
    <link rel="stylesheet" href="/styles/lato.css"><link rel="stylesheet" href="/bundles/index.css">
    </head><body data-bb-screen="lobby" inert>
    ${sections.map(selector => document.querySelector(selector).outerHTML).join("\n")}
    <script src="/bundles/aboutLobbyPreview.bundle.js"></script></body></html>`;
};
