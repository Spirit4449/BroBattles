const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const defaults = require('../../../shared/maps').mapDefaults;
const { clone, variantKey, validateDocument } = require('../../../shared/maps/mapDocument');
const revisionOf = doc => createHash('sha256').update(JSON.stringify(doc)).digest('hex');
// Bounded staleness for edits made outside this process (other workers, manual
// file edits). Saves through this repository invalidate immediately.
const METADATA_RECHECK_MS = 5000;
const mapSummary = document => ({...document.metadata, id:document.id, label:document.label});
class MapRepository {
  constructor(directory = process.env.BB_MAP_DIR || path.resolve(__dirname, "../../../../data/maps")) { this.directory = directory; this.matches = new Map(); this._metadata = null; this._metadataSig = null; this._metadataCheckedAt = 0; }
  readDocument(id) {
    if (!Number.isInteger(Number(id)) || Number(id) < 1) throw Object.assign(new Error('Invalid map ID'), {status:400});
    const file = path.join(this.directory, `${Number(id)}.json`);
    const document = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : clone(defaults.find(d => d.id === Number(id)) || null);
    if (!document) throw Object.assign(new Error('Map not found'), {status:404});
    return document;
  }
  get(id) {
    const document = this.readDocument(id);
    return { document, revision: revisionOf(document) };
  }
  mapFiles() {
    return fs.existsSync(this.directory) ? fs.readdirSync(this.directory).filter(f => /^\d+\.json$/.test(f)) : [];
  }
  mapIds(files = this.mapFiles()) {
    const ids = new Set(defaults.map(d=>d.id));
    for (const f of files) ids.add(Number(f.slice(0,-5)));
    return [...ids].sort((a,b)=>a-b);
  }
  list() {
    return this.mapIds().map(id => this.get(id));
  }
  // Metadata-only listing for hot paths (/status, mode/map selection). Cached;
  // after METADATA_RECHECK_MS a stat-only signature decides whether to reparse.
  listMetadata() {
    const now = Date.now();
    if (this._metadata && now - this._metadataCheckedAt < METADATA_RECHECK_MS) return clone(this._metadata);
    const files = this.mapFiles();
    const signature = files.map(f => { const st = fs.statSync(path.join(this.directory, f)); return `${f}:${st.mtimeMs}:${st.size}`; }).sort().join('|');
    if (!this._metadata || signature !== this._metadataSig) {
      this._metadata = this.mapIds(files).map(id => mapSummary(this.readDocument(id)));
      this._metadataSig = signature;
    }
    this._metadataCheckedAt = now;
    return clone(this._metadata);
  }
  invalidateMetadata() { this._metadata = null; }
  save(document, expectedRevision) {
    const errors = validateDocument(document);
    if (!errors.length) errors.push(...require("./mapAssetValidation").validateAssets(document));
    if (errors.length) throw Object.assign(new Error('Map validation failed'), {status:422, errors});
    let current = null;
    try { current = this.get(document.id); } catch(e) { if(e.status !== 404) throw e; }
    if ((current?.revision || null) !== expectedRevision) throw Object.assign(new Error('This map changed since you opened it. Export your edits, then reload and merge before saving.'), {status:409});
    return require("./mapAssetFiles").publishUploads(document, document => {
    fs.mkdirSync(this.directory, {recursive:true});
    const file = path.join(this.directory, `${document.id}.json`);
    const temp = path.join(this.directory, `.${document.id}-${randomUUID()}.tmp`);
    // No async gap between revision comparison and atomic replacement.
    try {
      fs.writeFileSync(temp, JSON.stringify(document, null, 2)+'\n', {flag:'wx'});
      if (current) {
        const history = path.join(this.directory,'history',String(document.id)); fs.mkdirSync(history,{recursive:true});
        fs.writeFileSync(path.join(history, `${current.revision}.json`), JSON.stringify(current.document,null,2)+'\n');
      }
      fs.renameSync(temp,file);
      this.invalidateMetadata();
    } finally { if(fs.existsSync(temp)) fs.unlinkSync(temp); }
    return this.get(document.id);
    });
  }
  forMatch(matchId, mapId, variant) {
    const key = `${matchId}:${mapId}:${variantKey(variant)}`;
    if (!this.matches.has(key)) {
      const persist = process.env.NODE_ENV === 'production';
      const matchFile = path.join(this.directory,'matches',`${Number(matchId)}-${Number(mapId)}-${variantKey(variant)}.json`);
      if (persist && fs.existsSync(matchFile)) {
        const stored = JSON.parse(fs.readFileSync(matchFile,'utf8'));
        this.matches.set(key,stored);
        return clone(stored);
      }
      const {document, revision} = this.get(Number(mapId) || 1);
      const selectedVariant = variantKey(variant);
      if (this.matches.size > 10000) this.matches.delete(this.matches.keys().next().value);
      this.matches.set(key, {mapId:document.id, revision, variant:selectedVariant, metadata:mapSummary(document), map:require('./mapAssetFiles').pinMapAssets(document.variants[selectedVariant])});
      if (persist) {
        fs.mkdirSync(path.dirname(matchFile),{recursive:true});
        // An exclusive write pins the first revision across workers too.
        try {fs.writeFileSync(matchFile,JSON.stringify(this.matches.get(key)),{flag:'wx'});}
        catch(e){if(e.code!=='EEXIST')throw e;this.matches.set(key,JSON.parse(fs.readFileSync(matchFile,'utf8')));}
      }
    }
    return clone(this.matches.get(key));
  }
}
const mapRepository = new MapRepository();
module.exports = { MapRepository, mapRepository, revisionOf };
