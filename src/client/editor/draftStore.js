import { MapHistory, clone, upgradeDuelMap, validateDocument } from "../../shared/maps/mapDocument";

const DATABASE_NAME = "bb-map-studio";
const STORE = "drafts";
const MAX_HISTORY_STATES = 250;
const MAX_RECORD_BYTES = 32 * 1024 * 1024;
const draftKey = id => `bb-map-draft-${id}`;

export function restoreDraft(record, id) {
  if (!record || record.document?.id !== Number(id)) return null;
  if (record.version !== undefined && record.version !== 1) return null;
  const document = upgradeDuelMap(record.document);
  if (validateDocument(document).length) return null;
  const history = new MapHistory(document, MAX_HISTORY_STATES);
  const { stack, index } = record;
  if (Array.isArray(stack) && stack.length <= MAX_HISTORY_STATES &&
      Number.isInteger(index) && index >= 0 && index < stack.length &&
      stack.every(state => state?.id === document.id)) {
    history.stack = stack.map(upgradeDuelMap);
    history.stack[index] = clone(document);
    history.index = index;
  }
  return { document, revision: record.revision, history };
}

export function createDraftStore() {
  // Browser storage getters can throw in restricted browsing contexts.
  let legacyStorage;
  try { legacyStorage = globalThis.localStorage; } catch { /* IndexedDB can still be available. */ }
  let connection;

  function open() {
    connection ??= new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => {
      connection = null;
      throw error;
    });
    return connection;
  }

  async function transaction(mode, operate) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operate(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function write(record) {
    const encoded = JSON.stringify(record);
    if (new Blob([encoded]).size > MAX_RECORD_BYTES) throw new Error("Draft history exceeds its storage limit.");
    await transaction("readwrite", store => store.put(JSON.parse(encoded)));
  }

  return {
    async load(id) {
      const current = await transaction("readonly", store => store.get(id)).catch(() => null);
      const existing = restoreDraft(current, id);
      if (existing) return existing;
      let legacy;
      try { legacy = JSON.parse(legacyStorage?.getItem(draftKey(id)) || "null"); } catch { return null; }
      const restored = restoreDraft(legacy, id);
      if (restored) {
        try {
          await write({ version: 1, id, document: restored.document, revision: restored.revision });
          legacyStorage.removeItem(draftKey(id));
        } catch {
          // Keep reading the old draft if IndexedDB is unavailable or full.
        }
      }
      return restored;
    },
    async save(document, revision, history) {
      await write({ version: 1, id: document.id, document, revision, stack: history.stack, index: history.index });
    },
    async remove(id) {
      await transaction("readwrite", store => store.delete(id));
      legacyStorage?.removeItem(draftKey(id));
    },
    async unsavedMaps() {
      const records = await transaction("readonly", store => store.getAll()).catch(() => []);
      const unsaved = new Map(records.filter(record => record.revision === null).map(record => [record.id, record.document]));
      for (let index = 0; index < (legacyStorage?.length || 0); index++) {
        const key = legacyStorage.key(index);
        const id = Number(key?.match(/^bb-map-draft-(\d+)$/)?.[1]);
        if (!id || unsaved.has(id)) continue;
        try {
          const record = JSON.parse(legacyStorage.getItem(key));
          if (record?.revision === null && record.document?.id === id) unsaved.set(id, record.document);
        } catch {
          // A malformed older draft doesn't hide the other maps.
        }
      }
      return [...unsaved.values()];
    },
  };
}
