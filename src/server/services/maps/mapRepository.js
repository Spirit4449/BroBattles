const { getConfig } = require("../../config");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { mapDefaults } = require("../../../shared/maps");
const {
  clone,
  mapSummary,
  validateDocument,
  upgradeDuelMap,
} = require("../../../shared/maps/mapDocument");
const { validateAssets } = require("./mapAssetValidation");
const { resolveAssetFile, publishUploads, pinMapAssets } = require("./mapAssetFiles");

const revisionOf = (doc) => createHash("sha256").update(JSON.stringify(doc)).digest("hex");
const METADATA_RECHECK_MS = 5000;
const REVISION_PATTERN = /^[a-f0-9]{64}$/;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

function writeJson(file, value, { immutable = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
    if (!immutable) {
      fs.renameSync(temp, file);
      return value;
    }
    try {
      fs.linkSync(temp, file);
      return value;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      return readJson(file);
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

class MapRepository {
  constructor(directory = getConfig().maps.dir, { persistMatches = getConfig().isProd } = {}) {
    this.directory = directory;
    this.persistMatches = persistMatches;
    this.matches = new Map();
    this._metadata = null;
    this._metadataSig = null;
    this._metadataCheckedAt = 0;
  }

  publicationFile(id) {
    return path.join(this.directory, "published", `${id}.json`);
  }

  revisionFile(id, revision) {
    return path.join(this.directory, "history", String(id), `${revision}.json`);
  }

  get(id) {
    id = Number(id);
    if (!Number.isSafeInteger(id) || id < 1)
      throw Object.assign(new Error("Invalid map ID"), { status: 400 });
    const publication = readJson(this.publicationFile(id));
    if (publication) {
      const { revision } = publication;
      if (!REVISION_PATTERN.test(revision))
        throw new Error(`Invalid publication pointer for map ${id}`);
      const document = readJson(this.revisionFile(id, revision));
      if (!document || document.id !== id || revisionOf(document) !== revision) {
        throw new Error(`Missing or invalid publication ${revision} for map ${id}`);
      }
      return { document, revision };
    }

    const legacy = readJson(path.join(this.directory, `${id}.json`));
    const source = legacy || mapDefaults.find((doc) => doc.id === id);
    if (!source) throw Object.assign(new Error("Map not found"), { status: 404 });
    if (source.id !== id) throw new Error(`Map ${id} has document ID ${source.id}`);
    const document = upgradeDuelMap(source);
    return { document, revision: revisionOf(document) };
  }

  mapFiles({ legacyOnly = false } = {}) {
    const files = [];
    for (const folder of legacyOnly ? [""] : ["", "published"]) {
      const base = path.join(this.directory, folder);
      if (!fs.existsSync(base)) continue;
      for (const name of fs.readdirSync(base)) {
        if (/^\d+\.json$/.test(name)) files.push(path.join(folder, name));
      }
    }
    return files;
  }

  mapIds(files = this.mapFiles()) {
    const ids = new Set(mapDefaults.map((doc) => doc.id));
    for (const file of files) ids.add(Number(path.basename(file, ".json")));
    return [...ids].sort((a, b) => a - b);
  }

  list() {
    return this.mapIds().map((id) => this.get(id));
  }

  listMetadata() {
    const now = Date.now();
    if (this._metadata && now - this._metadataCheckedAt < METADATA_RECHECK_MS)
      return clone(this._metadata);
    const files = this.mapFiles();
    const signature = files
      .map((file) => {
        const stat = fs.statSync(path.join(this.directory, file));
        return `${file}:${stat.ino}:${stat.mtimeMs}:${stat.size}`;
      })
      .sort()
      .join("|");
    if (!this._metadata || signature !== this._metadataSig) {
      this._metadata = this.mapIds(files).map((id) => mapSummary(this.get(id).document));
      this._metadataSig = signature;
    }
    this._metadataCheckedAt = now;
    return clone(this._metadata);
  }

  invalidateMetadata() {
    this._metadata = null;
  }

  validate(document) {
    const errors = validateDocument(document);
    if (!errors.length) errors.push(...validateAssets(document, undefined, this.directory));
    if (errors.length)
      throw Object.assign(new Error("Map validation failed"), { status: 422, errors });
  }

  storeRevision({ document, revision }) {
    const stored = writeJson(this.revisionFile(document.id, revision), document, {
      immutable: true,
    });
    if (revisionOf(stored) !== revision)
      throw new Error(`Invalid archived revision ${revision} for map ${document.id}`);
    const pinnedFile = path.join(this.directory, "pinned", String(document.id), `${revision}.json`);
    if (!fs.existsSync(pinnedFile)) {
      writeJson(pinnedFile, pinMapAssets(document, this.directory), { immutable: true });
    }
  }

  publish({ document, revision }) {
    this.storeRevision({ document, revision });
    writeJson(this.publicationFile(document.id), { revision });
    this.invalidateMetadata();
    return { document, revision };
  }

  importLegacy() {
    const results = [];
    for (const file of this.mapFiles({ legacyOnly: true })) {
      const id = Number(path.basename(file, ".json"));
      try {
        const publication = readJson(this.publicationFile(id));
        const entry = this.get(id);
        if (!publication) {
          this.validate(entry.document);
          this.storeRevision(entry);
          writeJson(this.publicationFile(id), { revision: entry.revision }, { immutable: true });
          this.invalidateMetadata();
        }
        results.push({ id, revision: entry.revision, imported: !publication });
      } catch (error) {
        results.push({ id, error });
      }
    }
    return results;
  }

  // Existing archives keep their original schema and revision IDs. Non-hash
  // backup filenames remain on disk and acquire the same recoverable revision.
  pinHistory() {
    const root = path.join(this.directory, "history");
    const results = [];
    const verified = new Set();
    if (!fs.existsSync(root)) return results;
    for (const id of fs.readdirSync(root).filter((name) => /^\d+$/.test(name))) {
      for (const file of fs
        .readdirSync(path.join(root, id))
        .filter((name) => name.endsWith(".json"))) {
        try {
          const document = readJson(path.join(root, id, file));
          const revision = revisionOf(document);
          if (
            document.id !== Number(id) ||
            (REVISION_PATTERN.test(file.slice(0, -5)) && file !== revision + ".json")
          ) {
            throw new Error("Archive identity mismatch");
          }
          this.storeRevision({ document, revision });
          const pinned = readJson(path.join(this.directory, "pinned", id, revision + ".json"));
          const verify = (url) => {
            if (!url || verified.has(url)) return;
            const name = path.basename(url, path.extname(url));
            if (!REVISION_PATTERN.test(name) || !url.startsWith("/assets/map-revisions/")) {
              throw new Error(`Unpinned map artwork: ${url}`);
            }
            const bytes = fs.readFileSync(resolveAssetFile(url, this.directory));
            if (createHash("sha256").update(bytes).digest("hex") !== name)
              throw new Error(`Damaged map artwork: ${url}`);
            verified.add(url);
          };
          for (const layout of Object.values(pinned.variants || { current: pinned })) {
            for (const asset of Object.values(layout.assets)) {
              verify(asset.url);
              verify(asset.atlasURL);
            }
            for (const layer of layout.scenery?.layers || []) verify(layer.url);
            if (typeof layout.background === "string") verify(layout.background);
          }
          results.push({ id, file, revision });
        } catch (error) {
          results.push({ id, file, error });
        }
      }
    }
    return results;
  }

  save(document, expectedRevision) {
    document = upgradeDuelMap(document);
    this.validate(document);
    // The admin server and offline art tools can publish to the same directory.
    // An exclusive file serializes the revision check and pointer replacement.
    const folder = path.join(this.directory, "locks");
    fs.mkdirSync(folder, { recursive: true });
    const lock = path.join(folder, document.id + ".lock");
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      throw Object.assign(
        new Error("Another process is publishing this map. Retry after it finishes."),
        { status: 409 },
      );
    }
    try {
      let current;
      try {
        current = this.get(document.id);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      if ((current?.revision ?? null) !== expectedRevision) {
        throw Object.assign(
          new Error(
            "This map changed since you opened it. Export your edits, then reload and merge before saving.",
          ),
          { status: 409 },
        );
      }
      if (current) this.storeRevision(current);
      document = publishUploads(document, this.directory);
      return this.publish({ document, revision: revisionOf(document) });
    } finally {
      fs.unlinkSync(lock);
    }
  }

  forMatch(matchId, mapId) {
    const key = `${matchId}:${mapId}`;
    if (this.matches.has(key)) return clone(this.matches.get(key));
    const matchFile = path.join(
      this.directory,
      "matches",
      `${Number(matchId)}-${Number(mapId)}.json`,
    );
    let snapshot = this.persistMatches ? readJson(matchFile) : null;
    if (!snapshot) {
      const { document, revision } = this.get(Number(mapId) || 1);
      const pinnedFile = path.join(
        this.directory,
        "pinned",
        String(document.id),
        `${revision}.json`,
      );
      const { schemaVersion: _schemaVersion, ...map } =
        readJson(pinnedFile) || pinMapAssets(document, this.directory);
      snapshot = { mapId: document.id, revision, metadata: mapSummary(document), map };
      if (this.persistMatches) snapshot = writeJson(matchFile, snapshot, { immutable: true });
    }
    if (this.matches.size >= 10000) this.matches.delete(this.matches.keys().next().value);
    this.matches.set(key, snapshot);
    return clone(snapshot);
  }
}

const mapRepository = new MapRepository();
module.exports = { MapRepository, mapRepository, revisionOf };
