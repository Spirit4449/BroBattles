const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const defaults = require('../../shared/mapDefaults');
const { clone, variantKey, validateDocument } = require('../../shared/mapDocument');
const revisionOf = doc => createHash('sha256').update(JSON.stringify(doc)).digest('hex');
class MapRepository {
  constructor(directory = process.env.BB_MAP_DIR || path.resolve(__dirname, '../../../data/maps')) { this.directory = directory; this.matches = new Map(); }
  get(id) {
    if (!Number.isInteger(Number(id)) || Number(id) < 1) throw Object.assign(new Error('Invalid map ID'), {status:400});
    const file = path.join(this.directory, `${Number(id)}.json`);
    const document = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : clone(defaults.find(d => d.id === Number(id)) || null);
    if (!document) throw Object.assign(new Error('Map not found'), {status:404});
    return { document, revision: revisionOf(document) };
  }
  list() {
    const ids = new Set(defaults.map(d=>d.id));
    if (fs.existsSync(this.directory)) for (const f of fs.readdirSync(this.directory)) if (/^\d+\.json$/.test(f)) ids.add(Number(f.slice(0,-5)));
    return [...ids].sort((a,b)=>a-b).map(id => this.get(id));
  }
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
      this.matches.set(key, {mapId:document.id, revision, variant:selectedVariant, metadata:{...document.metadata,id:document.id,label:document.label}, map:require('./mapAssetFiles').pinMapAssets(document.variants[selectedVariant])});
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
