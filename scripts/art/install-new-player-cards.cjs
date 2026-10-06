// Install user-supplied October 2026 cards. Source folder names and PNG rarity
// names are validated; video filenames are deliberately ignored.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('../../spritesheet-generator/node_modules/sharp');
const { measurePlayerCardBounds } = require('./player-card-bounds.cjs');
const additions = require('./new-player-cards.json');
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'public/assets/player-cards');
const upload = path.join(assets, 'New Player Cards');
const archive = path.join(root, 'output/art/New Player Cards');
const sources = fs.existsSync(upload) ? upload : archive;
const catalogPath = path.join(root, 'src/shared/catalogs/playerCardsCatalog.json');
const shopPath = path.join(root, 'src/shared/catalogs/shopCatalog.json');
async function main() {
  const videos = new Map();
  for (const card of additions) {
    const folder = path.join(sources, card.name);
    const files = fs.readdirSync(folder);
    if (!files.includes(`${card.rarity}.png`)) throw Error(`Missing rarity image: ${card.name}`);
    const clips = files.filter(file => file.endsWith('.mp4'));
    if (clips.length !== 1) throw Error(`Expected one video: ${card.name}`);
    videos.set(card.id, path.join(folder, clips[0]));
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath));
  const currentDefault = catalog.cards.find(card => card.id === 'default');
  if (!catalog.cards.some(card => card.id === 'radiant-silver')) {
    const silver = { ...currentDefault, id: 'radiant-silver', name: 'Radiant Silver', cost: { coins: 0, gems: 25 } };
    for (const key of ['assetUrl', 'animationUrl', 'animationAppleUrl']) {
      const old = silver[key];
      silver[key] = old.replace('/default-', '/radiant-silver-');
      fs.copyFileSync(path.join(root, 'public', old), path.join(root, 'public', silver[key]));
    }
    fs.mkdirSync(path.join(assets, 'radiant-silver'), { recursive: true });
    fs.copyFileSync(path.join(assets, 'default/default.webp'), path.join(assets, 'radiant-silver/radiant-silver.webp'));
    catalog.cards.push(silver);
  }
  fs.mkdirSync(path.join(assets, 'default'), { recursive: true });
  await sharp(path.join(sources, 'Default/default.png')).resize(650, 1250, { kernel: 'nearest' }).webp({ quality: 80, effort: 6 }).toFile(path.join(assets, 'default/default.webp'));
  catalog.cards[catalog.cards.indexOf(currentDefault)] = {
    id: 'default', name: 'Default', assetUrl: '/assets/player-cards/default/default.webp', rarity: 'common', cost: { coins: 0, gems: 0 }, renderScale: 0.95,
  };
  for (const card of additions) {
    fs.mkdirSync(path.join(assets, card.id), { recursive: true });
    await sharp(path.join(sources, card.name, `${card.rarity}.png`)).webp({ quality: 80, effort: 6 }).toFile(path.join(assets, card.id, `${card.id}.webp`));
    if (!catalog.cards.some(entry => entry.id === card.id)) catalog.cards.push({
      id: card.id, name: card.name, rarity: card.rarity, cost: { coins: 0, gems: card.gems }, assetUrl: `/assets/player-cards/${card.id}/${card.id}.webp`,
    });
  }
  for (const card of catalog.cards) {
    if (card.rarity === 'common' || card.id.startsWith('radiant-')) card.renderScale = 0.95;
    card.battleViewport = await measurePlayerCardBounds(path.join(root, 'public', card.assetUrl));
  }
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  const shop = JSON.parse(fs.readFileSync(shopPath));
  for (const card of [...additions, { id: 'radiant-silver', name: 'Radiant Silver', rarity: 'common', gems: 25 }]) {
    const offerId = `card-${card.id}`;
    const banner = `/assets/shop/banners/${card.id}-card.webp`;
    // Keep approved scene covers when reimporting animation sources.
    if (!fs.existsSync(path.join(root, 'public', banner))) {
      await sharp(path.join(assets, card.id, `${card.id}.webp`)).resize({ height: 640, kernel: 'nearest' }).webp({ quality: 75, effort: 6 }).toFile(path.join(root, 'public', banner));
    }
    if (!shop.offers.some(offer => offer.id === offerId)) shop.offers.push({
      id: offerId, section: 'profile', kind: 'item', name: card.name,
      description: `An animated ${card.rarity} battle card.`, rarity: card.rarity, banner,
      price: { type: 'virtual', currency: 'gems', amount: card.gems }, purchaseLimit: 'lifetime', grants: [{ kind: 'card', id: card.id }],
    });
    if (!shop.rotation.sales.promotedOfferIds.includes(offerId)) shop.rotation.sales.promotedOfferIds.push(offerId);
  }
  fs.writeFileSync(shopPath, JSON.stringify(shop, null, 2) + '\n');
  for (const card of additions) {
    console.log(`Importing ${card.name}...`);
    execFileSync(process.execPath, [path.join(__dirname, 'import-player-card-videos.cjs'), '--card', card.id, videos.get(card.id)], { stdio: 'inherit' });
  }
  if (sources === upload && !fs.existsSync(archive)) {
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.renameSync(upload, archive);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
