const DB_NAME = 'betalab';
const STORES = ['plans', 'sessions', 'climbs', 'photos', 'meta'];
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) {
        if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

export const getAll = store => run(store, 'readonly', s => s.getAll());
export const get = (store, id) => run(store, 'readonly', s => s.get(id));
export const put = (store, value) => run(store, 'readwrite', s => s.put(value));
export const del = (store, id) => run(store, 'readwrite', s => s.delete(id));
export const clear = store => run(store, 'readwrite', s => s.clear());
export const storeNames = STORES;
