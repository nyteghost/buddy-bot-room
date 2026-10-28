import { memoryStore, type VecStore } from "./embed-cache";

const DB = "pixel-pals-embeddings", VECS = "vecs", META = "meta", MAX_ENTRIES = 8000, PRUNE_TO = 6000;
const wrap = <T,>(r: IDBRequest<T>): Promise<T> => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });

/** Browser-persistent vector cache (IndexedDB). Anything that goes wrong falls back to an in-memory cache for this tab. */
export function idbStore(): VecStore {
  const fallback = memoryStore();
  let dbp: Promise<IDBDatabase | null> | null = null;
  const open = () => (dbp ??= new Promise<IDBDatabase | null>((ok) => {
    try {
      if (typeof indexedDB === "undefined") return ok(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const vecs = db.createObjectStore(VECS);
        vecs.createIndex("t", "t");
        db.createObjectStore(META);
      };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => ok(null);
      req.onblocked = () => ok(null);
    } catch { ok(null); }
  }));
  return {
    async get(keys) {
      const db = await open();
      if (!db) return fallback.get(keys);
      try {
        const store = db.transaction(VECS, "readonly").objectStore(VECS);
        const rows = await Promise.all(keys.map((k) => wrap(store.get(k)) as Promise<{ v: Float32Array } | undefined>));
        const out = new Map<string, number[]>();
        rows.forEach((row, i) => { if (row) out.set(keys[i]!, Array.from(row.v)); });
        return out;
      } catch { return fallback.get(keys); }
    },
    async put(entries) {
      await fallback.put(entries);
      const db = await open();
      if (!db || !entries.length) return;
      try {
        const tx = db.transaction(VECS, "readwrite");
        const store = tx.objectStore(VECS);
        const t = Date.now();
        for (const [k, v] of entries) store.put({ v: Float32Array.from(v), t }, k);
        await new Promise<void>((ok) => { tx.oncomplete = () => ok(); tx.onerror = () => ok(); tx.onabort = () => ok(); });
        const count = await wrap(db.transaction(VECS, "readonly").objectStore(VECS).count());
        if (count > MAX_ENTRIES) { // keep the newest vectors
          const tx2 = db.transaction(VECS, "readwrite");
          let drop = count - PRUNE_TO;
          tx2.objectStore(VECS).index("t").openCursor().onsuccess = (e) => {
            const cur = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (cur && drop-- > 0) { cur.delete(); cur.continue(); }
          };
        }
      } catch { /* the in-memory copy still works */ }
    },
    async getModel() {
      const db = await open();
      if (!db) return fallback.getModel();
      try { return ((await wrap(db.transaction(META, "readonly").objectStore(META).get("model"))) as string | undefined) ?? ""; } catch { return fallback.getModel(); }
    },
    async setModel(model) {
      await fallback.setModel(model);
      const db = await open();
      if (!db) return;
      try { db.transaction(META, "readwrite").objectStore(META).put(model, "model"); } catch { /* optional */ }
    },
  };
}
