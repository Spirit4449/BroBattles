const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("both profile clients are equip-only", () => {
  for (const file of ["src/index.js", "src/profile.js"]) {
    const source = read(file);
    assert.doesNotMatch(source, /\/player-cards\/buy/);
    assert.doesNotMatch(source, /\/profile-icons\/buy/);
  }
  assert.match(read("public/index.html"), /Get More in Shop/);
  assert.match(read("public/profile.html"), /Get More in Shop/);
});

test("shop grant delivery never updates equipped cosmetics", () => {
  const source = read("src/server/services/shopService.js");
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
    read("src/server/routes/stripeWebhook.js"),
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
  const service = read("src/server/services/stripeShopService.js");
  assert.match(service, /managed_payments:\s*\{\s*enabled:\s*false\s*\}/);
});

test("checkout uses the current Stripe embedded page UI mode", () => {
  const service = read("src/server/services/stripeShopService.js");
  assert.match(service, /ui_mode:\s*["']embedded_page["']/);
  assert.doesNotMatch(service, /ui_mode:\s*["']embedded["']/);
});

test("shop shelves exclude default and non-offer cosmetics", () => {
  const service = read("src/server/services/shopService.js");
  assert.match(
    service,
    /if \(!offer \|\| id === String\(entry\?\.defaultSkinId \|\| ""\)\) continue;/,
  );
  assert.match(
    service,
    /const offer = offerByGrant\.get\(`card:\$\{id\}`\);\s+if \(!offer\) continue;/,
  );
  assert.match(
    service,
    /const offer = offerByGrant\.get\(`profileIcon:\$\{id\}`\);\s+if \(!offer\) continue;/,
  );
});

test("shop notifications use friendly labels instead of severity button text", () => {
  const source = read("src/shop.js");
  assert.doesNotMatch(
    source,
    /sonner\([^\n]+,\s*[^\n]+,\s*["'](?:success|error)["']/,
  );
  assert.match(source, /sonner\(title, message, "Got it"/);
  assert.doesNotMatch(source, /Shop action failed|Payment status delayed/);
});

test("shop cards use price actions and scroll-aware matching tabs", () => {
  const source = read("src/shop.js");
  assert.match(source, /id="shop-title">Bro Shop</);
  assert.doesNotMatch(source, /Bro Bazaar|shop-brand-mark|THE BATTLE MARKET/);
  assert.doesNotMatch(
    source,
    /Choose Pack|Featured Drops|Daily Gift|Fighter Skins|Profile Style/,
  );
  assert.match(source, /classList\.toggle\("is-active", active\)/);
  assert.match(source, /aria-current", "location"/);
  assert.match(source, /getBoundingClientRect\(\)\.top <= threshold/);
  assert.match(source, /action\.disabled[\s\S]+priceMarkup\(item\.price\)/);
});

test("shop cards and purchase reveal use the pixel UI hierarchy", () => {
  const source = read("src/shop.js");
  const styles = read("src/styles/shop.css");
  assert.match(source, /function getItemTypeLabel/);
  assert.match(source, /THORG SKIN|FIGHTER SKIN/);
  assert.match(source, /PLAYER CARD/);
  assert.match(source, /COIN PACK/);
  assert.match(source, /Wallet Updated/);
  assert.doesNotMatch(source, /<h2>\$\{escapeHtml\(item\?\.name/);
  assert.match(styles, /\.shop-price-money[\s\S]+"Press Start 2P"/);
  assert.match(styles, /\.shop-buy-button[\s\S]+0 5px #03050a/);
  assert.match(styles, /\.shop-offer-type/);
});

test("currency rewards update a visible wallet on every physical impact", () => {
  const source = read("src/shop.js");
  assert.match(source, /data-reveal-wallet="coins"/);
  assert.match(source, /function flyWalletParticle/);
  assert.match(source, /writeWalletCount\(counter,[\s\S]+burstWalletTarget/);
  assert.match(source, /playSound\("shopCurrencyImpact"[\s\S]+overlap: true/);
});

test("post-purchase updates do not bounce or replay card entrances", () => {
  const source = read("src/shop.js");
  const styles = read("src/styles/shop.css");
  const walletImpact = source.slice(
    source.indexOf("function burstWalletTarget"),
    source.indexOf("function flyWalletParticle"),
  );
  const walletUiImpact = walletImpact.slice(
    0,
    walletImpact.indexOf("for (let sparkIndex"),
  );
  assert.doesNotMatch(walletUiImpact, /transform:/);
  assert.match(
    source,
    /refresh\(\{ preserveScroll: true, animateOffers: false \}\)/,
  );
  assert.match(styles, /overflow-anchor: none/);
  assert.doesNotMatch(styles, /shopRevealPanelIn[\s\S]{0,500}scale\(1\.0[1-9]/);
});

test("shop sound effects are locally bundled with source provenance", () => {
  const sounds = read("src/lib/uiSounds.js");
  for (const sound of [
    "shop-open.ogg",
    "shop-close.ogg",
    "shop-hover.ogg",
    "shop-press.ogg",
    "shop-buy.ogg",
    "shop-confirm.ogg",
    "shop-big-success.ogg",
    "shop-error.ogg",
    "shop-reveal.ogg",
    "shop-currency-impact.wav",
  ]) {
    assert.match(sounds, new RegExp(sound.replace(".", "\\.")));
    assert.ok(fs.existsSync(path.join(root, "public/assets/ui-sound", sound)));
  }
  const provenance = read("public/assets/ui-sound/README.md");
  assert.match(provenance, /kenney\.nl\/assets\/interface-sounds/);
  assert.match(provenance, /opengameart\.org\/content\/gem-collect-sfx/);
  assert.match(provenance, /CC0/);
});

test("shop navigation, icons, sales glimmer, and checkout chrome stay consistent", () => {
  const source = read("src/shop.js");
  const styles = read("src/styles/shop.css");
  for (const icon of [
    "sales-v2.png",
    "dailies-v2.png",
    "skins-v2.png",
    "profile-v2.png",
    "currency-v2.png",
    "bundle-v2.png",
    "shop-v2.png",
  ]) {
    assert.ok(fs.existsSync(path.join(root, "public/assets/shop/icons", icon)));
  }
  assert.match(source, /class="shop-tab-icon"/);
  assert.match(source, /class="shop-offer-name"/);
  assert.match(source, /<h2 id="shop-checkout-title">Secure Checkout<\/h2>/);
  assert.doesNotMatch(source, /<span>ESC<\/span>/);
  assert.doesNotMatch(source, />SECURE CHECKOUT</);
  assert.doesNotMatch(styles, /shop-offer-featured:hover \.shop-sale-sheen/);
  assert.match(
    styles,
    /shop-section-sales \.shop-offer-featured \.shop-sale-sheen[\s\S]+7\.5s/,
  );
  assert.match(
    styles,
    /shop-sales-grid \.shop-offer[\s\S]+grid-template-rows: 278px minmax\(63px, auto\) auto/,
  );
  assert.match(
    source,
    /isBigPurchase\(item\) \? "shopBigSuccess" : "shopConfirm"/,
  );
});
