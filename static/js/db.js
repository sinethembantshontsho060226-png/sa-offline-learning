/*
 * db.js — the on-device database.
 * Everything a learner sees after install comes from here, never from a
 * live request. Sync (sync.js, inside app.js) is the only thing that
 * ever talks to the network, and only to top this database up.
 */
const DB_NAME = "sa_offline_learning";
const DB_VERSION = 1;
let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv", { keyPath: "key" }); // auth, sync meta
      }
      if (!db.objectStoreNames.contains("notes")) {
        const s = db.createObjectStore("notes", { keyPath: "id" });
        s.createIndex("by_scope", ["school_emis", "grade"]);
      }
      if (!db.objectStoreNames.contains("quizzes")) {
        const s = db.createObjectStore("quizzes", { keyPath: "id" });
        s.createIndex("by_scope", ["school_emis", "grade"]);
      }
      if (!db.objectStoreNames.contains("homework")) {
        const s = db.createObjectStore("homework", { keyPath: "id" });
        s.createIndex("by_scope", ["school_emis", "grade"]);
      }
      if (!db.objectStoreNames.contains("quiz_results")) {
        db.createObjectStore("quiz_results", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("planner")) {
        db.createObjectStore("planner", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("pending_uploads")) {
        db.createObjectStore("pending_uploads", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(storeNames, mode) {
  return openDB().then((db) => db.transaction(storeNames, mode));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  // ---- simple key/value (auth session, sync meta) ----
  async kvGet(key) {
    const t = await tx(["kv"], "readonly");
    const row = await reqToPromise(t.objectStore("kv").get(key));
    return row ? row.value : undefined;
  },
  async kvSet(key, value) {
    const t = await tx(["kv"], "readwrite");
    await reqToPromise(t.objectStore("kv").put({ key, value }));
  },
  async kvDelete(key) {
    const t = await tx(["kv"], "readwrite");
    await reqToPromise(t.objectStore("kv").delete(key));
  },

  // ---- generic record helpers ----
  async put(store, record) {
    const t = await tx([store], "readwrite");
    await reqToPromise(t.objectStore(store).put(record));
  },
  async putAll(store, records) {
    const t = await tx([store], "readwrite");
    const os = t.objectStore(store);
    records.forEach((r) => os.put(r));
    return new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  },
  async get(store, id) {
    const t = await tx([store], "readonly");
    return reqToPromise(t.objectStore(store).get(id));
  },
  async delete(store, id) {
    const t = await tx([store], "readwrite");
    await reqToPromise(t.objectStore(store).delete(id));
  },
  async all(store) {
    const t = await tx([store], "readonly");
    return reqToPromise(t.objectStore(store).getAll());
  },

  // ---- scoped queries used by the views ----
  async byScope(store, school_emis, grade) {
    const t = await tx([store], "readonly");
    const idx = t.objectStore(store).index("by_scope");
    const rows = await reqToPromise(idx.getAll(IDBKeyRange.only([school_emis, grade])));
    return rows.filter((r) => !r.deleted).sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  },
  async byTeacher(store, teacher_id) {
    const all = await DB.all(store);
    return all.filter((r) => r.teacher_id === teacher_id && !r.deleted)
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  },
  async unsynced(store) {
    const all = await DB.all(store);
    return all.filter((r) => r.synced === false);
  },

  async clearAllContent() {
    const stores = ["notes", "quizzes", "homework", "quiz_results", "planner", "pending_uploads"];
    const t = await tx(stores, "readwrite");
    stores.forEach((s) => t.objectStore(s).clear());
    return new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  },
};
