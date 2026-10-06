// Requires Playwright; NODE_PATH may point at an existing installation.
// CHROME_EXECUTABLE can select an installed Chromium/Chrome binary.
const { chromium } = require("playwright");
const webpack = require("webpack");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const root = path.resolve(__dirname, "../..");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "bb-html-smoke-"));

async function main() {
  let browser;
  let server;
  try {
    const compiler = webpack({
      mode: "development",
      devtool: false,
      context: root,
      entry: "./tests/browser/generatedHtmlSmoke.js",
      output: { path: output, filename: "test.js" },
      module: { rules: [
        { test: /\.css$/, use: ["style-loader", { loader: "css-loader", options: { url: false } }] },
        { test: /\.webp$/, resourceQuery: /portrait/, type: "asset/inline" },
      ] },
    });
    await new Promise((resolve, reject) => compiler.run((error, stats) => {
      compiler.close(closeError => {
        if (error || closeError) return reject(error || closeError);
        if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
        resolve();
      });
    }));
    server = http.createServer((req, res) => {
      if (req.url === '/assets/PressStart2P.woff2' || /^\/assets\/chromas\/[a-z-]+\.svg$/.test(req.url)) {
        res.setHeader('Content-Type', req.url.endsWith('.svg') ? 'image/svg+xml' : 'font/woff2');
        return res.end(fs.readFileSync(path.join(root, 'public', req.url)));
      }
      if (req.url === '/styles/ui-system.css' || req.url === '/styles/game.css') {
        res.setHeader('Content-Type', 'text/css');
        return res.end(fs.readFileSync(path.join(root, 'public', req.url)));
      }
      if (/^\/assets\/player-cards\/[a-z0-9-]+\/[a-z0-9-]+\.(webm|webp|mov)$/.test(req.url)) {
        const file = path.join(root, 'public', req.url);
        res.setHeader('Content-Type', req.url.endsWith('.mov') ? 'video/quicktime' : req.url.endsWith('.webm') ? 'video/webm' : 'image/webp');
        return res.end(fs.readFileSync(file));
      }
      if (/^\/assets\/[a-zA-Z0-9_/-]+\.webp$/.test(req.url)) {
        const file = path.join(root, 'public', req.url);
        if (fs.existsSync(file)) {
          res.setHeader('Content-Type', 'image/webp');
          return res.end(fs.readFileSync(file));
        }
      }
      if (req.url === "/test.js") {
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        return res.end(fs.readFileSync(path.join(output, "test.js")));
      }
      if (req.url !== "/") { res.statusCode = 404; return res.end(); }
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles/ui-system.css"><style>.hidden,.is-hidden{display:none!important}.character-select-popup,.character-details-popup,.bb-chat-viewers-card{padding:20px}button{min-width:30px;min-height:30px}</style></head><body><button id="trigger">Open</button><button id="outside">Background</button><script src="/test.js"></script></body></html>');
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage();
    // Make playback checks independent of Chrome's estimated host connection.
    // Slow/data-saver policy is exercised separately in preloader.test.js.
    await page.addInitScript(() => {
      const connection = Object.assign(new EventTarget(), { effectiveType: '4g', downlink: 100, saveData: false });
      Object.defineProperty(navigator, 'connection', { value: connection });
    });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.htmlSmoke);
    let result;
    if (process.argv.includes('--card-cleanup')) {
      result = await page.evaluate(() => window.htmlSmoke.runCardCleanup());
    } else if (process.argv.includes('--battle-layout')) {
      result = [];
      for (const viewport of [{ width: 1512, height: 820 }, { width: 844, height: 390 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        for (const reducedMotion of ['reduce', 'no-preference']) {
          await page.emulateMedia({ reducedMotion });
          result.push(...await page.evaluate(() => window.htmlSmoke.runBattleLayout()));
        }
      }
    } else if (process.argv.includes('--reward-layout') || process.argv.includes('--preview-layout')) {
      result = [];
      for (const viewport of [{ width: 986, height: 576 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        result.push(...await page.evaluate(preview => preview
          ? window.htmlSmoke.runPreviewLayout() : window.htmlSmoke.runRewardLayout(), process.argv.includes('--preview-layout')));
      }
    } else {
      result = await page.evaluate(() => window.htmlSmoke.run());
    }
    assert.deepEqual(errors, []);
    console.log(`Generated HTML browser checks passed: ${result.join(", ")}`);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    fs.rmSync(output, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
