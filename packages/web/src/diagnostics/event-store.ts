/**
 * Browser-side diagnostic event ring backed by IndexedDB.
 *
 * Single store with auto-increment keys and a `ts` index. Capacity is
 * bounded (default 2000 records); oldest records are evicted on overflow.
 * Every public method is fault-tolerant: a missing IndexedDB, a quota
 * error, or a transaction abort all degrade silently so the diagnostics
 * layer never breaks the rest of the app.
 */
import { meetsLevel, type DiagnosticEvent, type DiagnosticLevel } from "@amagicpear/pichamber-shared";

const DB_NAME = "pichamber-diagnostics";
const STORE = "events";
const VERSION = 1;
const DEFAULT_CAPACITY = 2_000;

/** Promise wrapper around `indexedDB.open`. Keeps the typed surface narrow. */
const openDb = (): Promise<IDBDatabase | null> =>
  new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("ts", "ts", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

type TxMode = "readonly" | "readwrite";

const run = async <T>(
  db: IDBDatabase,
  mode: TxMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> =>
  new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let request: IDBRequest<T> | undefined;
      try {
        request = fn(store) ?? undefined;
      } catch {
        resolve(undefined);
        return;
      }
      tx.oncomplete = () => resolve(request?.result as T | undefined);
      tx.onabort = () => resolve(undefined);
      tx.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });

const trimToCapacity = async (db: IDBDatabase, capacity: number): Promise<void> => {
  await run<number>(db, "readonly", (store) => store.count()).then(async (count) => {
    if (!count || count <= capacity) return;
    const overflow = count - capacity;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const objectStore = tx.objectStore(STORE);
      const cursor = objectStore.openCursor();
      let removed = 0;
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        c.delete();
        removed += 1;
        if (removed >= overflow) {
          resolve();
          return;
        }
        c.continue();
      };
      cursor.onerror = () => resolve();
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
    });
  });
};

/** A single record as stored in IndexedDB. The `id` is filled in by the
 *  store on insert; everything else is the canonical `DiagnosticEvent`. */
type DiagnosticRecord = DiagnosticEvent & { id?: number };

export type DiagnosticsStore = {
  insert: (event: DiagnosticEvent) => Promise<void>;
  /** Returns up to `limit` most recent events, oldest first. */
  tail: (limit?: number) => Promise<DiagnosticEvent[]>;
  /** Wipes all events. Used by the Settings "Clear" action. */
  clear: () => Promise<void>;
  /** Returns the current record count (or null when IndexedDB is unavailable). */
  count: () => Promise<number | null>;
};

/** Open a lazy handle to the diagnostics DB. The handle resolves once on
 *  first call and reuses the connection; subsequent failures return null
 *  and remember the failure so we don't keep retrying on every event. */
let cached: { db: IDBDatabase | null; ready: Promise<DiagnosticsStore> } | null = null;

const buildStore = (db: IDBDatabase | null, capacity: number): DiagnosticsStore => ({
  async insert(event) {
    if (!db) return;
    if (!meetsLevel(event.level, currentLevel())) return;
    await run(db, "readwrite", (store) => store.add(event as DiagnosticRecord));
    await trimToCapacity(db, capacity);
  },
  async tail(limit = capacity) {
    if (!db) return [];
    const safeLimit = Math.max(1, Math.min(capacity, limit));
    const all: DiagnosticEvent[] = await (run(db, "readonly", (store) => store.getAll()) as Promise<DiagnosticEvent[] | undefined>).then(
      (rows) => rows ?? [],
    );
    return all.slice(-safeLimit);
  },
  async clear() {
    if (!db) return;
    await run(db, "readwrite", (store) => store.clear());
  },
  async count() {
    if (!db) return null;
    const result = await run(db, "readonly", (store) => store.count());
    return typeof result === "number" ? result : null;
  },
});

/** Browser-side level threshold. The browser has no LOG_LEVEL environment
 *  variable, but `?log=debug` in the URL is a useful override for the
 *  developer building the bundle. */
let browserLevel: DiagnosticLevel = "info";
export const setDiagnosticsLevel = (level: DiagnosticLevel) => {
  browserLevel = level;
};
export const currentLevel = () => browserLevel;

export const openDiagnosticsStore = (capacity = DEFAULT_CAPACITY): Promise<DiagnosticsStore> => {
  if (cached) return cached.ready;
  cached = { db: null, ready: Promise.resolve().then(async () => buildStore(await openDb(), capacity)) };
  return cached.ready;
};