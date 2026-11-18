const { imageSize } = require("./imageSize");
const { getConfig } = require("../../config");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const publicRoot = path.resolve(__dirname, "../../../../public");
const assetDataRoot = (directory = getConfig().maps.dir) => path.join(directory, "assets");
const assetUrl = (url) =>
  typeof url === "string" && /^\/assets\/[a-zA-Z0-9_./-]+$/.test(url) && !url.includes("..");
function resolveAssetFile(url, directory) {
  if (!assetUrl(url)) throw Error("Asset must use a local /assets/ path");
  for (const [prefix, folder] of [
    ["/assets/map-editor-staged/", "staged"],
    ["/assets/map-revisions/", "revisions"],
  ]) {
    if (url.startsWith(prefix)) {
      const name = url.slice(prefix.length);
      if (!/^[a-zA-Z0-9_-]+\.(webp|png|jpg|jpeg|json)$/.test(name))
        throw Error("Invalid asset filename");
      return path.join(assetDataRoot(directory), folder, name);
    }
  }
  return path.join(publicRoot, url.slice(1));
}
function stageUpload({ targetUrl, fileName, base64 }, directory) {
  const ext = path.extname(String(fileName)).toLowerCase();
  if (![".webp", ".png", ".jpg", ".jpeg"].includes(ext))
    throw Object.assign(Error("Choose a PNG, WebP or JPEG image"), { status: 400 });
  if (
    !assetUrl(targetUrl) ||
    ["/assets/map-editor-staged/", "/assets/map-revisions/"].some((prefix) =>
      targetUrl.startsWith(prefix),
    )
  )
    throw Object.assign(Error("Choose a game asset path under /assets/"), { status: 400 });
  const bytes = Buffer.from(String(base64 || ""), "base64");
  if (!bytes.length || bytes.length > 8 * 1024 * 1024)
    throw Object.assign(Error("Image must be smaller than 8 MB"), { status: 400 });
  let dimensions;
  try {
    dimensions = imageSize(bytes);
  } catch {
    throw Object.assign(Error("Choose a valid PNG, WebP or JPEG image"), { status: 400 });
  }
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > 16384 ||
    dimensions.height > 16384
  )
    throw Object.assign(Error("Image exceeds 16384 pixels"), { status: 400 });
  const name = randomUUID() + ext;
  const url = "/assets/map-editor-staged/" + name;
  const file = resolveAssetFile(url, directory);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const target = targetUrl.replace(/\.[a-zA-Z0-9]+$/, ext);
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(file + ".json", JSON.stringify({ targetUrl: target, originalUrl: targetUrl }));
  return { url, targetUrl: target, ...dimensions };
}
function immutableAsset(url, directory) {
  if (url.startsWith("/assets/map-revisions/")) return url;
  return storeImmutableAsset(
    fs.readFileSync(resolveAssetFile(url, directory)),
    path.extname(url),
    directory,
  );
}

function storeImmutableAsset(bytes, extension, directory) {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const result = `/assets/map-revisions/${hash}${extension}`;
  const file = resolveAssetFile(result, directory);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + "." + randomUUID() + ".tmp";
    try {
      fs.writeFileSync(temp, bytes, { flag: "wx" });
      fs.renameSync(temp, file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
  return result;
}

function publishUploads(document, directory) {
  const copy = structuredClone(document);
  for (const asset of Object.values(copy.assets)) {
    if (!asset.url.startsWith("/assets/map-editor-staged/")) continue;
    const stage = resolveAssetFile(asset.url, directory);
    const { targetUrl } = JSON.parse(fs.readFileSync(stage + ".json", "utf8"));
    if (!assetUrl(targetUrl)) throw Error("Invalid staged asset destination");
    asset.sourceUrl = targetUrl;
    asset.url = immutableAsset(asset.url, directory);
    delete asset.replaceTarget;
  }
  return copy;
}

function pinMapAssets(map, directory) {
  const copy = structuredClone(map);
  // Older archives kept the same asset tables inside each team-size variant.
  for (const layout of Object.values(copy.variants || { current: copy })) {
    for (const asset of Object.values(layout.assets || {})) {
      asset.sourceUrl = asset.sourceUrl || asset.replaceTarget || asset.url;
      asset.url = immutableAsset(asset.url, directory);
      if (asset.atlasURL) asset.atlasURL = immutableAsset(asset.atlasURL, directory);
    }
    for (const layer of layout.scenery?.layers || [])
      layer.url = immutableAsset(layer.url, directory);
    if (typeof layout.background === "string")
      layout.background = immutableAsset(layout.background, directory);
  }
  return copy;
}
module.exports = {
  resolveAssetFile,
  stageUpload,
  publishUploads,
  pinMapAssets,
  storeImmutableAsset,
};
