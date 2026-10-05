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
      if (req.url === "/test.js") {
        res.setHeader("Content-Type", "text/javascript");
        return res.end(fs.readFileSync(path.join(output, "test.js")));
      }
      if (req.url !== "/") { res.statusCode = 404; return res.end(); }
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><html><head><style>.hidden,.is-hidden{display:none!important}.character-select-popup,.character-details-popup,.bb-chat-viewers-card{padding:20px}button{min-width:30px;min-height:30px}</style></head><body><button id="trigger">Open</button><button id="outside">Background</button><script src="/test.js"></script></body></html>');
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.htmlSmoke);
    const result = await page.evaluate(() => window.htmlSmoke.run());
    assert.deepEqual(errors, []);
    console.log(`Generated HTML browser checks passed: ${result.join(", ")}`);
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    fs.rmSync(output, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
