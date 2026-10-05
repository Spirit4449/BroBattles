const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("both profile clients are equip-only", () => {
  for (const file of ["src/client/pages/lobby.js", "src/client/pages/profile.js"]) {
    const source = read(file);
    assert.doesNotMatch(source, /\/player-cards\/buy/);
    assert.doesNotMatch(source, /\/profile-icons\/buy/);
  }
  assert.match(read("public/index.html"), /Get More in Shop/);
  assert.match(read("public/profile.html"), /Get More in Shop/);
});

test("shop grant delivery never updates equipped cosmetics", () => {
  const source = read("src/server/services/shop/shopService.js");
  const grantBody = source.slice(
    source.indexOf("async function applyGrants"),
    source.indexOf("async function redeem"),
  );
  assert.doesNotMatch(grantBody, /selected_skin_id_by_char/);
  assert.doesNotMatch(grantBody, /selected_card_id/);
  assert.doesNotMatch(grantBody, /selected_profile_icon_id/);
});

test("all public shop interfaces and the raw webhook are registered", () => {
  const routes = read("src/server/routes/modules/shopRoutes.js");
  for (const endpoint of [
    "/api/shop/bootstrap",
    "/api/shop/claim-daily",
    "/api/shop/purchase",
    "/api/shop/checkout-session",
    "/api/shop/checkout-status",
  ]) {
    assert.match(routes, new RegExp(endpoint.replaceAll("/", "\\/")));
  }

  const server = read("src/server/server.js");
  assert.ok(
    server.indexOf("registerStripeWebhookRoute({ app") <
      server.indexOf("app.use(express.json())"),
  );
  assert.match(
    read("src/server/routes/modules/stripeWebhook.js"),
    /express\.raw\(\{ type: "application\/json" \}\)/,
  );
});

test("local environment files are ignored while the example remains trackable", () => {
  const ignore = read(".gitignore");
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\.env\.\*$/m);
  assert.match(ignore, /^!\.env\.example$/m);
});

test("checkout explicitly opts out of Stripe Managed Payments", () => {
  const service = read("src/server/services/shop/stripeShopService.js");
  assert.match(service, /managed_payments:\s*\{\s*enabled:\s*false\s*\}/);
});

test("checkout uses the current Stripe embedded page UI mode", () => {
  const service = read("src/server/services/shop/stripeShopService.js");
  assert.match(service, /ui_mode:\s*["']embedded_page["']/);
  assert.doesNotMatch(service, /ui_mode:\s*["']embedded["']/);
});
